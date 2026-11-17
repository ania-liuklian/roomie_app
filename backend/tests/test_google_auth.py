"""No real Google secrets or external network required for API behavior tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import create_app
from app.models import GoogleIdentity, User

SECRET = "test-secret-for-roomie-google-signin-32-bytes"
GOOGLE_LOGIN = "/api/v1/auth/google"
GOOGLE_LINK = "/api/v1/auth/google/link"


@pytest.fixture
def client(database_url, monkeypatch):
    app = create_app(database_url, SECRET)
    monkeypatch.setattr("app.main.verify_google_credential", lambda _: {
        "sub": "google-stable-id-123", "email": "test@example.com",
        "name": "Test Google", "email_verified": True,
    })
    with TestClient(app) as client:
        yield client


def test_google_signup_repeat_login_and_original_jwt(client):
    response = client.post(GOOGLE_LOGIN, json={"credential": "verified-credential-token"})
    assert response.status_code == 200, response.text
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    me = client.get("/api/v1/me", headers=headers).json()
    assert me["email"] == "test@example.com"
    assert me["name"] == "Test Google"
    assert client.get("/api/v1/me/google", headers=headers).json() == {"linked": True}

    again = client.post(GOOGLE_LOGIN, json={"credential": "verified-credential-token"})
    assert again.status_code == 200
    headers2 = {"Authorization": f"Bearer {again.json()['access_token']}"}
    assert client.get("/api/v1/me", headers=headers2).json()["id"] == me["id"]
    # A randomly generated, unknown password is stored for Google-only users.
    assert client.post("/api/v1/auth/login", json={
        "email": "test@example.com", "password": "some-password",
    }).status_code == 401
    with client.app.state.sessions() as session:
        assert session.scalar(select(User)).id == me["id"]
        identity = session.get(GoogleIdentity, "google-stable-id-123")
        assert identity.user_id == me["id"]


def test_existing_password_user_must_explicitly_link(client):
    local = client.post("/api/v1/auth/register", json={
        "name": "Original", "email": "test@example.com", "password": "password123",
    })
    assert local.status_code == 201
    token = local.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/me/google", headers=headers).json() == {"linked": False}
    room = client.post("/api/v1/rooms", json={"number": "214"}, headers=headers)
    assert room.status_code == 201

    conflict = client.post(GOOGLE_LOGIN, json={"credential": "verified-credential-token"})
    assert conflict.status_code == 409
    assert client.post(GOOGLE_LINK, json={"credential": "verified-credential-token"}).status_code == 401
    assert client.post(GOOGLE_LINK, json={"credential": "verified-credential-token"}, headers=headers).json() == {"linked": True}
    assert client.get("/api/v1/me/google", headers=headers).json() == {"linked": True}
    assert client.post(GOOGLE_LINK, json={"credential": "verified-credential-token"}, headers=headers).json() == {"linked": True}

    google = client.post(GOOGLE_LOGIN, json={"credential": "verified-credential-token"})
    assert google.status_code == 200
    google_headers = {"Authorization": f"Bearer {google.json()['access_token']}"}
    assert client.get("/api/v1/me", headers=google_headers).json()["id"] == 1
    assert len(client.get("/api/v1/rooms", headers=google_headers).json()) == 1


def test_different_local_email_cannot_be_linked(client, monkeypatch):
    local = client.post("/api/v1/auth/register", json={
        "name": "Original", "email": "different@example.com", "password": "password123",
    })
    headers = {"Authorization": f"Bearer {local.json()['access_token']}"}
    assert client.post(GOOGLE_LINK, json={"credential": "verified-credential-token"}, headers=headers).status_code == 409
    # Email alone cannot be used to hijack an existing Google identity.
    client.post(GOOGLE_LOGIN, json={"credential": "verified-credential-token"})
    monkeypatch.setattr("app.main.verify_google_credential", lambda _: {
        "sub": "google-stable-id-123", "email": "changed-email@example.com",
        "name": "Test Google", "email_verified": True,
    })
    google = client.post(GOOGLE_LOGIN, json={"credential": "verified-credential-token"})
    assert google.status_code == 200
    gheaders = {"Authorization": f"Bearer {google.json()['access_token']}"}
    assert client.get("/api/v1/me", headers=gheaders).json()["email"] == "test@example.com"


def test_google_not_configured_and_unverified_is_rejected(monkeypatch):
    from app.google_auth import verify_google_credential
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        verify_google_credential("not-a-real-token")
    assert exc.value.status_code == 503

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
    monkeypatch.setattr("app.google_auth.id_token.verify_oauth2_token", lambda *_: {
        "email": "test@example.com", "sub": "123", "email_verified": False,
    })
    with pytest.raises(HTTPException) as exc:
        verify_google_credential("unverified")
    assert exc.value.status_code == 401



def test_google_key_transport_failure_is_service_unavailable(monkeypatch):
    from fastapi import HTTPException
    from google.auth.exceptions import TransportError

    from app.google_auth import verify_google_credential

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")

    def unavailable(*args):
        raise TransportError("test connection failure")

    monkeypatch.setattr("app.google_auth.id_token.verify_oauth2_token", unavailable)
    with pytest.raises(HTTPException) as exc:
        verify_google_credential("test-credential")
    assert exc.value.status_code == 503
