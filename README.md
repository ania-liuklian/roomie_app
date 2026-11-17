# Roomie

Roomie is a Ukrainian-language app for shared chores, expenses and repayments, shopping lists, room invites, avatars, and notifications. The Vite frontend calls the FastAPI backend under `/api/v1`.

## Local development

Use Python 3.12 (the Lambda runtime) and Node.js 22.12 or later. These commands use a POSIX shell. On Windows, replace `source .venv/bin/activate` with `.\.venv\Scripts\Activate.ps1` and use `$env:NAME = "value"` to set environment variables.

In the backend terminal:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

export JWT_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export DATABASE_URL=sqlite:///./roomie.db
python -m uvicorn app.main:create_app --factory --reload
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open [Roomie](http://localhost:8443) and [the API docs](http://127.0.0.1:8000/docs). Vite proxies `/api` to port 8000. Keep the JWT secret stable across restarts if you want existing sessions to survive. The backend reads process environment variables. Use `backend/.env.example` and `frontend/.env.example` as references.

### Local PostgreSQL 16

From the root, start the separate PostgreSQL service. It listens on loopback and uses a disposable development password. It has its own named volume.

```sh
docker compose -f infra/compose.postgres.yaml up -d --wait
cd backend
source .venv/bin/activate
export DATABASE_URL=postgresql+psycopg://roomie:roomie-local-only@127.0.0.1:5432/roomie
export JWT_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
alembic upgrade head
python -m uvicorn app.main:create_app --factory --reload
```

PostgreSQL requires Alembic before startup. The first revision creates an empty schema. Keep existing SQLite files and volumes for the SQLite deployment. If a SQLite database predates avatar settings or notifications, back it up, stop writers, and run the existing `python -m app.migrate_avatars` and `python -m app.migrate_notifications` commands against that SQLite file as needed.

### Google Sign-In

Set the public OAuth 2.0 Web client ID as `GOOGLE_CLIENT_ID` in the backend environment and `VITE_GOOGLE_CLIENT_ID` in the frontend environment. Add `http://localhost:8443` to the client's authorized JavaScript origins. Password users can link a matching Google account explicitly from their profile. See the [Google setup instructions](infra/README.md#google-identity-services) for the production HTTPS origin.

## Verification

From the root with the development dependencies installed and PostgreSQL running:

```sh
(cd backend && .venv/bin/python -m pytest -q)
(cd backend && ROOMIE_TEST_POSTGRES_URL=postgresql+psycopg://roomie:roomie-local-only@127.0.0.1:5432/roomie .venv/bin/python -m pytest -q)
(cd frontend && node --test tests/*.test.mjs && npx tsc --noEmit --noUnusedLocals --noUnusedParameters && npm run build)
docker compose --env-file /dev/null -f infra/compose.postgres.yaml config -q
JWT_SECRET=placeholder GOOGLE_CLIENT_ID=placeholder SITE_DOMAIN=localhost docker compose --env-file /dev/null -f infra/compose.yaml config -q
terraform -chdir=infra fmt -check
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
```

The PostgreSQL tests create a uniquely named schema per test, apply Alembic, and remove that schema afterward. SQLite migration tests still use temporary SQLite files. Google token claims and the API Gateway invocation are simulated locally. See the [backend API reference](backend/README.md) and [frontend browser checks](frontend/README.md).

## AWS deployment

The Frankfurt Terraform configuration and manual runbook are in [infra/README.md](infra/README.md). CloudFront serves the private S3 frontend and sends uncached API requests to API Gateway and FastAPI on Lambda. The prepared runtime uses private PostgreSQL connections to auto-pausing Aurora Serverless v2. The RDS Data API is enabled for explicit schema administration. The original Docker Compose deployment remains available.

See the [monthly cost comparison](infra/README.md#monthly-cost-review) for idle, light, and moderate traffic estimates and the single-instance EC2 alternative.
