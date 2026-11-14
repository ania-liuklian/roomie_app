from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import create_app
from app.models import Chore, ExpenseShare, Room, RoomMember, Settlement, User

SECRET = "domain-tests-secret-with-at-least-32-bytes"
DUE = "2026-11-14T18:00:00+02:00"


@pytest.fixture
def api(tmp_path):
    app = create_app(f"sqlite:///{(tmp_path / 'routes.db').as_posix()}", SECRET)
    with TestClient(app) as client:
        with app.state.sessions() as db:
            db.add_all([User(id=i, email=f"member{i}@example.com", name=f"Member {i}", password_hash="unused") for i in range(1, 6)])
            db.flush()
            db.add_all([Room(id=1, number="214", created_by_id=1), Room(id=2, number="38", created_by_id=1)])
            db.flush()
            db.add_all([RoomMember(room_id=1, user_id=i, role="owner" if i == 1 else "member") for i in range(1, 5)])
            db.add(RoomMember(room_id=2, user_id=1, role="owner"))
            db.commit()

        def request(method, path, uid=1, **kwargs):
            now = datetime.now(timezone.utc)
            if uid is not None:
                token = jwt.encode({"sub": str(uid), "iat": now, "exp": now + timedelta(minutes=30),
                                    "iss": "roomie", "aud": "roomie-api"}, SECRET, algorithm="HS256")
                kwargs["headers"] = {"Authorization": f"Bearer {token}"}
            return client.request(method, f"/api/v1/rooms{path}", **kwargs)

        yield request, app


def chore(api, uid=1, room=1, **changes):
    response = api[0]("POST", f"/{room}/chores", uid, json={"title": "Clean", "owner_id": uid, "due_at": DUE} | changes)
    assert response.status_code == 201, response.text
    return response.json()


def expense(api, uid=1, room=1, **changes):
    response = api[0]("POST", f"/{room}/expenses", uid, json={"title": "Water", "amount_minor": 10000, "participant_ids": [1, 2]} | changes)
    assert response.status_code == 201, response.text
    return response.json()


ROUTES = [
    ("GET", "/chores", None),
    ("POST", "/chores", {"title": "Clean", "owner_id": 1, "due_at": DUE}),
    ("PATCH", "/chores/1", {"title": "New"}),
    ("DELETE", "/chores/1", None),
    ("POST", "/chores/1/accept", None),
    ("POST", "/chores/1/complete", None),
    ("POST", "/chores/1/reopen", None),
    ("GET", "/shopping-items", None),
    ("POST", "/shopping-items", {"title": "Soap"}),
    ("PATCH", "/shopping-items/1", {"done": True}),
    ("DELETE", "/shopping-items/1", None),
    ("GET", "/expenses", None),
    ("POST", "/expenses", {"title": "Water", "amount_minor": 100, "participant_ids": [1, 2]}),
    ("GET", "/expenses/1", None),
    ("PATCH", "/expenses/1", {"amount_minor": 200}),
    ("DELETE", "/expenses/1", None),
    ("POST", "/settlements", {"creditor_id": 1, "amount_minor": 100}),
    ("POST", "/settlements/1/confirm", None),
    ("DELETE", "/settlements/1", None),
    ("GET", "/money", None),
    ("GET", "/today", None),
]


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_all_routes_require_auth_and_membership(api, method, path, body):
    request, _ = api
    kwargs = {"json": body} if body is not None else {}
    assert request(method, f"/1{path}", uid=None, **kwargs).status_code == 401
    assert request(method, f"/1{path}", uid=5, **kwargs).status_code == 403


