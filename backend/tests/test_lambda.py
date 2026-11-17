import json

from unittest.mock import Mock

from fastapi.testclient import TestClient
from mangum import Mangum
from sqlalchemy import inspect
from sqlalchemy.pool import NullPool

from app import lambda_handler
from app.main import create_app


def http_api_event(method, path, body=None, token=None):
    headers = {"host": "example.test", "content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    return {
        "version": "2.0", "routeKey": "$default", "rawPath": path, "rawQueryString": "",
        "headers": headers,
        "requestContext": {"http": {"method": method, "path": path, "sourceIp": "127.0.0.1"}},
        "body": json.dumps(body) if body is not None else None, "isBase64Encoded": False,
    }


def test_http_api_v2_jwt_and_error_responses(tmp_path):
    url = f"sqlite:///{tmp_path / 'lambda.db'}"
    secret = "lambda-test-secret-with-at-least-32-bytes"
    app = create_app(url, secret, create_schema=False)
    with TestClient(app):
        assert not inspect(app.state.engine).get_table_names()

    with TestClient(create_app(url, secret)):
        pass
    invoke = Mangum(app, lifespan="off")

    def request(method, path, body=None, token=None):
        return invoke(http_api_event(method, path, body, token), None)

    assert request("GET", "/api/v1/healthz")["statusCode"] == 200
    unauthorized = request("GET", "/api/v1/me")
    assert unauthorized["statusCode"] == 401
    assert unauthorized["headers"]["www-authenticate"] == "Bearer"
    assert request("POST", "/api/v1/auth/register", {})["statusCode"] == 422
    registered = request("POST", "/api/v1/auth/register", {
        "email": "lambda@example.com", "name": "Roomie", "password": "test-password",
    })
    assert registered["statusCode"] == 201
    token = json.loads(registered["body"])["access_token"]
    me = request("GET", "/api/v1/me", token=token)
    assert me["statusCode"] == 200
    assert json.loads(me["body"])["email"] == "lambda@example.com"


def test_production_handler_uses_secrets_manager_and_starts_without_database(monkeypatch):
    settings = {
        "AWS_REGION": "eu-central-1",
        "ROOMIE_DB_HOST": "writer.example.test",
        "ROOMIE_DB_NAME": "roomie",
        "ROOMIE_DB_USER": "roomie_app",
        "ROOMIE_DB_CA": "/var/task/amazon-rds-ca.pem",
        "ROOMIE_JWT_SECRET_ARN": "arn:aws:secretsmanager:eu-central-1:123456789012:secret:test",
    }
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    rds = Mock()
    secrets = Mock()
    secrets.get_secret_value.return_value = {"SecretString": "lambda-test-secret-with-at-least-32-bytes"}
    clients = {"rds": rds, "secretsmanager": secrets}

    def aws_client(service, **options):
        assert options["region_name"] == "eu-central-1"
        if service == "secretsmanager":
            assert options["endpoint_url"] == "https://secretsmanager.eu-central-1.amazonaws.com"
        return clients[service]

    monkeypatch.setattr(lambda_handler.boto3, "client", aws_client)
    lambda_handler.adapter.cache_clear()
    try:
        health = lambda_handler.handler(http_api_event("GET", "/api/v1/healthz"), None)
        assert health["statusCode"] == 200
        assert json.loads(health["body"]) == {"status": "ok"}
        me = lambda_handler.handler(http_api_event("GET", "/api/v1/me"), None)
        assert me["statusCode"] == 401
        secrets.get_secret_value.assert_called_once_with(SecretId=settings["ROOMIE_JWT_SECRET_ARN"])
        rds.generate_db_auth_token.assert_not_called()
        engine = lambda_handler.adapter().app.state.engine
        assert engine.url.drivername == "postgresql+psycopg"
        assert engine.url.password is None
        assert engine.url.query["sslmode"] == "verify-full"
        assert engine.url.query["connect_timeout"] == "16"
        assert isinstance(engine.pool, NullPool)
    finally:
        lambda_handler.adapter.cache_clear()
