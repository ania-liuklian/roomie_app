"""Offline, additive SQLite migration. Run from backend: python -m app.migrate_avatars."""
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timezone
from sqlalchemy.engine import make_url
from .avatar import PALETTE, DEFAULT_COLOR


def migrate(path: Path):
    path = path.resolve(strict=True)
    backup = path.with_name(path.name + "-avatar-backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f"))
    with sqlite3.connect(path) as db:
        with sqlite3.connect(backup) as target:
            db.backup(target)
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        fields = {row[1] for row in db.execute("PRAGMA table_info(users)")}
        if not fields:
            raise RuntimeError("No users table; start the application to create a fresh database instead")
        if "eye_style" not in fields:
            db.execute("ALTER TABLE users ADD COLUMN eye_style VARCHAR(10) NOT NULL DEFAULT 'plain' CHECK (eye_style IN ('plain','lashes'))")
        if "gaze" not in fields:
            db.execute("ALTER TABLE users ADD COLUMN gaze VARCHAR(10) NOT NULL DEFAULT 'straight' CHECK (gaze IN ('straight','left','right','up','happy','sleepy'))")
        allowed = ",".join(repr(color) for color in PALETTE)
        db.execute(f"UPDATE users SET color = CASE WHEN UPPER(color) IN ({allowed}) THEN UPPER(color) ELSE ? END", (DEFAULT_COLOR,))
        # SQLite cannot add a CHECK to an existing column without rebuilding the table.
        # Triggers enforce the same palette on legacy tables, preserving all foreign keys.
        for operation in ("INSERT", "UPDATE"):
            db.execute(f"CREATE TRIGGER IF NOT EXISTS avatar_color_{operation.lower()} BEFORE {operation} ON users "
                       f"WHEN NEW.color NOT IN ({allowed}) BEGIN SELECT RAISE(ABORT, 'Invalid avatar color'); END")
    return backup


if __name__ == "__main__":
    url = make_url(os.getenv("DATABASE_URL", "sqlite:///./roomie.db"))
    if url.drivername != "sqlite" or not url.database or url.database == ":memory:":
        raise SystemExit("Migration requires a file-backed sqlite:/// DATABASE_URL")
    backup = migrate(Path(url.database))
    print(f"Avatar migration complete. Backup: {backup.name}")