def test_chore_filters_accept_complete_and_permissions(api):
    request, _ = api
    waiting = chore(api, owner_id=2)
    own = chore(api)
    assert waiting["status"] == "waiting" and own["status"] == "active"
    cid = waiting["id"]
    assert request("GET", "/1/chores?filter=waiting", 1).json() == []
    assert [c["id"] for c in request("GET", "/1/chores?filter=waiting", 2).json()] == [cid]
    assert len(request("GET", "/1/chores?filter=mine", 1).json()) == 1
    assert len(request("GET", "/1/chores", 3).json()) == 2
    assert request("GET", "/1/chores?filter=bad").status_code == 422
    assert request("POST", f"/1/chores/{cid}/accept", 1).status_code == 403
    assert request("POST", f"/1/chores/{cid}/complete", 2).status_code == 409
    assert request("POST", f"/1/chores/{cid}/accept", 2).json()["status"] == "active"
    assert request("POST", f"/1/chores/{cid}/accept", 2).status_code == 200
    assert request("POST", f"/1/chores/{cid}/complete", 1).status_code == 403
    assert request("POST", f"/1/chores/{cid}/complete", 2).json()["status"] == "done"
    assert request("POST", f"/1/chores/{cid}/complete", 2).status_code == 200
    assert request("POST", f"/1/chores/{cid}/accept", 2).status_code == 409
    assert [c["id"] for c in request("GET", "/1/chores?filter=done").json()] == [cid]
    assert request("POST", f"/1/chores/{cid}/reopen", 1).status_code == 403
    assert request("POST", f"/1/chores/{cid}/reopen", 2).json()["completed_at"] is None
    assert request("POST", f"/1/chores/{cid}/reopen", 2).status_code == 409


@pytest.mark.parametrize("rotation,ids,next_owner", [("rotate", [1, 3, 2], 3), ("same", [], 1)])
def test_weekly_rotation_idempotence_dst_and_reopen(api, rotation, ids, next_owner):
    request, _ = api
    original = chore(api, repeat="weekly", rotation=rotation, rotation_ids=ids, due_at="2026-03-22T18:00:00+02:00")
    cid = original["id"]
    for _ in range(2):
        assert request("POST", f"/1/chores/{cid}/complete").status_code == 200
    rows = request("GET", "/1/chores").json()
    assert len(rows) == 2
    successor = next(c for c in rows if c["previous_chore_id"] == cid)
    assert successor["owner_id"] == next_owner and successor["status"] == "waiting"
    # Same 18:00 Kyiv wall clock, now UTC+3 rather than UTC+2.
    assert datetime.fromisoformat(successor["due_at"]) == datetime(2026, 3, 29, 15, tzinfo=timezone.utc)
    assert request("POST", f"/1/chores/{cid}/reopen").status_code == 200
    assert len(request("GET", "/1/chores").json()) == 1
    assert request("POST", f"/1/chores/{cid}/complete").status_code == 200
    successor = next(c for c in request("GET", "/1/chores").json() if c["previous_chore_id"] == cid)
    assert request("POST", f"/1/chores/{successor['id']}/accept", next_owner).status_code == 200
    assert request("POST", f"/1/chores/{cid}/reopen").status_code == 409


def test_chore_edit_delete_and_validation(api):
    request, _ = api
    item = chore(api, uid=2)
    path = f"/1/chores/{item['id']}"
    assert request("PATCH", path, 3, json={"title": "New"}).status_code == 403
    assert request("DELETE", path, 3).status_code == 403
    changed = request("PATCH", path, 1, json={"title": "Changed", "owner_id": 3})
    assert changed.status_code == 200 and changed.json()["status"] == "waiting"
    assert changed.json()["rotation_ids"] == [3]
    assert request("PATCH", path, 1, json={"due_at": None}).status_code == 422
    assert request("DELETE", path, 2).status_code == 204
    assert request("POST", path + "/accept", 3).status_code == 404
    assert request("POST", "/1/chores", json={"title": " ", "owner_id": 1, "due_at": DUE}).status_code == 422
    for changes, code in [({"owner_id": 5}, 403), ({"difficulty": 6}, 422),
                          ({"due_at": "2026-01-01T18:00:00"}, 422),
                          ({"repeat": "weekly", "rotation": "rotate", "rotation_ids": [2, 3]}, 422),
                          ({"repeat": "weekly", "rotation": "rotate", "rotation_ids": [1, 1]}, 422),
                          ({"repeat": "weekly", "rotation": "rotate", "rotation_ids": [1, 5]}, 403)]:
        response = request("POST", "/1/chores", json={"title": "Clean", "owner_id": 1, "due_at": DUE} | changes)
        assert response.status_code == code
    assert request("GET", "/1/chores").json() == []  # failed writes rolled back


