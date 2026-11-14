# Roomie

A roommate app for shared chores, expenses, shopping lists, room invites, customizable avatars, and notifications.

- **Frontend:** React, TypeScript, Vite
- **Backend:** Python, FastAPI, SQLAlchemy, JWT authentication
- **Database:** SQLite

## Requirements

- Python 3.11+
- Node.js 22.12+ (Node 24 works)

The commands below use **PowerShell** and start from this repository's root—the folder containing `frontend` and `backend`.

## First-time setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt

cd ..\frontend
npm.cmd ci
cd ..
```

## Run locally

Keep **two terminals** running.

### Terminal 1: backend

```powershell
cd backend
$env:JWT_SECRET = (.\.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(48))")
$env:DATABASE_URL = "sqlite:///./roomie.db"
.\.venv\Scripts\python -m uvicorn app.main:create_app --factory --reload
```

### Terminal 2: frontend

```powershell
cd frontend
npm.cmd run dev
```

- **App:** http://localhost:8443
- **API docs:** http://127.0.0.1:8000/docs

Register an account in the app, then create a room or join through an invite. Vite forwards `/api` requests to the backend on port 8000. Press `Ctrl+C` to stop either server.

In the same terminals, subsequent starts only need the server commands. A new backend terminal needs its environment variables set again.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `JWT_SECRET` | Backend environment | Required random secret of at least 32 bytes. Keep it stable across restarts to preserve login tokens. |
| `DATABASE_URL` | Backend environment | Defaults to `sqlite:///./roomie.db`, relative to the backend working directory. |
| `VITE_API_BASE_URL` | Frontend `.env.local` | Defaults to `/api/v1`; see `frontend/.env.example`. Restart Vite after changing it. |
| `PORT` | Frontend environment | Optional Vite port; defaults to `8443`. |

The startup example generates a new JWT secret each time; existing users must log in again afterward. Use a stable secret for deployment. `backend/.env.example` documents its variables, but backend `.env` files are **not loaded automatically**. Never put backend secrets in Vite variables or commit real environment files/databases.

## Existing databases

Fresh databases are created automatically. If using a database from before avatar settings or notifications were added, stop the backend and run these from `backend`, with the same `DATABASE_URL`:

```powershell
.\.venv\Scripts\python -m app.migrate_avatars
.\.venv\Scripts\python -m app.migrate_notifications
```

Both migrations create backups and preserve existing records. Restart the backend afterward. SQLite data persists in the database file; keep that file backed up.

## Checks

From `backend`:

```powershell
.\.venv\Scripts\python -m pytest
```

From `frontend`:

```powershell
npx.cmd tsc --noEmit --noUnusedLocals --noUnusedParameters
node --test tests/api.test.mjs tests/money.test.mjs tests/avatar.test.mjs tests/choreForm.test.mjs tests/notifications.test.mjs
npm.cmd run build
```

The frontend build is written to `frontend/dist`. Production hosting needs HTTPS, a stable JWT secret, persistent database storage, and an API reverse proxy or appropriate CORS configuration; the Vite dev proxy is development-only.

For endpoint details and browser checklists, see the [backend README](backend/README.md) and [frontend README](frontend/README.md).
