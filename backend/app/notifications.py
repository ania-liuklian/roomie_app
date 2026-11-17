"""In-app events only; never store expense notes or send external messages."""
from fastapi import Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .database import begin_snapshot, begin_write, utcnow
from .models import Notification, User
from .schemas import UserOut

MESSAGES = {
    "chore_assigned": "Вам призначено обов’язок.",
    "expense_added": "Вас додано до спільної витрати.",
    "repayment_reported": "Мешканець повідомив про повернення боргу.",
    "repayment_confirmed": "Повернення вашого боргу підтверджено.",
    "room_joined": "До вашої кімнати приєднався новий мешканець.",
}


def notify(db, recipients, actor_id, kind, room_id, **resource):
    for recipient_id in sorted(set(recipients) - {actor_id}):
        db.add(Notification(recipient_id=recipient_id, actor_id=actor_id, kind=kind, room_id=room_id, **resource))


def notification_out(db, item):
    return {column.name: getattr(item, column.name) for column in item.__table__.columns} | {
        "message": MESSAGES[item.kind], "actor": UserOut.model_validate(db.get(User, item.actor_id)).model_dump(),
    }


def install_notifications(app, sessions, current_user):
    def read_db():
        with sessions() as db:
            begin_snapshot(db)
            yield db

    def write_db():
        with sessions() as db:
            begin_write(db)
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    @app.get("/api/v1/notifications")
    def list_notifications(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
                           user: User = Depends(current_user), db: Session = Depends(read_db)):
        owned = Notification.recipient_id == user.id
        items = list(db.scalars(select(Notification).where(owned).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).offset(offset)))
        return {"items": [notification_out(db, item) for item in items],
                "unread_count": db.scalar(select(func.count()).select_from(Notification).where(owned, Notification.read_at.is_(None))),
                "total": db.scalar(select(func.count()).select_from(Notification).where(owned))}

    @app.post("/api/v1/notifications/read-all")
    def read_all(user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        result = db.execute(update(Notification).where(Notification.recipient_id == user.id, Notification.read_at.is_(None)).values(read_at=utcnow()))
        return {"updated_count": result.rowcount, "unread_count": 0}

    @app.post("/api/v1/notifications/{item_id}/read")
    def read_one(item_id: int, user: User = Depends(current_user), db: Session = Depends(write_db, scope="function")):
        item = db.scalar(select(Notification).where(
            Notification.id == item_id, Notification.recipient_id == user.id
        ).with_for_update())
        if item is None:
            raise HTTPException(404, "Notification not found")
        if item.read_at is None:
            item.read_at = utcnow()
            db.flush()
        return notification_out(db, item)
