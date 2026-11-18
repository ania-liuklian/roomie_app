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
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from .database import Base, begin_snapshot, begin_write, make_engine, utcnow
from .models import Chore, GoogleIdentity, Room, RoomInvite, RoomMember, User, lock_room
from .schemas import Credentials, GoogleCredential, ProfileEdit, Register, RoomCreate, TokenOut, UserOut
from .notifications import install_notifications, notify
from .google_auth import verify_google_credential


def create_app(database_url=None, jwt_secret=None, *, create_schema=None, connect_token=None):
    secret = jwt_secret or os.getenv("JWT_SECRET", "")
    if len(secret.encode()) < 32:
        raise RuntimeError("Set JWT_SECRET to a random secret of at least 32 bytes")
    engine = make_engine(database_url or os.getenv("DATABASE_URL", "sqlite:///./roomie.db"),
                         connect_token=connect_token)
    if create_schema is None:
        create_schema = engine.dialect.name == "sqlite"
    sessions = sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(app):
        if create_schema:
            Base.metadata.create_all(engine)
        try:
            yield
        finally:
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

    @app.exception_handler(OperationalError)
    async def database_unavailable(request, exc):
        # A socket failure can also happen after COMMIT was sent. Never replay writes here.
        if engine.dialect.name == "postgresql":
            state = getattr(exc.orig, "sqlstate", None) or ""
            if not state or state.startswith("08") or state in {"57P01", "57P02", "57P03", "55P03", "57014"}:
                return JSONResponse(
                    status_code=503, content={"detail": "Database temporarily unavailable"},
                    headers={"Retry-After": "5"} if request.method in {"GET", "HEAD"} else None,
                )
        raise exc

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
        if db.get(Room, room_id) is None:
            raise HTTPException(404, "Room not found")
        if db.get(RoomMember, (room_id, user_id)) is None:
            raise HTTPException(403, "Room membership required")

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

    @app.post("/api/v1/auth/google", response_model=TokenOut)
    def login_with_google(data: GoogleCredential, db: Session = Depends(db_session)):
        claims = verify_google_credential(data.credential)
        google_sub = str(claims["sub"])
        email = str(claims["email"]).strip().lower()
        if not email or len(email) > 254 or len(google_sub) > 255:
            raise unauthorized()
        identity = db.get(GoogleIdentity, google_sub)
        if identity is not None:
            user = db.get(User, identity.user_id)
            if user is None:
                raise unauthorized()
            return token(user)
        # Never silently merge accounts based on an email address. Require the
        # current password session to explicitly link a pre-existing account.
        if db.scalar(select(User).where(User.email == email)) is not None:
            raise HTTPException(409, "Account exists. Sign in with password and link Google in your profile")
        name = str(claims.get("name") or email.split("@")[0]).strip()[:100]
        user = User(email=email, name=name or "Google user",
                    password_hash=bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt()).decode())
        try:
            db.add(user)
            db.flush()
            db.add(GoogleIdentity(google_sub=google_sub, user_id=user.id))
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Account registration conflict; retry sign-in") from None
        return token(user)

    @app.post("/api/v1/auth/google/link")
    def link_google(data: GoogleCredential, user: User = Depends(current_user), db: Session = Depends(db_session)):
        claims = verify_google_credential(data.credential)
        google_sub = str(claims["sub"])
        email = str(claims["email"]).strip().lower()
        if email != user.email or len(google_sub) > 255:
            raise HTTPException(409, "Google email must match your Roomie account email")
        existing = db.get(GoogleIdentity, google_sub)
        if existing:
            if existing.user_id != user.id:
                raise HTTPException(409, "Google account already linked to another user")
            return {"linked": True}
        linked = db.scalar(select(GoogleIdentity).where(GoogleIdentity.user_id == user.id))
        if linked is not None:
            raise HTTPException(409, "A different Google account is already linked")
        db.add(GoogleIdentity(google_sub=google_sub, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Google account linking conflict") from None
        return {"linked": True}

    @app.get("/api/v1/healthz")
    def health():
        return {"status": "ok"}

    @app.get("/api/v1/home")
    def home():
        return {"features": [
            {"id": "chores", "title": "Обов’язки",
             "description": "Розподіляйте справи й налаштовуйте чергування на щотижневі завдання."},
            {"id": "shopping", "title": "Покупки",
             "description": "Ведіть спільний список і відмічайте те, що вже купили."},
            {"id": "expenses", "title": "Витрати",
             "description": "Записуйте спільні витрати й бачте, хто кому винен."},
        ]}

    @app.get("/api/v1/me", response_model=UserOut)
    def me(user: User = Depends(current_user)):
        return user

    @app.get("/api/v1/me/google")
    def google_link_status(user: User = Depends(current_user), db: Session = Depends(db_session)):
        linked = db.scalar(select(GoogleIdentity.google_sub).where(GoogleIdentity.user_id == user.id)) is not None
        return {"linked": linked}

    @app.patch("/api/v1/me", response_model=UserOut)
    def update_me(data: ProfileEdit, user: User = Depends(current_user), db: Session = Depends(db_session)):
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(user, key, value)
        db.commit()
        return user

    @app.get("/api/v1/me/stats")
    def my_stats(user: User = Depends(current_user)):
        with sessions() as db:
            begin_snapshot(db)
            room_ids = list(db.scalars(select(RoomMember.room_id).where(RoomMember.user_id == user.id)))
            counts = db.execute(select(Chore.room_id, Chore.owner_id,
                func.sum(case((Chore.status == "done", 1), else_=0)),
                func.sum(case((Chore.status != "done", 1), else_=0)))
                .where(Chore.room_id.in_(room_ids)).group_by(Chore.room_id, Chore.owner_id)).all()
            completed = sum(done for _, uid, done, _ in counts if uid == user.id)
            unfinished = {(rid, uid): count for rid, uid, _, count in counts}
            workloads = []
            for rid in sorted(room_ids):
                ids = list(db.scalars(select(RoomMember.user_id).where(RoomMember.room_id == rid).order_by(RoomMember.user_id)))
                total = sum(unfinished.get((rid, uid), 0) for uid in ids)
                workloads.append({"room_id": rid, "members": [
                    {"user_id": uid, "unfinished_chores": unfinished.get((rid, uid), 0),
                     "workload_percent": round(100 * unfinished.get((rid, uid), 0) / total) if total else 0}
                    for uid in ids]})
            return {"room_count": len(room_ids), "completed_chores": completed, "workloads": workloads}

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
        user_id = user.id
        # Authenticate first, then serialize membership and notification creation.
        db.rollback()
        begin_write(db)
        invite = db.scalar(select(RoomInvite).where(RoomInvite.code == code))
        if invite is None:
            raise HTTPException(404, "Invite not found")
        room_id = invite.room_id
        if db.bind.dialect.name == "postgresql":
            lock_room(db, room_id)
        if db.get(RoomMember, (room_id, user_id)) is None:
            recipients = list(db.scalars(select(RoomMember.user_id).where(RoomMember.room_id == room_id)))
            db.add(RoomMember(room_id=room_id, user_id=user_id))
            notify(db, recipients, user_id, "room_joined", room_id)
            db.commit()
        return room_out(db, db.get(Room, room_id))

    from .routes import install_routes
    install_routes(app, sessions, current_user)
    install_notifications(app, sessions, current_user)
    return app
