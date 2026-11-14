"""Offline additive notifications migration; never backfill historical actions."""
import os
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from sqlalchemy import inspect
from sqlalchemy.engine import make_url
from .database import make_engine
from .models import Notification


def migrate(path: Path):
    path = path.resolve(strict=True)
    backup = path.with_name(path.name + "-notifications-backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f"))
    with sqlite3.connect(path) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    engine = make_engine(f"sqlite:///{path.as_posix()}")
    try:
        required = {"users", "rooms", "chores", "expenses", "settlements"}
        if not required.issubset(inspect(engine).get_table_names()):
            raise RuntimeError("Expected an existing Roomie database; start the app for a fresh database")
        Notification.__table__.create(engine, checkfirst=True)
    finally:
        engine.dispose()
    return backup


if __name__ == "__main__":
    url = make_url(os.getenv("DATABASE_URL", "sqlite:///./roomie.db"))
    if url.drivername != "sqlite" or not url.database or url.database == ":memory:":
        raise SystemExit("Migration requires a file-backed sqlite:/// DATABASE_URL")
    backup = migrate(Path(url.database))
    print(f"Notifications migration complete. Backup: {backup.name}")
