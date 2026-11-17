import logging

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import Base, make_engine, utcnow
from app.models import Chore, ChoreRotationMember, Expense, ExpenseShare, Room, Settlement, ShoppingItem, User
from sqlalchemy.orm import Session


def test_domain_tables_persistence_timestamps_and_note_privacy(database_url, caplog):
    engine = make_engine(database_url)
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(engine)
    note = "PRIVATE-EXPENSE-NOTE-4441"
    with caplog.at_level(logging.DEBUG), Session(engine) as db:
        db.add_all([User(id=1, email="one@example.com", name="One", password_hash="unused"),
                    User(id=2, email="two@example.com", name="Two", password_hash="unused")])
        db.flush()
        db.add(Room(id=1, number="214", created_by_id=1))
        db.flush()
        db.add(Chore(id=1, room_id=1, title="Clean", owner_id=1, created_by_id=2,
                     difficulty=3, due_at=utcnow(), repeat="weekly", rotation="rotate"))
        db.add(Expense(id=1, room_id=1, title="Water", amount_minor=100, payer_id=1,
                       note=note, occurred_at=utcnow()))
        db.flush()
        db.add_all([ChoreRotationMember(chore_id=1, user_id=1, position=0),
                    ExpenseShare(expense_id=1, user_id=2, share_minor=100),
                    Settlement(room_id=1, debtor_id=2, creditor_id=1, amount_minor=50),
                    ShoppingItem(room_id=1, title="Soap", created_by_id=1)])
        db.commit()
        db.expire_all()
        assert db.get(Expense, 1).note == note
        assert db.get(Chore, 1).due_at.tzinfo is not None
        assert db.scalar(select(Settlement)).status == "requested"
        assert db.scalar(select(ShoppingItem)).done is False
        assert note not in caplog.text
        assert engine.hide_parameters is True and engine.echo is False
        db.add(Settlement(room_id=1, debtor_id=1, creditor_id=1, amount_minor=0))
        with pytest.raises(IntegrityError):
            db.commit()
    engine.dispose()