def test_completed_chore_history_is_preserved(api):
    request, _ = api
    item = chore(api, repeat="weekly")
    path = f"/1/chores/{item['id']}"
    request("POST", path + "/complete")
    assert request("PATCH", path, json={"title": "New"}).status_code == 409
    assert request("DELETE", path).status_code == 409
    successor = next(c for c in request("GET", "/1/chores").json() if c["previous_chore_id"])
    assert request("DELETE", f"/1/chores/{successor['id']}").status_code == 409
    assert request("PATCH", f"/1/chores/{successor['id']}", json={"title": "Edited"}).status_code == 200
    assert request("POST", path + "/reopen").status_code == 409


def test_shopping_crud_completion_and_undo(api):
    request, _ = api
    assert request("GET", "/1/shopping-items").json() == []
    created = request("POST", "/1/shopping-items", 2, json={"title": " Soap "})
    assert created.status_code == 201 and created.json()["title"] == "Soap"
    path = f"/1/shopping-items/{created.json()['id']}"
    result = request("PATCH", path, 3, json={"done": True}).json()
    assert result["buyer_id"] == 3 and result["completed_at"] is not None
    assert request("PATCH", path, 2, json={"done": True}).json()["buyer_id"] == 3
    undone = request("PATCH", path, 2, json={"done": False, "title": "Dish soap"}).json()
    assert undone["buyer_id"] is None and undone["completed_at"] is None
    assert undone["title"] == "Dish soap"
    assert request("PATCH", path, json={"buyer_id": 4}).status_code == 422
    assert request("PATCH", path, json={"done": "yes"}).status_code == 422
    assert request("DELETE", path, 4).status_code == 204
    assert request("PATCH", path, json={"done": True}).status_code == 404
    assert request("GET", "/1/shopping-items").json() == []


def test_expense_crud_exact_shares_and_permissions(api, caplog):
    request, _ = api
    note = "PRIVATE-NOTE-DO-NOT-LOG"
    created = expense(api, participant_ids=[3, 1, 2], note=note)
    assert created["payer_id"] == 1 and created["participant_ids"] == [1, 2, 3]
    assert created["shares"] == [{"user_id": 1, "share_minor": 3334}, {"user_id": 2, "share_minor": 3333}, {"user_id": 3, "share_minor": 3333}]
    path = f"/1/expenses/{created['id']}"
    assert request("GET", path, 2).json()["note"] == note
    assert request("GET", "/1/expenses", 2).json()[0]["id"] == created["id"]
    assert request("PATCH", path, 2, json={"amount_minor": 99}).status_code == 403
    assert request("DELETE", path, 2).status_code == 403
    edited = request("PATCH", path, json={"amount_minor": 101, "participant_ids": [2, 3], "note": ""})
    assert edited.status_code == 200
    assert edited.json()["shares"] == [{"user_id": 2, "share_minor": 51}, {"user_id": 3, "share_minor": 50}]
    assert request("DELETE", path).status_code == 204
    assert request("GET", path).status_code == 404
    assert request("GET", "/1/expenses").json() == []
    assert note not in caplog.text


@pytest.mark.parametrize("changes,status", [({"amount_minor": 1.1}, 422), ({"amount_minor": "100"}, 422),
    ({"amount_minor": 0}, 422), ({"participant_ids": []}, 422), ({"participant_ids": [1, 1]}, 422),
    ({"participant_ids": [1, 5]}, 403), ({"payer_id": 2}, 422), ({"occurred_at": "2026-01-01T12:00:00"}, 422)])
def test_expense_validation(api, changes, status):
    request, _ = api
    response = request("POST", "/1/expenses", json={"title": "Water", "amount_minor": 100, "participant_ids": [1, 2]} | changes)
    assert response.status_code == status
    assert request("GET", "/1/expenses").json() == []


