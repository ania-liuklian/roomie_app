from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import boto3
import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.database import make_engine
from app.main import create_app
from app.models import User


def test_rds_iam_token_is_signed_without_a_network_request(monkeypatch):
    rds = boto3.client("rds", region_name="eu-central-1",
                       aws_access_key_id="local-test-id", aws_secret_access_key="local-test-key",
                       aws_session_token="local-test-session")

    def network_call(*args, **kwargs):
        pytest.fail("Generating an IAM database token must not send an AWS API request")

    monkeypatch.setattr(rds._endpoint, "make_request", network_call)
    token = rds.generate_db_auth_token(DBHostname="writer.example.test", Port=5432, DBUsername="roomie_app")
    url = urlsplit(f"https://{token}")
    query = parse_qs(url.query)
    assert url.netloc == "writer.example.test:5432"
    assert query["Action"] == ["connect"]
    assert query["DBUser"] == ["roomie_app"]
    assert query["X-Amz-Expires"] == ["900"]


@pytest.fixture
def lambda_database(database_url):
    if not isinstance(database_url, URL):
        pytest.skip("Requires the local PostgreSQL integration database")
    application_name = f"roomie_lambda_test_{uuid4().hex}"
    url = database_url.update_query_dict({"application_name": application_name})
    app = create_app(url.set(password="unused"), "test-only-secret-with-at-least-32-bytes",
                     create_schema=False, connect_token=lambda: database_url.password)
    monitor = make_engine(database_url)
    try:
        yield app, monitor, application_name
    finally:
        monitor.dispose()


def test_lambda_database_checkouts_leave_no_idle_connection(lambda_database):
    app, monitor, name = lambda_database
    assert isinstance(app.state.engine.pool, NullPool)
    with TestClient(app) as client:
        registered = client.post("/api/v1/auth/register", json={
            "email": "runtime@example.com", "name": "Roomie", "password": "test-password",
        })
        headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
        room = client.post("/api/v1/rooms", json={"number": "214"}, headers=headers)
        room_id = room.json()["id"]
        assert client.post(f"/api/v1/rooms/{room_id}/shopping-items", json={"title": "Tea"}, headers=headers).status_code == 201
        assert client.get(f"/api/v1/rooms/{room_id}/today", headers=headers).status_code == 200
        with monitor.connect() as connection:
            count = connection.scalar(text("SELECT count(*) FROM pg_stat_activity WHERE application_name = :name"), {"name": name})
            assert count == 0


def test_failed_connect_has_read_retry_hint_and_uncertain_write_is_not_replayed(lambda_database, monkeypatch):
    app, monitor, _ = lambda_database
    payload = {"email": "runtime@example.com", "name": "Roomie", "password": "test-password"}
    with TestClient(app) as client:
        registered = client.post("/api/v1/auth/register", json=payload)
        headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}

        def paused_connection(*args):
            raise psycopg.OperationalError("simulated connect timeout")

        event.listen(app.state.engine, "do_connect", paused_connection)
        try:
            response = client.get("/api/v1/me", headers=headers)
            assert response.status_code == 503
            assert response.headers["Retry-After"] == "5"
        finally:
            event.remove(app.state.engine, "do_connect", paused_connection)

        original_commit = Session.commit
        commit_attempts = 0

        def lose_commit_response(session):
            nonlocal commit_attempts
            commit_attempts += 1
            original_commit(session)
            raise OperationalError(None, None, psycopg.OperationalError("simulated lost commit response"))

        monkeypatch.setattr(Session, "commit", lose_commit_response)
        second_user = payload | {"email": "saved@example.com"}
        response = client.post("/api/v1/auth/register", json=second_user)
        assert response.status_code == 503
        assert "Retry-After" not in response.headers
        assert commit_attempts == 1
        with Session(monitor) as session:
            assert session.scalar(select(func.count()).select_from(User).where(User.email == second_user["email"])) == 1
