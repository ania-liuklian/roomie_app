from datetime import timedelta

import bcrypt
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import utcnow
from app.main import create_app
from app.models import Room, RoomMember, User

SECRET = "test-only-secret-with-at-least-32-bytes"


@pytest.fixture
def client(tmp_path):
    app = create_app(f"sqlite:///{(tmp_path / 'test.db').as_posix()}", SECRET)
    with TestClient(app) as client:
        yield client


def register(client, email="sofia@example.com"):
    response = client.post("/api/v1/auth/register", json={"name": "Sofia", "email": email, "password": "password123"})
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_auth_hash_normalization_and_login(client):
    headers = register(client, "Sofia@example.com")
    me = client.get("/api/v1/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "sofia@example.com"
    assert "password_hash" not in me.json()
    with client.app.state.sessions() as db:
        user = db.scalar(select(User))
        assert user.password_hash != "password123"
        assert bcrypt.checkpw(b"password123", user.password_hash.encode())
        assert user.created_at.tzinfo is not None
    assert client.post("/api/v1/auth/register", json={"name": "Other", "email": "SOFIA@example.com", "password": "password123"}).status_code == 409
    assert client.post("/api/v1/auth/login", json={"email": "SOFIA@example.com", "password": "password123"}).status_code == 200
    for email in ["sofia@example.com", "missing@example.com"]:
        assert client.post("/api/v1/auth/login", json={"email": email, "password": "wrongpass"}).status_code == 401


def test_profile_update_and_stats_auth(client):
    assert client.patch("/api/v1/me", json={"name": "New"}).status_code == 401
    assert client.get("/api/v1/me/stats").status_code == 401
    headers = register(client)
    other = register(client, "other@example.com")
    result = client.patch("/api/v1/me", headers=headers, json={"name": " New Name ", "color": "#C48F78"})
    assert result.status_code == 200
    assert result.json()["name"] == "New Name" and result.json()["color"] == "#C48F78"
    assert "password_hash" not in result.json()
    assert client.get("/api/v1/me", headers=headers).json() == result.json()
    assert client.get("/api/v1/me", headers=other).json()["name"] == "Sofia"
    assert client.patch("/api/v1/me", headers=headers, json={"name": "Only Name"}).json()["color"] == "#C48F78"
    for payload in [{"name": " "}, {"name": None}, {"color": None}, {"color": "bad"}, {"email": "new@example.com"}, {"id": 2}, {"password_hash": "bad"}]:
        assert client.patch("/api/v1/me", headers=headers, json=payload).status_code == 422
    assert client.get("/api/v1/me/stats", headers=headers).json() == {"room_count": 0, "completed_chores": 0, "workloads": []}


def test_avatar_defaults_and_all_options(client):
    from app.avatar import PALETTE
    headers = register(client)
    user = client.get("/api/v1/me", headers=headers).json()
    assert (user["color"], user["eye_style"], user["gaze"]) == ("#BF8790", "plain", "straight")
    for color in PALETTE:
        result = client.patch("/api/v1/me", headers=headers, json={"color": color.lower(), "eye_style": "lashes", "gaze": "left"})
        assert result.status_code == 200 and result.json()["color"] == color
    for gaze in ("straight", "left", "right", "up", "happy", "sleepy"):
        assert client.patch("/api/v1/me", headers=headers, json={"gaze": gaze}).json()["gaze"] == gaze
    assert client.patch("/api/v1/me", headers=headers, json={"name": "New"}).json()["eye_style"] == "lashes"
    assert client.get("/api/v1/me", headers=headers).json()["gaze"] == "sleepy"


@pytest.mark.parametrize("payload", [{"color": "#123abc"}, {"color": "red"}, {"eye_style": "other"}, {"eye_style": None},
    {"gaze": "down"}, {"gaze": None}, {"gaze": "Happy"}, {"eye_style": 1}, {"gaze": "<script>"}])
def test_invalid_avatar_options_do_not_change_user(client, payload):
    headers = register(client)
    before = client.get("/api/v1/me", headers=headers).json()
    assert client.patch("/api/v1/me", headers=headers, json=payload).status_code == 422
    assert client.get("/api/v1/me", headers=headers).json() == before


def test_auth_rejects_invalid_tokens(client):
    register(client)
    now = utcnow()
    payload = {"sub": "1", "iat": now, "exp": now - timedelta(seconds=1), "iss": "roomie", "aud": "roomie-api"}
    tokens = ["invalid", jwt.encode(payload, SECRET, algorithm="HS256")]
    payload["exp"] = now + timedelta(minutes=1)
    tokens += [jwt.encode(payload, "wrong-secret-that-is-at-least-32-bytes", algorithm="HS256"),
               jwt.encode({"sub": "1"}, SECRET, algorithm="HS256")]
    payload["sub"] = "99999"
    tokens.append(jwt.encode(payload, SECRET, algorithm="HS256"))
    assert client.get("/api/v1/me").status_code == 401
    for token in tokens:
        assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


@pytest.mark.parametrize("change", [{"email": "bad"}, {"name": " "}, {"password": "s3cr3t!"}, {"password": "я" * 37}])
def test_registration_validation_does_not_echo_input(client, change):
    data = {"name": "Sofia", "email": "sofia@example.com", "password": "password123"} | change
    response = client.post("/api/v1/auth/register", json=data)
    assert response.status_code == 422
    assert "input" not in response.text
    assert data["password"] not in response.text


def test_rooms_invites_access_and_idempotent_join(client):
    owner = register(client)
    other = register(client, "marko@example.com")
    assert client.post("/api/v1/rooms", json={"number": "214"}).status_code == 401
    created = client.post("/api/v1/rooms", json={"number": "214"}, headers=owner)
    assert created.status_code == 201
    room = created.json()
    rid, code = room["id"], room["invite_code"]
    assert len(code) >= 32 and code != f"{rid}-214"
    assert room["member_ids"] == [1]
    assert room["created_at"].endswith("Z") or room["created_at"].endswith("+00:00")
    assert client.get("/api/v1/rooms", headers=other).json() == []
    for suffix in ["", "/members", "/invite"]:
        assert client.get(f"/api/v1/rooms/{rid}{suffix}", headers=other).status_code == 403
    preview = client.get(f"/api/v1/invites/{code}")
    assert preview.json() == {"number": "214", "accent": "#7063df"}
    assert client.get(f"/api/v1/rooms/{rid}/invite", headers=owner).json()["code"] == code
    assert client.post(f"/api/v1/invites/{code}/join").status_code == 401
    for _ in range(2):
        assert client.post(f"/api/v1/invites/{code}/join", headers=other).json()["member_ids"] == [1, 2]
    members = client.get(f"/api/v1/rooms/{rid}/members", headers=other).json()
    assert len(members) == 2 and all("password_hash" not in member for member in members)
    assert len(client.get("/api/v1/rooms", headers=other).json()) == 1
    assert client.post("/api/v1/invites/unknown/join", headers=other).status_code == 404
    assert client.get("/api/v1/invites/unknown").status_code == 404
    second = client.post("/api/v1/rooms", json={"number": "214"}, headers=owner).json()
    assert second["invite_code"] != code
    with client.app.state.sessions() as db:
        assert db.get(RoomMember, (rid, 1)).role == "owner"
        assert db.get(RoomMember, (rid, 2)).role == "member"


def test_sqlite_foreign_keys_and_room_validation(client):
    headers = register(client)
    assert client.post("/api/v1/rooms", json={"number": " "}, headers=headers).status_code == 422
    assert client.post("/api/v1/rooms", json={"number": "214", "accent": "bad"}, headers=headers).status_code == 422
    with client.app.state.sessions() as db:
        db.add(Room(number="bad", created_by_id=999))
        with pytest.raises(IntegrityError):
            db.commit()


def test_secret_is_required(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        create_app()
