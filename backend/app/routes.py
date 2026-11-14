"""Room-scoped domain endpoints. All mutations acquire SQLite's write lock first."""
from datetime import datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from .balances import compute_balances, split_equal, validate_settlement
from .database import utcnow
from .domain_schemas import ChoreCreate, ChoreEdit, ExpenseCreate, ExpenseEdit, SettlementCreate, ShoppingCreate, ShoppingEdit
from .models import Chore, ChoreRotationMember, Expense, ExpenseShare, Room, RoomMember, Settlement, ShoppingItem, User
from .schemas import UserOut

KYIV = ZoneInfo("Europe/Kyiv")


def columns(row):
    # Domain models only; never use this serializer for users/password hashes.
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


def public_user(db, user_id):
    return UserOut.model_validate(db.get(User, user_id)).model_dump() if user_id else None


def membership(db, room_id, user_id):
    if db.get(Room, room_id) is None:
        raise HTTPException(404, "Room not found")
    member = db.get(RoomMember, (room_id, user_id))
    if member is None:
        raise HTTPException(403, "Room membership required")
    return member


def participants(db, room_id, ids):
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "Members must be unique")
    for uid in ids:
        membership(db, room_id, uid)


def resource(db, model, room_id, item_id):
    row = db.get(model, item_id)
    if row is None or row.room_id != room_id:
        raise HTTPException(404, "Resource not found in room")
    return row


def rotation_ids(db, chore_id):
    return list(db.scalars(select(ChoreRotationMember.user_id).where(
        ChoreRotationMember.chore_id == chore_id).order_by(ChoreRotationMember.position)))


def chore_out(db, chore):
    return {**columns(chore), "rotation_ids": rotation_ids(db, chore.id), "owner": public_user(db, chore.owner_id)}


def share_map(db, expense_id):
    return dict(db.execute(select(ExpenseShare.user_id, ExpenseShare.share_minor).where(
        ExpenseShare.expense_id == expense_id)).all())


def expense_out(db, expense):
    shares = share_map(db, expense.id)
    return {**columns(expense), "participant_ids": sorted(shares),
            "payer": public_user(db, expense.payer_id), "participants": [public_user(db, uid) for uid in sorted(shares)],
            "shares": [{"user_id": uid, "share_minor": shares[uid]} for uid in sorted(shares)]}


def ledger(db, room_id):
    expenses = list(db.scalars(select(Expense).where(Expense.room_id == room_id)))
    repayments = list(db.scalars(select(Settlement).where(Settlement.room_id == room_id).order_by(Settlement.id)))
    balances, debts = compute_balances(
        [(expense.payer_id, share_map(db, expense.id)) for expense in expenses],
        [(s.debtor_id, s.creditor_id, s.amount_minor, s.status) for s in repayments])
    return balances, debts, repayments


def money_out(db, room_id, user_id):
    balances, debts, repayments = ledger(db, room_id)
    for uid in db.scalars(select(RoomMember.user_id).where(RoomMember.room_id == room_id)):
        balances.setdefault(uid, 0)
    cards = []
    for (debtor, creditor), amount in sorted(debts.items()):
        pending = [s for s in repayments if s.status == "requested" and
                   (s.debtor_id, s.creditor_id) == (debtor, creditor)]
        cards.append({"debtor_id": debtor, "creditor_id": creditor, "amount_minor": amount,
                      "debtor": public_user(db, debtor), "creditor": public_user(db, creditor),
                      "requested_minor": sum(s.amount_minor for s in pending),
                      "status": "requested" if pending else "unpaid"})
    by_me = [card for card in cards if card["debtor_id"] == user_id]
    to_me = [card for card in cards if card["creditor_id"] == user_id]
    return {"balances": [{"user_id": uid, "balance_minor": amount} for uid, amount in sorted(balances.items())],
            "debts": cards, "owed_by_me": by_me, "owed_to_me": to_me,
            "total_i_owe_minor": sum(c["amount_minor"] for c in by_me),
            "total_owed_to_me_minor": sum(c["amount_minor"] for c in to_me),
            "my_balance_minor": balances.get(user_id, 0),
            "settlements": [{**columns(s), "debtor": public_user(db, s.debtor_id), "creditor": public_user(db, s.creditor_id)} for s in repayments]}


def check_amount(amount, outstanding, pending=0):
    try:
        validate_settlement(amount, outstanding, pending)
    except ValueError:
        raise HTTPException(409, "Settlement exceeds current outstanding debt")


