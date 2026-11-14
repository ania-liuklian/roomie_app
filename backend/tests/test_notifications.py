from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import sqlite3

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import Base, make_engine
from app.main import create_app
from app.migrate_notifications import migrate
from app.models import Notification, Room, RoomInvite, RoomMember, User

SECRET = "notifications-test-secret-at-least-32-bytes"


@pytest.fixture
def api(tmp_path):
    app = create_app(f"sqlite:///{(tmp_path / 'notifications.db').as_posix()}", SECRET)
    with TestClient(app) as client:
        with app.state.sessions() as db:
            db.add_all([User(id=i, name=f"User {i}", email=f"user{i}@example.com", password_hash="test-only") for i in range(1, 5)])
            db.flush()
            db.add(Room(id=1, number="214", created_by_id=1))
            db.flush()
            db.add_all([RoomMember(room_id=1, user_id=i, role="owner" if i == 1 else "member") for i in (1, 2, 3)])
            db.add(RoomInvite(room_id=1, code="join-code", created_by_id=1))
            db.commit()
        def request(method, path, uid=1, **kwargs):
            if uid is not None:
                now = datetime.now(timezone.utc)
                token = jwt.encode({"sub": str(uid), "iat": now, "exp": now + timedelta(minutes=30), "iss": "roomie", "aud": "roomie-api"}, SECRET, algorithm="HS256")
                kwargs["headers"] = {"Authorization": f"Bearer {token}"}
            return client.request(method, "/api/v1" + path, **kwargs)
        yield request, app


def inbox(api, uid):
    response = api[0]("GET", "/notifications", uid)
    assert response.status_code == 200
    return response.json()


def chore(api, **changes):
    response = api[0]("POST", "/rooms/1/chores", json={"title": "Clean", "owner_id": 2, "due_at": "2026-11-18T18:00:00+02:00"} | changes)
    assert response.status_code == 201
    return response.json()


def expense(api, **changes):
    response = api[0]("POST", "/rooms/1/expenses", json={"title": "Water", "amount_minor": 10000, "participant_ids": [1, 2]} | changes)
    assert response.status_code == 201
    return response.json()


def test_assignment_reassignment_and_self_action_exclusion(api):
    request, _ = api
    item = chore(api)
    assert inbox(api, 1)["items"] == []
    assigned = inbox(api, 2)
    assert assigned["unread_count"] == 1
    assert assigned["items"][0]["kind"] == "chore_assigned"
    assert assigned["items"][0]["chore_id"] == item["id"]
    assert "password_hash" not in assigned["items"][0]["actor"]
    assert request("PATCH", f"/rooms/1/chores/{item['id']}", json={"title": "Updated"}).status_code == 200
    assert inbox(api, 2)["total"] == 1
    request("PATCH", f"/rooms/1/chores/{item['id']}", json={"owner_id": 3})
    assert inbox(api, 3)["total"] == 1
    request("PATCH", f"/rooms/1/chores/{item['id']}", 2, json={"owner_id": 2})
    assert inbox(api, 2)["total"] == 1
    chore(api, owner_id=1)
    assert inbox(api, 1)["total"] == 0


def test_weekly_rotation_notifies_next_assignee_exactly_once(api):
    request, _ = api
    item = chore(api, owner_id=1, repeat="weekly", rotation="rotate", rotation_ids=[1, 2])
    for _ in range(2):
        assert request("POST", f"/rooms/1/chores/{item['id']}/complete").status_code == 200
    assert inbox(api, 1)["total"] == 0
    assigned = inbox(api, 2)["items"]
    assert len(assigned) == 1 and assigned[0]["chore_id"] != item["id"]


def test_expense_participants_added_on_edit_and_no_note_disclosure(api):
    request, _ = api
    item = expense(api, note="PRIVATE PAYMENT DETAILS")
    assert inbox(api, 1)["total"] == 0
    assert inbox(api, 2)["items"][0]["kind"] == "expense_added"
    assert inbox(api, 3)["total"] == 0
    assert "PRIVATE PAYMENT DETAILS" not in request("GET", "/notifications", 2).text
    assert request("PATCH", f"/rooms/1/expenses/{item['id']}", json={"participant_ids": [1, 2, 3]}).status_code == 200
    assert inbox(api, 2)["total"] == 1 and inbox(api, 3)["total"] == 1
    assert request("PATCH", f"/rooms/1/expenses/{item['id']}", json={"note": "Updated note"}).status_code == 200
    assert inbox(api, 3)["total"] == 1
    assert request("POST", "/rooms/1/expenses", json={"title": "Invalid", "amount_minor": 100, "participant_ids": [2, 2]}).status_code == 422
    assert inbox(api, 2)["total"] == 1


