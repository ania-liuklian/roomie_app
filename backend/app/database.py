from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool
from sqlalchemy.types import TypeDecorator


def utcnow():
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        return value.replace(tzinfo=timezone.utc) if value else None


class Base(DeclarativeBase):
    pass


def make_engine(url, *, connect_token=None):
    url = make_url(url)
    if url.get_backend_name() != "sqlite":
        engine = create_engine(
            url, hide_parameters=True, echo=False, poolclass=NullPool if connect_token else None,
        )
        if connect_token:
            @event.listens_for(engine, "do_connect")
            def authenticate(dialect, record, args, params):
                params["password"] = connect_token()
        return engine

    engine = create_engine(url, connect_args={"check_same_thread": False}, hide_parameters=True, echo=False)

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")

    return engine


def begin_snapshot(db):
    if db.bind.dialect.name == "sqlite":
        db.execute(text("BEGIN"))
    else:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


def begin_write(db):
    if db.bind.dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))