def test_seed_money_summary_and_room_isolation(api):
    request, _ = api
    expense(api, amount_minor=68400, participant_ids=[1, 2, 3, 4])
    expense(api, uid=3, amount_minor=25800, participant_ids=[1, 2, 3])
    expense(api, uid=2, amount_minor=43200, participant_ids=[1, 2, 4])
    money = request("GET", "/1/money").json()
    assert {b["user_id"]: b["balance_minor"] for b in money["balances"]} == {1: 28300, 2: 3100, 3: 100, 4: -31500}
    assert {(d["debtor_id"], d["creditor_id"]): d["amount_minor"] for d in money["debts"]} == {
        (2, 1): 2700, (3, 1): 8500, (4, 1): 17100, (2, 3): 8600, (4, 2): 14400}
    assert money["total_i_owe_minor"] == 0 and money["total_owed_to_me_minor"] == 28300
    assert request("GET", "/2/money").json()["my_balance_minor"] == 0
    assert request("GET", "/2/expenses").json() == []


def test_settlement_partial_confirm_cancel_permissions_and_overpayment(api):
    request, _ = api
    expense(api)
    assert request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 5001}).status_code == 409
    first = request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 3000})
    assert first.status_code == 201 and first.json()["status"] == "requested"
    sid = first.json()["id"]
    money = request("GET", "/1/money", 2).json()
    assert money["total_i_owe_minor"] == 5000 and money["owed_by_me"][0]["requested_minor"] == 3000
    assert request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 2001}).status_code == 409
    second = request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 2000}).json()
    assert request("POST", f"/1/settlements/{sid}/confirm", 2).status_code == 403
    assert request("POST", f"/1/settlements/{sid}/confirm", 3).status_code == 403
    assert request("DELETE", f"/1/settlements/{sid}", 1).status_code == 403
    for _ in range(2):
        paid = request("POST", f"/1/settlements/{sid}/confirm").json()
        assert paid["status"] == "paid" and paid["paid_at"] is not None
    assert request("GET", "/1/money", 2).json()["total_i_owe_minor"] == 2000
    assert request("DELETE", f"/1/settlements/{sid}", 2).status_code == 409
    assert request("DELETE", f"/1/settlements/{second['id']}", 2).status_code == 204
    last = request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 2000}).json()
    assert request("POST", f"/1/settlements/{last['id']}/confirm").status_code == 200
    assert request("GET", "/1/money", 2).json()["total_i_owe_minor"] == 0
    assert request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 1}).status_code == 409


@pytest.mark.parametrize("uid,body,status", [(1, {"creditor_id": 1, "amount_minor": 1}, 422),
    (2, {"creditor_id": 5, "amount_minor": 1}, 403), (1, {"creditor_id": 2, "amount_minor": 1}, 409),
    (2, {"creditor_id": 1, "amount_minor": 0}, 422), (2, {"creditor_id": 1, "amount_minor": 1.5}, 422),
    (2, {"creditor_id": 1, "amount_minor": 1, "debtor_id": 3}, 422)])
def test_invalid_settlements(api, uid, body, status):
    expense(api)
    assert api[0]("POST", "/1/settlements", uid, json=body).status_code == status


def test_expense_changes_cannot_invalidate_pending_or_paid_settlements(api):
    request, _ = api
    item = expense(api)
    sid = request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 5000}).json()["id"]
    path = f"/1/expenses/{item['id']}"
    assert request("PATCH", path, json={"amount_minor": 9000}).status_code == 409
    assert request("DELETE", path).status_code == 409
    assert request("GET", path).json()["amount_minor"] == 10000
    # New opposite expense must not consume a pending reservation.
    assert request("POST", "/1/expenses", 2, json={"title": "Other", "amount_minor": 100, "participant_ids": [1]}).status_code == 409
    assert request("POST", f"/1/settlements/{sid}/confirm").status_code == 200
    assert request("PATCH", path, json={"amount_minor": 9000}).status_code == 409
    assert request("DELETE", path).status_code == 409
    assert request("PATCH", path, json={"note": "Updated"}).status_code == 200
    # New spending after repayment is allowed.
    expense(api, amount_minor=200)
    assert request("GET", "/1/money", 2).json()["total_i_owe_minor"] == 100


