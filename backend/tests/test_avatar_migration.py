import sqlite3
import pytest
from app.migrate_avatars import migrate


def test_additive_avatar_migration_backup_preserves_data_and_is_repeatable(tmp_path):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as db:
        db.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, password_hash TEXT, color TEXT);
            CREATE TABLE refs(user_id INTEGER REFERENCES users(id));
            INSERT INTO users VALUES (1, 'Original', 'original-hash', '#7063df');
            INSERT INTO users VALUES (2, 'Second', 'other-hash', '#c48f78');
            INSERT INTO refs VALUES(1);
        """)
    backup = migrate(path)
    with sqlite3.connect(backup) as db:
        assert "eye_style" not in {row[1] for row in db.execute("PRAGMA table_info(users)")}
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT name,password_hash,color,eye_style,gaze FROM users WHERE id=1").fetchone() == ("Original", "original-hash", "#BF8790", "plain", "straight")
        assert db.execute("SELECT color FROM users WHERE id=2").fetchone()[0] == "#C48F78"
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        db.execute("UPDATE users SET gaze='sleepy',eye_style='lashes' WHERE id=1")
    migrate(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT gaze,eye_style FROM users WHERE id=1").fetchone() == ("sleepy", "lashes")
        for statement in ["UPDATE users SET color='#123abc'", "UPDATE users SET gaze='down'", "UPDATE users SET eye_style='invalid'"]:
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(statement)
