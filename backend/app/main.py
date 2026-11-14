import os
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta

import bcrypt
import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from .database import Base, make_engine, utcnow
from .models import Room, RoomInvite, RoomMember, User
from .schemas import Credentials, Register, RoomCreate, TokenOut, UserOut


def create_app(database_url=None, jwt_secret=None):
    secret = jwt_secret or os.getenv("JWT_SECRET", "")
    if len(secret.encode()) < 32:
        raise RuntimeError("Set JWT_SECRET to a random secret of at least 32 bytes")
    engine = make_engine(database_url or os.getenv("DATABASE_URL", "sqlite:///./roomie.db"))
    sessions = sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(app):
        Base.metadata.create_all(engine)
        yield
        engine.dispose()

    app = FastAPI(title="Roomie API", lifespan=lifespan)
    app.state.engine = engine
    app.state.sessions = sessions

    # Never echo validation input: future expense notes and passwords stay private.
    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": list(error["loc"]), "type": error["type"], "msg": error["msg"]}
            for error in exc.errors()
        ]})

    def db_session():
        with sessions() as session:
            yield session

    bearer = HTTPBearer(auto_error=False)

    def unauthorized():
        return HTTPException(401, "Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})

    def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(db_session)):
        if credentials is None:
            raise unauthorized()
        try:
            payload = jwt.decode(credentials.credentials, secret, algorithms=["HS256"],
                                 issuer="roomie", audience="roomie-api",
                                 options={"require": ["sub", "iat", "exp", "iss", "aud"]})
            uid = int(payload["sub"])
        except (jwt.PyJWTError, ValueError, TypeError):
            raise unauthorized()
        user = db.get(User, uid)
        if user is None:
            raise unauthorized()
        return user

    def token(user):
        now = utcnow()
        return {"access_token": jwt.encode({"sub": str(user.id), "iat": now,
                "exp": now + timedelta(minutes=30), "iss": "roomie", "aud": "roomie-api"}, secret, algorithm="HS256")}

    def require_member(db, room_id, user_id):
        if db.get(RoomMember, (room_id, user_id)) is None:
            raise HTTPException(404, "Room not found")

    def room_out(db, room):
        return {"id": room.id, "number": room.number, "accent": room.accent,
                "created_at": room.created_at, "updated_at": room.updated_at,
                "member_ids": list(db.scalars(select(RoomMember.user_id).where(RoomMember.room_id == room.id).order_by(RoomMember.user_id)))}

    @app.post("/api/v1/auth/register", response_model=TokenOut, status_code=201)
    def register(data: Register, db: Session = Depends(db_session)):
        user = User(email=data.email, name=data.name,
                    password_hash=bcrypt.hashpw(data.password.encode(), bcrypt.gensalt()).decode())
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Email already registered")
        return token(user)

    dummy_hash = bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt())

    @app.post("/api/v1/auth/login", response_model=TokenOut)
    def login(data: Credentials, db: Session = Depends(db_session)):
        user = db.scalar(select(User).where(User.email == data.email))
        valid = bcrypt.checkpw(data.password.encode(), user.password_hash.encode() if user else dummy_hash)
        if user is None or not valid:
            raise unauthorized()
        return token(user)

    @app.get("/api/v1/me", response_model=UserOut)
    def me(user: User = Depends(current_user)):
        return user

    @app.post("/api/v1/rooms", status_code=201)
    def create_room(data: RoomCreate, user: User = Depends(current_user), db: Session = Depends(db_session)):
        room = Room(number=data.number, accent=data.accent, created_by_id=user.id)
        db.add(room)
        db.flush()
        db.add(RoomMember(room_id=room.id, user_id=user.id, role="owner"))
        invite = RoomInvite(room_id=room.id, created_by_id=user.id, code=secrets.token_urlsafe(24))
        db.add(invite)
        db.commit()
        return {**room_out(db, room), "invite_code": invite.code}

    @app.get("/api/v1/rooms")
    def list_rooms(user: User = Depends(current_user), db: Session = Depends(db_session)):
        rooms = db.scalars(select(Room).join(RoomMember).where(RoomMember.user_id == user.id).order_by(Room.id))
        return [room_out(db, room) for room in rooms]

    @app.get("/api/v1/rooms/{room_id}")
    def get_room(room_id: int, user: User = Depends(current_user), db: Session = Depends(db_session)):
        require_member(db, room_id, user.id)
        return room_out(db, db.get(Room, room_id))

    @app.get("/api/v1/rooms/{room_id}/members", response_model=list[UserOut])
    def members(room_id: int, user: User = Depends(current_user), db: Session = Depends(db_session)):
        require_member(db, room_id, user.id)
        return list(db.scalars(select(User).join(RoomMember).where(RoomMember.room_id == room_id).order_by(User.id)))

    @app.get("/api/v1/rooms/{room_id}/invite")
    def get_invite(room_id: int, user: User = Depends(current_user), db: Session = Depends(db_session)):
        require_member(db, room_id, user.id)
        invite = db.scalar(select(RoomInvite).where(RoomInvite.room_id == room_id))
        return {"code": invite.code, "path": f"/invite/{invite.code}"}

    @app.get("/api/v1/invites/{code}")
    def preview(code: str, db: Session = Depends(db_session)):
        invite = db.scalar(select(RoomInvite).where(RoomInvite.code == code))
        if invite is None:
            raise HTTPException(404, "Invite not found")
        room = db.get(Room, invite.room_id)
        return {"number": room.number, "accent": room.accent}

    @app.post("/api/v1/invites/{code}/join")
    def join(code: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
        invite = db.scalar(select(RoomInvite).where(RoomInvite.code == code))
        if invite is None:
            raise HTTPException(404, "Invite not found")
        room_id = invite.room_id
        if db.get(RoomMember, (room_id, user.id)) is None:
            db.add(RoomMember(room_id=room_id, user_id=user.id))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                if db.get(RoomMember, (room_id, user.id)) is None:
                    raise
        return room_out(db, db.get(Room, room_id))

    return app