def test_confirmation_rechecks_current_outstanding(api):
    request, app = api
    item = expense(api)
    sid = request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 5000}).json()["id"]
    # Simulate a legacy/import change outside the protected HTTP write paths.
    with app.state.sessions() as db:
        db.get(ExpenseShare, (item["id"], 2)).share_minor = 1000
        db.commit()
    assert request("POST", f"/1/settlements/{sid}/confirm").status_code == 409
    with app.state.sessions() as db:
        assert db.get(Settlement, sid).status == "requested"


def test_concurrent_payments_do_not_overreserve_and_confirmation_is_idempotent(api):
    request, _ = api
    expense(api)
    def reserve(_):
        return request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 4000})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(reserve, range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
    sid = next(r.json()["id"] for r in responses if r.status_code == 201)
    with ThreadPoolExecutor(max_workers=2) as pool:
        confirmations = list(pool.map(lambda _: request("POST", f"/1/settlements/{sid}/confirm"), range(2)))
    assert [r.status_code for r in confirmations] == [200, 200]
    assert request("GET", "/1/money", 2).json()["total_i_owe_minor"] == 1000


def test_concurrent_completion_creates_one_occurrence(api):
    request, app = api
    item = chore(api, repeat="weekly", rotation="rotate", rotation_ids=[1, 2])
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: request("POST", f"/1/chores/{item['id']}/complete"), range(2)))
    assert [r.status_code for r in results] == [200, 200]
    with app.state.sessions() as db:
        assert len(list(db.scalars(select(Chore).where(Chore.previous_chore_id == item["id"])))) == 1


def test_today_local_week_boundaries_nearest_chores_and_counts(api, monkeypatch):
    import app.routes as routes
    request, _ = api
    monkeypatch.setattr(routes, "utcnow", lambda: datetime(2026, 11, 15, 22, 30, tzinfo=timezone.utc))
    assert request("GET", "/1/today").json()["weekly_progress"] == {"done": 0, "total": 0, "percent": 0}
    before = chore(api, due_at="2026-11-15T21:59:59Z")
    first = chore(api, due_at="2026-11-15T22:00:00Z")
    chore(api, due_at="2026-11-20T12:00:00Z")
    chore(api, due_at="2026-11-22T22:00:00Z")
    chore(api, due_at="2026-12-01T12:00:00Z")
    request("POST", f"/1/chores/{first['id']}/complete")
    shopping = request("POST", "/1/shopping-items", json={"title": "Soap"}).json()
    request("POST", "/1/shopping-items", json={"title": "Water"})
    request("PATCH", f"/1/shopping-items/{shopping['id']}", json={"done": True})
    expense(api)
    today = request("GET", "/1/today").json()
    assert today["date"] == "2026-11-16" and today["week_start"] == "2026-11-16"
    assert today["weekly_progress"] == {"done": 1, "total": 2, "percent": 50}
    assert len(today["chores"]) == 3 and today["chores"][0]["id"] == before["id"]
    assert today["shopping"] == {"total": 2, "done": 1, "remaining": 1}
    assert today["money"]["total_owed_to_me_minor"] == 5000
    assert request("GET", "/2/today").json()["chores"] == []


@pytest.mark.parametrize("kind,create", [("chores", lambda api: chore(api, room=2)),
                                       ("shopping-items", lambda api: api[0]("POST", "/2/shopping-items", json={"title": "Soap"}).json()),
                                       ("expenses", lambda api: expense(api, room=2, participant_ids=[1]))])
def test_resources_cannot_be_accessed_through_another_room(api, kind, create):
    request, _ = api
    item = create(api)
    path = f"/1/{kind}/{item['id']}"
    assert request("DELETE", path).status_code == 404
    assert request("PATCH", path, json={"title": "Forged"}).status_code == 404
    if kind == "expenses":
        assert request("GET", path).status_code == 404
    if kind == "chores":
        for action in ("accept", "complete", "reopen"):
            assert request("POST", f"{path}/{action}").status_code == 404


