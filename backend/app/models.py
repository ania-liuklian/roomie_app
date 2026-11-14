from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Integer, String, Text, UniqueConstraint

from .database import Base, UTCDateTime, utcnow


class Timestamps:
    created_at = Column(UTCDateTime, nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime, nullable=False, default=utcnow, onupdate=utcnow)


class User(Timestamps, Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(254), unique=True, nullable=False)
    password_hash = Column(String(100), nullable=False)
    name = Column(String(100), nullable=False)
    color = Column(String(7), nullable=False, default="#7063df")


class Room(Timestamps, Base):
    __tablename__ = "rooms"
    id = Column(Integer, primary_key=True)
    number = Column(String(12), nullable=False)
    accent = Column(String(7), nullable=False, default="#7063df")
    created_by_id = Column(ForeignKey("users.id"), nullable=False)


class RoomMember(Base):
    __tablename__ = "room_members"
    room_id = Column(ForeignKey("rooms.id"), primary_key=True)
    user_id = Column(ForeignKey("users.id"), primary_key=True)
    role = Column(String, nullable=False, default="member")
    joined_at = Column(UTCDateTime, nullable=False, default=utcnow)
    __table_args__ = (CheckConstraint("role IN ('owner','member')"),)


class RoomInvite(Base):
    __tablename__ = "room_invites"
    id = Column(Integer, primary_key=True)
    room_id = Column(ForeignKey("rooms.id"), nullable=False, unique=True)
    code = Column(String(64), nullable=False, unique=True)
    created_by_id = Column(ForeignKey("users.id"), nullable=False)
    created_at = Column(UTCDateTime, nullable=False, default=utcnow)


class Chore(Timestamps, Base):
    __tablename__ = "chores"
    id = Column(Integer, primary_key=True)
    room_id = Column(ForeignKey("rooms.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    owner_id = Column(ForeignKey("users.id"), nullable=False)
    created_by_id = Column(ForeignKey("users.id"), nullable=False)
    difficulty = Column(Integer, nullable=False)
    due_at = Column(UTCDateTime, nullable=False)
    status = Column(String, nullable=False, default="waiting")
    repeat = Column(String, nullable=False, default="once")
    rotation = Column(String, nullable=False, default="same")
    previous_chore_id = Column(ForeignKey("chores.id"), unique=True)
    accepted_at = Column(UTCDateTime)
    completed_at = Column(UTCDateTime)
    __table_args__ = (
        CheckConstraint("difficulty BETWEEN 1 AND 5"),
        CheckConstraint("status IN ('waiting','active','done')"),
        CheckConstraint("repeat IN ('once','weekly')"),
        CheckConstraint("rotation IN ('same','rotate')"),
    )


class ChoreRotationMember(Base):
    __tablename__ = "chore_rotation_members"
    chore_id = Column(ForeignKey("chores.id"), primary_key=True)
    user_id = Column(ForeignKey("users.id"), primary_key=True)
    position = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("chore_id", "position"), CheckConstraint("position >= 0"))


class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True)
    room_id = Column(ForeignKey("rooms.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    amount_minor = Column(Integer, nullable=False)
    payer_id = Column(ForeignKey("users.id"), nullable=False)
    note = Column(Text, nullable=False, default="")
    occurred_at = Column(UTCDateTime, nullable=False)
    created_at = Column(UTCDateTime, nullable=False, default=utcnow)
    __table_args__ = (CheckConstraint("amount_minor > 0"),)


class ExpenseShare(Base):
    __tablename__ = "expense_shares"
    expense_id = Column(ForeignKey("expenses.id"), primary_key=True)
    user_id = Column(ForeignKey("users.id"), primary_key=True)
    share_minor = Column(Integer, nullable=False)
    __table_args__ = (CheckConstraint("share_minor >= 0"),)


class Settlement(Base):
    __tablename__ = "settlements"
    id = Column(Integer, primary_key=True)
    room_id = Column(ForeignKey("rooms.id"), nullable=False, index=True)
    debtor_id = Column(ForeignKey("users.id"), nullable=False)
    creditor_id = Column(ForeignKey("users.id"), nullable=False)
    amount_minor = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="requested")
    requested_at = Column(UTCDateTime, nullable=False, default=utcnow)
    paid_at = Column(UTCDateTime)
    created_at = Column(UTCDateTime, nullable=False, default=utcnow)
    __table_args__ = (
        CheckConstraint("amount_minor > 0"), CheckConstraint("debtor_id != creditor_id"),
        CheckConstraint("status IN ('requested','paid')"),
        CheckConstraint("(status = 'paid' AND paid_at IS NOT NULL) OR (status = 'requested' AND paid_at IS NULL)"),
    )


class ShoppingItem(Timestamps, Base):
    __tablename__ = "shopping_items"
    id = Column(Integer, primary_key=True)
    room_id = Column(ForeignKey("rooms.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    done = Column(Boolean, nullable=False, default=False)
    buyer_id = Column(ForeignKey("users.id"))
    created_by_id = Column(ForeignKey("users.id"), nullable=False)
    completed_at = Column(UTCDateTime)
    __table_args__ = (CheckConstraint("(done = 0 AND buyer_id IS NULL AND completed_at IS NULL) OR (done = 1 AND buyer_id IS NOT NULL AND completed_at IS NOT NULL)"),)
