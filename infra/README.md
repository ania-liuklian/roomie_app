# Roomie — deploy to AWS EC2 (HTTPS)

This is a minimal **single-host Docker Compose** deployment for a course prototype. It has one FastAPI process, a persistent SQLite database in a Docker named volume, and a Caddy reverse proxy that automatically obtains/renews a public HTTPS certificate for a DNS name you control. No ports for the backend or database are exposed publicly.

## 0. Requirements

- An AWS account (verify the course credits apply to the resources you choose).
- A registered domain or a subdomain you can configure. Set an **A record** to the EC2 public/Elastic IPv4 address. Caddy must reach port **80** to issue a certificate, and browsers need **443** for HTTPS. **Without a domain and working DNS, do not claim this deployment is HTTPS-ready.**
- A Google Cloud OAuth 2.0 **Web application** client ID (see below).
- Docker Engine and the Docker Compose v2 plugin on your EC2 server.

## 1. Google Cloud configuration

1. In [Google Auth Platform](https://console.cloud.google.com/auth/overview) configure branding/consent. If its publishing status is **Testing**, add every tester to **Test users**.
2. In **Clients**, create an **OAuth client ID** of type **Web application**.
3. Add **Authorized JavaScript origins**, including `http://localhost:8443` for local development and `https://roomie.example.com` (your actual site domain) for production. **Do not include a path** in an origin.
4. The implementation uses Google Identity Services JavaScript popup callback and verifies the Google *ID token* at the backend. You do **not** need to register a redirect URI for this specific GIS popup flow. Do not use a Google client secret in the frontend.
5. Set the same Client ID in `backend` as `GOOGLE_CLIENT_ID` and in the frontend as `VITE_GOOGLE_CLIENT_ID` (the Compose build passes it into Vite automatically).

Local configuration example:

```bash
# backend, from its working directory
export JWT_SECRET="$(openssl rand -hex 32)"
export GOOGLE_CLIENT_ID="<your-web-client-id>.apps.googleusercontent.com"
python -m uvicorn app.main:create_app --factory --reload

# in another shell, from frontend/
cp .env.example .env.local
# edit VITE_GOOGLE_CLIENT_ID in .env.local
npm ci && npm run dev
```

**Existing password accounts:** Roomie does not automatically equate a Google account with a password account by email, to avoid accidental account takeover. Sign in using the password and use the Google button in **My profile** to link the same email. New Google users are created automatically on first Google login. Google accounts use the immutable `sub` identifier rather than email to identify returning users. Linking creates a new table and does not alter existing user rows.

## 2. Prepare an EC2 instance

1. In the AWS Console select **EC2 → Launch instance**, choose an Ubuntu LTS image and a modest instance with enough RAM to run/build the app (for example a 2–4 GiB RAM instance). The exact price depends on region, compute type, EBS, networking and the type of credits. Set an **AWS Budget alert** before starting.
2. Attach a security group: inbound SSH (**22/TCP**) only from your IP; **80/TCP** and **443/TCP** from the internet, plus optionally **443/UDP** for HTTP/3. Outbound HTTPS must work for Google token verification and certificate issuance.
3. Associate an **Elastic IP** (this has a charge), or otherwise ensure the instance retains a stable public address. Add a DNS **A** record pointing to it.
4. Connect over SSH and install Docker Engine and the Compose plugin using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Put your SSH user into the Docker group only if you understand that Docker group membership provides root-equivalent permissions; otherwise use `sudo docker compose`.
5. Copy/clone your team's git repository to the instance. No AWS credentials are required inside the app containers.

## 3. Configure and deploy

From the repo directory on the EC2 instance:

```bash
cd infra
cp .env.example .env
openssl rand -hex 32
# Put the generated string as JWT_SECRET; replace SITE_DOMAIN and GOOGLE_CLIENT_ID.
# IMPORTANT: `infra/.env` is excluded from Git.
# Read .env to verify values before proceeding.
docker compose up --build -d
docker compose ps
docker compose logs --tail 80 backend frontend
```

Wait for Caddy to obtain the TLS certificate. Then test using the **actual** domain:

```bash
curl -I https://roomie.example.com/
curl https://roomie.example.com/api/v1/healthz
```

Expected API result: `{"status":"ok"}`. Try local account registration and Google login from a real browser on the deployed HTTPS site.

## 4. Update, persistence and security

```bash
cd infra
git pull --ff-only
docker compose up --build -d
# Inspect logs for errors:
docker compose logs --tail 100 backend frontend
```

The **`sqlite_data` Docker volume** preserves Roomie user/room data between normal container restarts and rebuilds. `caddy_data` persists the TLS material. **Do not run `docker compose down --volumes`** unless you explicitly intend to erase those volumes. A Docker volume alone is **not a backup**: take regular AWS EBS snapshots or use a SQLite-safe backup procedure.

To obtain an online SQLite backup without shutting down the API:

```bash
docker compose exec -T backend python -c 'import sqlite3; src=sqlite3.connect("/data/roomie.db"); dest=sqlite3.connect("/data/backup.db"); src.backup(dest); dest.close(); src.close()'
docker compose cp backend:/data/backup.db ./roomie-backup.db
# Store this backup securely, outside the server.
```

**Caveats:** This is an inexpensive one-instance student prototype, not a multi-AZ production deployment. SQLite is a single-host persistence choice and does not offer high availability. Production workloads should use managed persistent databases, backups, monitoring, rate limits and a formal migration strategy. The JWT is currently stored in browser `sessionStorage` by the existing frontend; treat XSS prevention as important and do not claim this is a fully hardened authentication system.

## 5. Acceptance checklist

- `backend/`, `frontend/`, `infra/`, root `README.md` present.
- `https://...` loads without a certificate warning and API is reachable under the **same** host at `/api/v1/healthz`.
- New user can register, logout, and sign back in with email/password.
- New user can log in with Google; same Google user returns to same Roomie account.
- An existing password user can link Google through the profile without losing rooms.
- Restart with `docker compose down && docker compose up -d`; users, rooms and Google identities persist.
- Show at least two separate user accounts do **not** access one another's rooms.
- Team also submits the separate **user feedback report** with tester count, observations and changes.

## Optional: no custom domain

This template **requires a domain/subdomain** for automatic public HTTPS. If you do not own one, another valid architecture is an HTTPS front door such as Amazon CloudFront at `*.cloudfront.net` with the origin configured for your application. That is a **different deployment configuration**, not covered by this Compose file; don't claim Google origins or production TLS are configured until the actual URL is known and tested. Avoid placing authentication traffic across an unencrypted CDN-to-origin hop where possible.
