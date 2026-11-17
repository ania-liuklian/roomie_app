import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.database import make_engine


@pytest.fixture
def database_url(tmp_path, monkeypatch):
    test_url = os.getenv("ROOMIE_TEST_POSTGRES_URL")
    if not test_url:
        yield f"sqlite:///{tmp_path / 'roomie.db'}"
        return

    url = make_url(test_url)
    assert url.drivername == "postgresql+psycopg", "Use the psycopg test URL"
    schema = f"roomie_test_{uuid4().hex}"
    engine = make_engine(url)
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        isolated_url = url.update_query_dict({"options": f"-c search_path={schema}"})
        monkeypatch.setenv("DATABASE_URL", isolated_url.render_as_string(hide_password=False))
        config = Config(Path(__file__).resolve().parents[1] / "alembic.ini")
        command.upgrade(config, "head")
        yield isolated_url
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()