def test_repayment_report_and_confirm_notify_only_other_party(api):
    request, _ = api
    expense(api)
    reported = request("POST", "/rooms/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 5000})
    assert reported.status_code == 201
    sid = reported.json()["id"]
    assert [n["kind"] for n in inbox(api, 1)["items"]] == ["repayment_reported"]
    assert inbox(api, 2)["total"] == 1  # only the earlier expense
    assert request("POST", f"/rooms/1/settlements/{sid}/confirm", 2).status_code == 403
    assert inbox(api, 2)["total"] == 1
    for _ in range(2):
        assert request("POST", f"/rooms/1/settlements/{sid}/confirm").status_code == 200
    assert inbox(api, 2)["items"][0]["kind"] == "repayment_confirmed"
    assert inbox(api, 2)["total"] == 2 and inbox(api, 1)["total"] == 1
    assert inbox(api, 3)["total"] == 0
    assert request("POST", "/rooms/1/settlements", 2, json={"creditor_id": 1, "amount_minor": 1}).status_code == 409
    assert inbox(api, 1)["total"] == 1


def test_concurrent_join_notifies_existing_members_once_without_notifying_joiner(api):
    request, _ = api
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: request("POST", "/invites/join-code/join", 4), range(2)))
    assert all(response.status_code == 200 for response in responses)
    for uid in (1, 2, 3):
        messages = inbox(api, uid)["items"]
        assert len(messages) == 1 and messages[0]["kind"] == "room_joined" and messages[0]["actor_id"] == 4
    assert inbox(api, 4)["total"] == 0
    request("POST", "/invites/join-code/join", 4)
    assert inbox(api, 1)["total"] == 1


def test_ownership_unread_counts_order_pagination_and_idempotent_read(api):
    request, app = api
    chore(api)
    chore(api)
    messages = inbox(api, 2)
    assert messages["unread_count"] == messages["total"] == 2
    ids = [item["id"] for item in messages["items"]]
    assert ids == sorted(ids, reverse=True)
    item_id = ids[0]
    assert request("POST", f"/notifications/{item_id}/read", 1).status_code == 404
    assert request("POST", "/notifications/99999/read", 2).status_code == 404
    first = request("POST", f"/notifications/{item_id}/read", 2).json()
    second = request("POST", f"/notifications/{item_id}/read", 2).json()
    assert first["read_at"] == second["read_at"] and first["read_at"] is not None
    page = request("GET", "/notifications?limit=1&offset=1", 2).json()
    assert len(page["items"]) == 1 and page["unread_count"] == 1 and page["total"] == 2
    assert request("GET", "/notifications?limit=101", 2).status_code == 422
    assert request("POST", "/notifications/read-all", 1).json()["updated_count"] == 0
    assert inbox(api, 2)["unread_count"] == 1
    assert request("POST", "/notifications/read-all", 2).json() == {"updated_count": 1, "unread_count": 0}
    assert request("POST", "/notifications/read-all", 2).json()["updated_count"] == 0
    assert inbox(api, 2)["unread_count"] == 0
    with app.state.sessions() as db:
        assert all(n.recipient_id != n.actor_id for n in db.scalars(select(Notification)))


@pytest.mark.parametrize("method,path", [("GET", "/notifications"), ("POST", "/notifications/read-all"), ("POST", "/notifications/1/read")])
def test_notification_routes_require_auth(api, method, path):
    assert api[0](method, path, None).status_code == 401


def test_deleted_resource_clears_link_and_failed_transaction_rolls_back_notifications(api):
    request, app = api
    item = chore(api)
    assert request("DELETE", f"/rooms/1/chores/{item['id']}").status_code == 204
    assert inbox(api, 2)["items"][0]["chore_id"] is None
    from app.notifications import notify
    with app.state.sessions() as db:
        notify(db, [2], 1, "chore_assigned", 1)
        db.flush()
        db.rollback()
    assert inbox(api, 2)["total"] == 1


def test_notifications_migration_preserves_records_and_does_not_backfill(tmp_path):
    path = tmp_path / "old.db"
    engine = make_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine, tables=[table for table in Base.metadata.sorted_tables if table.name != "notifications"])
    with Session(engine) as db:
        db.add(User(id=1, name="Existing", email="old@example.com", password_hash="existing-hash"))
        db.commit()
    engine.dispose()
    backup = migrate(path)
    with sqlite3.connect(backup) as db:
        assert not db.execute("SELECT name FROM sqlite_master WHERE name='notifications'").fetchall()
    migrate(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT name,password_hash FROM users").fetchone() == ("Existing", "existing-hash")
        assert db.execute("SELECT COUNT(*) FROM notifications").fetchone()[0] == 0
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