def validate_financial_change(db, room_id, old_debts, protect_paid=True):
    """Paid pairs are immutable; other changes must preserve pending reservations."""
    _, debts, settlements = ledger(db, room_id)
    reserved = {}
    for settlement in settlements:
        pair = settlement.debtor_id, settlement.creditor_id
        if settlement.status == "paid" and protect_paid:
            for direction in (pair, pair[::-1]):
                if old_debts.get(direction, 0) != debts.get(direction, 0):
                    raise HTTPException(409, "Expense change would alter a settled pair")
        elif settlement.status == "requested":
            reserved[pair] = reserved.get(pair, 0) + settlement.amount_minor
    for pair, amount in reserved.items():
        check_amount(amount, debts.get(pair, 0))


def install_routes(app, sessions, current_user):
    router = APIRouter(prefix="/api/v1/rooms/{room_id}")

    def read_db():
        with sessions() as db:
            # Keep summary queries on one consistent SQLite snapshot.
            db.execute(text("BEGIN"))
            yield db

    def write_db():
        # Independent of the auth read session. Lock before membership/state reads.
        with sessions() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    def manage_chore(db, room_id, user_id, chore):
        membership(db, room_id, user_id)
        if chore.status == "done":
            raise HTTPException(409, "Reopen a completed chore before editing")

    def set_rotation(db, chore, ids):
        if chore.rotation == "same" or chore.repeat == "once":
            ids = [chore.owner_id]
        if not ids or chore.owner_id not in ids:
            raise HTTPException(422, "Rotation must include the current assignee")
        participants(db, chore.room_id, ids)
        db.execute(delete(ChoreRotationMember).where(ChoreRotationMember.chore_id == chore.id))
        db.add_all([ChoreRotationMember(chore_id=chore.id, user_id=uid, position=i) for i, uid in enumerate(ids)])
        db.flush()

    @router.get("/chores")
    def list_chores(room_id: int, filter: Literal["all", "mine", "waiting", "done"] = "all",
                    user: User = Depends(current_user), db: Session = Depends(read_db)):
        membership(db, room_id, user.id)
        query = select(Chore).where(Chore.room_id == room_id)
        if filter in ("mine", "waiting"):
            query = query.where(Chore.owner_id == user.id)
        if filter in ("waiting", "done"):
            query = query.where(Chore.status == filter)
        return [chore_out(db, c) for c in db.scalars(query.order_by(Chore.due_at, Chore.id))]

    @router.post("/chores", status_code=201)
    def create_chore(room_id: int, data: ChoreCreate, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        membership(db, room_id, data.owner_id)
        values = data.model_dump(exclude={"rotation_ids"})
        chore = Chore(**values, room_id=room_id, created_by_id=user.id,
                      status="active" if data.owner_id == user.id else "waiting",
                      accepted_at=utcnow() if data.owner_id == user.id else None)
        db.add(chore)
        db.flush()
        set_rotation(db, chore, data.rotation_ids)
        return chore_out(db, chore)

    @router.patch("/chores/{item_id}")
    def edit_chore(room_id: int, item_id: int, data: ChoreEdit, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        chore = resource(db, Chore, room_id, item_id)
        manage_chore(db, room_id, user.id, chore)
        ids = data.rotation_ids if "rotation_ids" in data.model_fields_set else rotation_ids(db, chore.id)
        old_owner = chore.owner_id
        for key, value in data.model_dump(exclude_unset=True, exclude={"rotation_ids"}).items():
            setattr(chore, key, value)
        membership(db, room_id, chore.owner_id)
        if chore.owner_id != old_owner:
            if "rotation_ids" not in data.model_fields_set and chore.rotation == "rotate" and chore.owner_id not in ids:
                ids = [chore.owner_id if uid == old_owner else uid for uid in ids]
            chore.status = "active" if chore.owner_id == user.id else "waiting"
            chore.accepted_at = utcnow() if chore.status == "active" else None
        set_rotation(db, chore, ids)
        db.flush()
        return chore_out(db, chore)

    @router.delete("/chores/{item_id}", status_code=204)
    def delete_chore(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        chore = resource(db, Chore, room_id, item_id)
        manage_chore(db, room_id, user.id, chore)
        db.execute(delete(ChoreRotationMember).where(ChoreRotationMember.chore_id == chore.id))
        db.delete(chore)
        return Response(status_code=204)

    @router.post("/chores/{item_id}/accept")
    def accept_chore(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        chore = resource(db, Chore, room_id, item_id)
        if chore.owner_id != user.id:
            raise HTTPException(403, "Only the assignee can accept")
        if chore.status == "done":
            raise HTTPException(409, "Chore is already completed")
        if chore.status == "waiting":
            chore.status, chore.accepted_at = "active", utcnow()
            db.flush()
        return chore_out(db, chore)

    @router.post("/chores/{item_id}/complete")
    def complete_chore(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        chore = resource(db, Chore, room_id, item_id)
        if chore.owner_id != user.id:
            raise HTTPException(403, "Only the assignee can complete")
        if chore.status == "waiting":
            raise HTTPException(409, "Accept the chore before completing it")
        if chore.status != "done":
            chore.status, chore.completed_at = "done", utcnow()
            if chore.repeat == "weekly":
                ids = [uid for uid in rotation_ids(db, chore.id) if db.get(RoomMember, (room_id, uid))]
                if not ids:
                    ids = [chore.owner_id]
                owner = chore.owner_id
                if chore.rotation == "rotate":
                    owner = ids[(ids.index(owner) + 1) % len(ids)] if owner in ids else ids[0]
                now = utcnow()
                successor = Chore(room_id=room_id, title=chore.title, owner_id=owner,
                    created_by_id=chore.created_by_id, difficulty=chore.difficulty,
                    due_at=(chore.due_at.astimezone(KYIV) + timedelta(weeks=1)).astimezone(timezone.utc),
                    status="waiting", repeat="weekly", rotation=chore.rotation, previous_chore_id=chore.id,
                    created_at=now, updated_at=now)
                db.add(successor)
                db.flush()
                set_rotation(db, successor, ids)
            db.flush()
        return chore_out(db, chore)

    @router.post("/chores/{item_id}/reopen")
    def reopen_chore(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        chore = resource(db, Chore, room_id, item_id)
        if chore.owner_id != user.id:
            raise HTTPException(403, "Only the assignee can reopen")
        if chore.status != "done":
            raise HTTPException(409, "Only completed chores can be reopened")
        successor = db.scalar(select(Chore).where(Chore.previous_chore_id == chore.id))
        if successor:
            if successor.status != "waiting" or successor.updated_at != successor.created_at:
                raise HTTPException(409, "Next occurrence has already changed")
            db.execute(delete(ChoreRotationMember).where(ChoreRotationMember.chore_id == successor.id))
            db.delete(successor)
            db.flush()
        chore.status, chore.completed_at = "active", None
        db.flush()
        return chore_out(db, chore)

    @router.get("/shopping-items")
    def list_shopping(room_id: int, user: User = Depends(current_user), db: Session = Depends(read_db)):
        membership(db, room_id, user.id)
        return [{**columns(item), "buyer": public_user(db, item.buyer_id)} for item in db.scalars(select(ShoppingItem).where(ShoppingItem.room_id == room_id).order_by(ShoppingItem.id))]

    @router.post("/shopping-items", status_code=201)
    def create_shopping(room_id: int, data: ShoppingCreate, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        item = ShoppingItem(room_id=room_id, title=data.title, created_by_id=user.id)
        db.add(item)
        db.flush()
        return {**columns(item), "buyer": public_user(db, item.buyer_id)}

    @router.patch("/shopping-items/{item_id}")
    def edit_shopping(room_id: int, item_id: int, data: ShoppingEdit, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        item = resource(db, ShoppingItem, room_id, item_id)
        if data.title is not None:
            item.title = data.title
        if data.done is not None and item.done != data.done:
            item.done = data.done
            item.buyer_id = user.id if data.done else None
            item.completed_at = utcnow() if data.done else None
        db.flush()
        return {**columns(item), "buyer": public_user(db, item.buyer_id)}

    @router.delete("/shopping-items/{item_id}", status_code=204)
    def delete_shopping(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        db.delete(resource(db, ShoppingItem, room_id, item_id))
        return Response(status_code=204)

    @router.get("/expenses")
    def list_expenses(room_id: int, user: User = Depends(current_user), db: Session = Depends(read_db)):
        membership(db, room_id, user.id)
        return [expense_out(db, e) for e in db.scalars(select(Expense).where(Expense.room_id == room_id).order_by(Expense.occurred_at.desc(), Expense.id.desc()))]

    @router.post("/expenses", status_code=201)
    def create_expense(room_id: int, data: ExpenseCreate, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        participants(db, room_id, data.participant_ids)
        expense = Expense(room_id=room_id, payer_id=user.id, title=data.title, amount_minor=data.amount_minor,
                          note=data.note, occurred_at=data.occurred_at or utcnow())
        db.add(expense)
        db.flush()
        db.add_all([ExpenseShare(expense_id=expense.id, user_id=uid, share_minor=amount)
                    for uid, amount in split_equal(data.amount_minor, data.participant_ids).items()])
        db.flush()
        validate_financial_change(db, room_id, {}, protect_paid=False)
        return expense_out(db, expense)

    @router.get("/expenses/{item_id}")
    def expense_detail(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(read_db)):
        membership(db, room_id, user.id)
        return expense_out(db, resource(db, Expense, room_id, item_id))

    @router.patch("/expenses/{item_id}")
    def edit_expense(room_id: int, item_id: int, data: ExpenseEdit, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        expense = resource(db, Expense, room_id, item_id)
        if expense.payer_id != user.id:
            raise HTTPException(403, "Only the payer can edit expenses")
        _, old_debts, _ = ledger(db, room_id)
        ids = data.participant_ids if data.participant_ids is not None else list(share_map(db, expense.id))
        participants(db, room_id, ids)
        for key, value in data.model_dump(exclude_unset=True, exclude={"participant_ids"}).items():
            setattr(expense, key, value)
        db.execute(delete(ExpenseShare).where(ExpenseShare.expense_id == expense.id))
        db.add_all([ExpenseShare(expense_id=expense.id, user_id=uid, share_minor=amount)
                    for uid, amount in split_equal(expense.amount_minor, ids).items()])
        db.flush()
        validate_financial_change(db, room_id, old_debts)
        return expense_out(db, expense)

    @router.delete("/expenses/{item_id}", status_code=204)
    def delete_expense(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        expense = resource(db, Expense, room_id, item_id)
        if expense.payer_id != user.id:
            raise HTTPException(403, "Only the payer can delete expenses")
        _, old_debts, _ = ledger(db, room_id)
        db.execute(delete(ExpenseShare).where(ExpenseShare.expense_id == expense.id))
        db.delete(expense)
        db.flush()
        validate_financial_change(db, room_id, old_debts)
        return Response(status_code=204)

    @router.post("/settlements", status_code=201)
    def request_settlement(room_id: int, data: SettlementCreate, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        membership(db, room_id, data.creditor_id)
        if data.creditor_id == user.id:
            raise HTTPException(422, "Cannot settle with yourself")
        _, debts, settlements = ledger(db, room_id)
        pending = sum(s.amount_minor for s in settlements if s.status == "requested" and
                      s.debtor_id == user.id and s.creditor_id == data.creditor_id)
        check_amount(data.amount_minor, debts.get((user.id, data.creditor_id), 0), pending)
        settlement = Settlement(room_id=room_id, debtor_id=user.id, creditor_id=data.creditor_id, amount_minor=data.amount_minor)
        db.add(settlement)
        db.flush()
        return columns(settlement)

    @router.post("/settlements/{item_id}/confirm")
    def confirm_settlement(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        settlement = resource(db, Settlement, room_id, item_id)
        if settlement.creditor_id != user.id:
            raise HTTPException(403, "Only the creditor can confirm receipt")
        if settlement.status == "requested":
            _, debts, settlements = ledger(db, room_id)
            pending = sum(s.amount_minor for s in settlements if s.id != settlement.id and s.status == "requested" and
                          (s.debtor_id, s.creditor_id) == (settlement.debtor_id, settlement.creditor_id))
            check_amount(settlement.amount_minor, debts.get((settlement.debtor_id, settlement.creditor_id), 0), pending)
            settlement.status, settlement.paid_at = "paid", utcnow()
            db.flush()
        return columns(settlement)

    @router.delete("/settlements/{item_id}", status_code=204)
    def cancel_settlement(room_id: int, item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        membership(db, room_id, user.id)
        settlement = resource(db, Settlement, room_id, item_id)
        if settlement.debtor_id != user.id:
            raise HTTPException(403, "Only the debtor can cancel a request")
        if settlement.status != "requested":
            raise HTTPException(409, "Paid settlements are immutable")
        db.delete(settlement)
        return Response(status_code=204)

    @router.get("/money")
    def money(room_id: int, user: User = Depends(current_user), db: Session = Depends(read_db)):
        membership(db, room_id, user.id)
        return money_out(db, room_id, user.id)

    @router.get("/today")
    def today(room_id: int, user: User = Depends(current_user), db: Session = Depends(read_db)):
        membership(db, room_id, user.id)
        local_date = utcnow().astimezone(KYIV).date()
        monday = local_date - timedelta(days=local_date.weekday())
        start = datetime.combine(monday, time(), KYIV).astimezone(timezone.utc)
        end = datetime.combine(monday + timedelta(days=7), time(), KYIV).astimezone(timezone.utc)
        chores = list(db.scalars(select(Chore).where(Chore.room_id == room_id).order_by(Chore.due_at, Chore.id)))
        week = [c for c in chores if start <= c.due_at < end]
        done = sum(c.status == "done" for c in week)
        items = list(db.scalars(select(ShoppingItem).where(ShoppingItem.room_id == room_id)))
        summary = money_out(db, room_id, user.id)
        return {"date": local_date, "week_start": monday,
                "chores": [chore_out(db, c) for c in chores if c.status != "done"][:3],
                "weekly_progress": {"done": done, "total": len(week), "percent": round(100 * done / len(week)) if week else 0},
                "money": {key: summary[key] for key in ("total_i_owe_minor", "total_owed_to_me_minor", "my_balance_minor")},
                "shopping": {"total": len(items), "done": sum(item.done for item in items),
                             "remaining": sum(not item.done for item in items)}}

    app.include_router(router)