def test_settlements_are_scoped_to_room(api):
    request, _ = api
    expense(api)
    sid = request("POST", "/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 100}).json()["id"]
    assert request("POST", f"/2/settlements/{sid}/confirm").status_code == 404
    assert request("DELETE", f"/2/settlements/{sid}").status_code == 404


def test_rotation_wraps_and_skips_departed_members(api):
    request, app = api
    item = chore(api, uid=2, repeat="weekly", rotation="rotate", rotation_ids=[1, 3, 2])
    assert request("POST", f"/1/chores/{item['id']}/complete", 2).status_code == 200
    successor = next(c for c in request("GET", "/1/chores").json() if c["previous_chore_id"] == item["id"])
    assert successor["owner_id"] == 1  # end of ordered queue wraps to its start
    request("POST", f"/1/chores/{successor['id']}/accept", 1)
    with app.state.sessions() as db:
        db.delete(db.get(RoomMember, (1, 3)))
        db.commit()
    assert request("POST", f"/1/chores/{successor['id']}/complete", 1).status_code == 200
    next_item = next(c for c in request("GET", "/1/chores").json() if c["previous_chore_id"] == successor["id"])
    assert next_item["owner_id"] == 2 and next_item["rotation_ids"] == [1, 2]


def test_note_privacy_on_validation_failures(api, caplog):
    import logging
    request, _ = api
    marker = "NEVER-LOG-THIS-EXPENSE-NOTE"
    with caplog.at_level(logging.DEBUG):
        response = request("POST", "/1/expenses", json={"title": "Water", "amount_minor": 0,
                                                        "participant_ids": [1], "note": marker})
        assert response.status_code == 422
        assert marker not in response.text
        item = expense(api, note=marker)
        assert request("GET", f"/1/expenses/{item['id']}").json()["note"] == marker
    assert marker not in caplog.text


def test_missing_resources_and_openapi(api):
    request, app = api
    assert request("GET", "/999/chores").status_code == 404
    assert request("GET", "/1/expenses/999").status_code == 404
    assert request("POST", "/1/settlements/999/confirm").status_code == 404
    paths = app.openapi()["paths"]
    for method, suffix, _ in ROUTES:
        suffix = suffix.replace("/1/", "/{item_id}/")
        # Resource IDs at the end of a route need replacing too.
        if suffix.endswith("/1"):
            suffix = suffix[:-2] + "/{item_id}"
        assert method.lower() in paths[f"/api/v1/rooms/{{room_id}}{suffix}"]


def test_profile_stats_aggregate_only_my_rooms_and_current_members(api):
    request, app = api
    first = chore(api)
    request("POST", f"/1/chores/{first['id']}/complete")
    second = chore(api, room=2)
    request("POST", f"/2/chores/{second['id']}/complete")
    chore(api, owner_id=2)  # waiting counts toward unfinished workload
    chore(api, uid=2)  # active counts too
    chore(api, uid=3)
    # Access the app through a client with the same fixture database.
    with TestClient(app) as client:
        now = datetime.now(timezone.utc)
        def headers(uid):
            return {"Authorization": "Bearer " + jwt.encode({"sub": str(uid), "iat": now, "exp": now + timedelta(minutes=30), "iss": "roomie", "aud": "roomie-api"}, SECRET, algorithm="HS256")}
        stats = client.get("/api/v1/me/stats", headers=headers(1)).json()
        assert stats["room_count"] == 2 and stats["completed_chores"] == 2
        members = stats["workloads"][0]["members"]
        assert {m["user_id"]: m["unfinished_chores"] for m in members} == {1: 0, 2: 2, 3: 1, 4: 0}
        assert members[1]["workload_percent"] == 67
        assert stats["workloads"][1]["members"] == [{"user_id": 1, "unfinished_chores": 0, "workload_percent": 0}]
        other = client.get("/api/v1/me/stats", headers=headers(2)).json()
        assert other["room_count"] == 1 and other["completed_chores"] == 0
        assert [entry["room_id"] for entry in other["workloads"]] == [1]
        assert client.get("/api/v1/me/stats", headers=headers(5)).json() == {"room_count": 0, "completed_chores": 0, "workloads": []}
