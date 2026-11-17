# Roomie backend

Implemented now: FastAPI, SQLAlchemy with SQLite or PostgreSQL, all domain tables, bcrypt registration/login, 30-minute JWT access tokens, `GET /me`, rooms, persistent random invite codes, membership, chores with recurrence/rotation, shopping, expenses, repayments, money summaries and Today. The frontend is connected to all these routes; only the auth token is stored in browser storage.

## Run (PowerShell, from this backend directory)

Requires Python 3.11+.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$env:JWT_SECRET = (.\.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(48))")
$env:DATABASE_URL = "sqlite:///./roomie.db"
.\.venv\Scripts\python -m uvicorn app.main:create_app --factory --reload
```

Open http://127.0.0.1:8000/docs. Register or log in with JSON `{ "email": "sofia@example.com", "password": "password123", "name": "Sofia" }` (omit `name` for login). Use the returned `access_token` in Swagger's **Authorize**, or send `Authorization: Bearer <token>`.

### Start the frontend alongside it

Keep the backend terminal running. Open a second PowerShell terminal in the repository root (the directory containing `backend` and `frontend`):

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Requires Node.js 22.12+ (Node 24 works). Open http://localhost:8443. Vite proxies `/api` to port 8000; no backend CORS setup is needed for this default. Stop each server with `Ctrl+C`. On subsequent starts, skip environment/dependency installation and rerun the server commands. If you open a fresh backend terminal, set its environment variables again.

### Environment variables

| Variable | Default / behavior |
|---|---|
| `JWT_SECRET` | Required random secret, at least 32 bytes; no default. Set in the backend process environment and preserve it across restarts to keep tokens valid. |
| `DATABASE_URL` | `sqlite:///./roomie.db`; relative paths use the backend working directory. |
| `VITE_API_BASE_URL` | Frontend only: `/api/v1`. Configure in `frontend/.env.local` using `frontend/.env.example`; restart Vite after changes. |
| `PORT` | Frontend only: optional Vite port, default 8443. |

`backend/.env.example` is a variable reference with an empty secret, not a real configuration. The backend does not automatically read `.env`; the PowerShell commands above set process variables directly. Never set `VITE_JWT_SECRET` or otherwise put backend secrets into a frontend build. An absolute frontend API URL needs appropriate backend CORS in that deployment; the local default avoids this with the proxy. Real environment files and SQLite databases/journals are ignored by Git at repository level and in backend rules.

Keep the generated JWT secret stable across restarts if existing tokens should remain valid; supply it through your deployment environment. No default secret is provided. Passwords must contain at least 8 characters and no more than 72 UTF-8 bytes, and are hashed with bcrypt (see [bcrypt's input limit](https://github.com/pyca/bcrypt)). Access tokens expire after 30 minutes; login again to obtain another. No refresh/logout endpoint yet. JWT decoding explicitly permits only HS256 and requires identity, issuance, expiry, issuer and audience claims; see [PyJWT usage](https://pyjwt.readthedocs.io/en/stable/usage.html).

SQLite creates missing tables at startup and enables foreign keys per connection. PostgreSQL requires `alembic upgrade head` before starting the app. See the [local PostgreSQL setup](../README.md#local-postgresql-16). UTC timestamps round-trip through SQLite with timezone information restored. There are no per-room timezone/currency fields: the initial product uses Europe/Kyiv display/calendar rules and UAH integer kopecks.

```powershell
.\.venv\Scripts\python -m pytest
```

Tests use temporary SQLite files by default. Set `ROOMIE_TEST_POSTGRES_URL` to run the API and model suites in isolated PostgreSQL schemas, as described in the [root README](../README.md#verification).

Frontend checks, from `frontend` (see its README for browser checks):

```powershell
npx.cmd tsc --noEmit --noUnusedLocals --noUnusedParameters
npm.cmd run build
node --test tests/api.test.mjs tests/money.test.mjs tests/avatar.test.mjs tests/choreForm.test.mjs tests/notifications.test.mjs
```

## Implemented API

All paths below have prefix `/api/v1`.

| Method | Path | Behavior |
|---|---|---|
| POST | `/auth/register` | Unique normalized email, bcrypt password; returns JWT (201). |
| POST | `/auth/login` | JSON credentials; returns JWT. |
| GET | `/me` | Authenticated user's safe profile. |
| PATCH | `/me` | Update own name/color/eye_style/gaze; safe profile response, blank/null/unknown fields rejected. |
| GET | `/me/stats` | Own room count, completed assigned chores and per-room member workloads. |
| GET | `/notifications` | Own notifications, newest first; items, total and unread count. |
| POST | `/notifications/{id}/read` | Mark an owned notification read; repeat calls preserve its timestamp. |
| POST | `/notifications/read-all` | Mark only the caller's unread notifications read. |
| POST | `/rooms` | Create room, owner membership and random invite in one transaction (201). Body: `number`, optional hex `accent`. Returns room and `invite_code`. |
| GET | `/rooms` | Only the authenticated user's rooms. |
| GET | `/rooms/{room_id}` | Member-only room details and `member_ids`. |
| GET | `/rooms/{room_id}/members` | Member-only profiles. |
| GET | `/rooms/{room_id}/invite` | Member-only reusable code and frontend invite path. |
| GET | `/invites/{code}` | Public limited preview: number and accent only. |
| POST | `/invites/{code}/join` | Authenticated join; repeat joins return the same membership without changing its role. |

Invites have no expiry or revocation. Codes contain 24 random bytes encoded as URL-safe text. Room numbers are labels, not globally unique. Authenticated nonmembers receive 403 for private room resources; missing rooms or resources return 404, and unauthenticated requests return 401. API field names use snake_case; future frontend integration must adapt existing camelCase types. Profile initials are derived from the user's name.

### Domain routes

Below, `R` means `/api/v1/rooms/{room_id}`. All routes require authentication and membership. Creates return 201; deletes return 204. Invalid fields return 422; conflicting state or overpayment returns 409. Swagger documents request bodies.

| Methods | Path | Behavior |
|---|---|---|
| GET, POST | `R/chores` | List (filter `all`, `mine`, `waiting`, `done`) / create. |
| PATCH, DELETE | `R/chores/{id}` | Any room member; incomplete occurrences only, preserve completed history. |
| POST | `R/chores/{id}/accept` | Assignee only; waiting to active, repeated acceptance is safe. |
| POST | `R/chores/{id}/complete` | Assignee only; active to done, repeated completion is safe. |
| POST | `R/chores/{id}/reopen` | Assignee only; undo completion, removing an untouched successor atomically. |
| GET, POST | `R/shopping-items` | List / create. |
| PATCH, DELETE | `R/shopping-items/{id}` | Members can edit title, mark done/undone, or delete. |
| GET, POST | `R/expenses` | List newest first / create, payer taken from JWT. |
| GET, PATCH, DELETE | `R/expenses/{id}` | Members can read details; payer only can edit/delete. |
| POST | `R/settlements` | Debtor reports a payment; create requested repayment. |
| POST | `R/settlements/{id}/confirm` | Creditor confirms receipt; repeated confirmation is safe. |
| DELETE | `R/settlements/{id}` | Debtor can cancel requested repayments; paid rows are immutable. |
| GET | `R/money` | Room balances, pairwise debts, my incoming/outgoing cards, totals, repayment records. |
| GET | `R/today` | Next three incomplete chores, Kyiv-local weekly progress, my money totals, shopping counts. |

All monetary input/output uses integer `amount_minor` / `share_minor` / `balance_minor` (kopecks), never floats. Chore `due_at` and optional expense `occurred_at` require an explicit timezone; responses use UTC ISO timestamps. Expense create requires `participant_ids`; the payer may be excluded. Duplicate/nonmember participant IDs are rejected. Extra mutation fields such as forged `payer_id`, `debtor_id`, `buyer_id` or `status` are rejected.

Example chore create:

```json
{"title":"Clean kitchen","owner_id":1,"difficulty":3,"due_at":"2026-11-18T18:00:00+02:00","repeat":"weekly","rotation":"rotate","rotation_ids":[1,2,3]}
```

Self-assignment starts active; assignments to others start waiting. Only assignees can accept/complete/reopen. Weekly completion creates exactly one waiting successor, preserving the completed occurrence. Advance the scheduled due date by one Kyiv calendar week (including DST changes); rotate through the supplied ordered IDs, skipping people who no longer belong to the room. Rotation must include the current assignee. Each successor requires acceptance, including when the same assignee continues. `once` or `same` normalizes rotation IDs to the assignee. Any room member may edit/delete an incomplete occurrence; nonmembers get 403. Completed occurrences return 409 until reopened. Reopen rejects a successor that has been edited, accepted or completed.

Editing a weekly occurrence changes the fields inherited by its next successor when it is completed; it never rewrites completed predecessors. Reassigning to a member absent from the rotation replaces the previous assignee's slot unless explicit rotation IDs were supplied. Reassignment to someone other than the acting user resets acceptance to waiting. Deleting an incomplete generated successor is permitted: remove its rotation rows, retain its completed predecessor and create no further occurrence. Explicitly reopening/recompleting an earlier chore can generate a successor again. Concurrent deletion/completion is serialized: either deletion wins and completion returns 404, or completion wins and deletion returns 409 with both historical and upcoming records intact. No migration is required for these changes.

Example expense create (100 UAH split between two members):

```json
{"title":"Groceries","amount_minor":10000,"participant_ids":[1,2],"note":"Optional private room note"}
```

Expense responses include `participant_ids` and `shares: [{"user_id":1,"share_minor":5000}, ...]`. Shopping completion is explicit (`{"done":true}` or `{"done":false}`): the server records/clears buyer and completion timestamp; repeated `done:true` preserves the original buyer. Shopping completion does not create an expense.

Example repayment request, sent by the debtor:

```json
{"creditor_id":1,"amount_minor":5000}
```

Money returns `balances`, `debts`, `owed_by_me`, `owed_to_me`, `total_i_owe_minor`, `total_owed_to_me_minor`, `my_balance_minor`, and `settlements`. Debt cards contain debtor/creditor, outstanding `amount_minor`, `requested_minor` and computed `unpaid`/`requested` status. Confirmable IDs are in `settlements`. Requested repayments do not reduce balances.

Today returns `date`, `week_start`, `chores`, `weekly_progress: {done,total,percent}`, `money` (the three personal totals), and `shopping: {total,done,remaining}`. Weekly progress uses chores whose due dates fall in the Kyiv-local Monday-to-Monday interval; nearest chores include overdue items. Summary reads use a single database snapshot.

## Every current frontend action and its API mapping

`R` below means `/rooms/{room_id}`. **Now** means implemented; **Later** means a proposed contract only. Equivalent buttons in the sidebar, mobile navigation, cards and modals share the same mapping.

| Action in `App.tsx` | API / local behavior | Status |
|---|---|---|
| Logo / Today navigation | `GET R/today`: nearest incomplete chores, weekly progress, my debts, shopping counts | Now |
| Select room, or select a room in profile | `GET /rooms`, `GET R`, then selected screen's GET | Now for room data |
| Chores / Money / Shopping / Members navigation; Today money/shopping cards | GET endpoints for the selected screen below | Now |
| Profile avatar / profile navigation | `GET /me`, `GET /me/stats`, `GET /rooms` | Now |
| Open create-room modal; submit | Opening is local; `POST /rooms` on submit | Now |
| Open invite modal / copy invite from sidebar, members or modal | `GET R/invite`, then clipboard locally | Now |
| Click invite link / open join preview | `GET /invites/{code}`; preview will no longer reuse the selected room's state | Now |
| Join room | `POST /invites/{code}/join`, refresh `/rooms` | Now |
| Chore filters: all, mine, waiting, done | `GET R/chores?filter=all\|mine\|waiting\|done`; waiting means assigned to me and awaiting acceptance | Now |
| Open chore modal | Local form; `GET R/members` supplies choices | Now for choices |
| Set chore difficulty, repeat, rotation, selected people; type title/due, choose assignee | Local draft only; convert due date/time into an ISO timestamp before submit | Local |
| Submit chore | `POST R/chores` | Now |
| Accept assigned chore | `POST R/chores/{id}/accept` | Now |
| Today chore check / board check | `POST R/chores/{id}/complete`; board undo uses `POST R/chores/{id}/reopen` | Now |
| Today “all chores” link | Navigate locally, then `GET R/chores` | Now |
| Read-only difficulty stars | No mutation; no endpoint | Local |
| Load money screen | `GET R/money`, `GET R/expenses` | Now |
| Open expense modal, select people, type amount/title/note | Local draft; `GET R/members` supplies choices | Now for choices |
| Submit expense | `POST R/expenses`; server sets payer to authenticated user and computes exact shares | Now |
| Report payment (“requested”) | `POST R/settlements` with creditor and integer amount; debtor comes from JWT | Now |
| Confirm receipt | `POST R/settlements/{id}/confirm`; only creditor, idempotent | Now |
| Open expense details | `GET R/expenses/{id}` | Now |
| Copy expense note/card | Clipboard locally; never log note content | Local |
| Load shopping screen | `GET R/shopping-items` | Now |
| Open shopping modal / type title / submit | Local draft, then `POST R/shopping-items` | Now |
| Check/uncheck shopping item | `PATCH R/shopping-items/{id}` with explicit `done`; server sets/clears buyer and completion time | Now |
| Load room/members screen | `GET R`, `GET R/members`, `GET R/invite` | Now |
| Edit profile name / cancel | Local draft / reset from `GET /me`; cancel needs no mutation | Local |
| Save profile | `PATCH /me` for name/color | Now |
| Open/close modal, click backdrop, cancel form, dismiss detail | Local only | Local |
| Chore dots | Edit through PATCH; confirm deletion through DELETE | Now |
| Notification bell | Dropdown, read actions and 30-second polling | Now |
| Week strip | Renders current Kyiv dates | Local |

The existing UI permits checks on waiting chores and other people's chores. The backend enforces assignee-only `waiting → active → done` transitions; frontend integration must reflect these permissions. Reopening a recurring completion atomically removes an untouched successor; it returns 409 if the successor has already changed.

### Additional actions and future contracts

Chore/expense/shopping edit/delete, repayment cancellation and profile changes are implemented as above. Additional room management below remains a future contract.

| Action | Proposed endpoint and rules |
|---|---|
| Edit/delete chore | `PATCH R/chores/{id}`, `DELETE R/chores/{id}`; any room member for incomplete occurrences. Assignee changes state through dedicated actions. Preserve completed history. |
| Edit/delete expense | `PATCH R/expenses/{id}`, `DELETE R/expenses/{id}`; payer only, recompute shares atomically; reject if this would invalidate a pending or confirmed repayment. |
| Edit/delete shopping item | `PATCH R/shopping-items/{id}`, `DELETE R/shopping-items/{id}`; room members. |
| Rename/recolor room | `PATCH R`; room owner only. |
| Delete room | `DELETE R`; owner only; reject while financial records exist, rather than erase financial history. |
| Leave room | `DELETE R/members/me`; reject outstanding debts, pending repayments or assigned unfinished chores; owner must transfer ownership first if others remain. Delete membership, retain user and historical records. No `left_at`. |
| Transfer ownership | `POST R/owner` with new owner's user ID; current owner only, target must be a member. |
| Cancel mistaken repayment request | `DELETE R/settlements/{id}`; requesting debtor only, requested status only. Paid records remain immutable. |
| Logout (no active button today) | Delete the access token locally; it remains valid until expiry. |

## Financial rules and corrected seed regression

`expense_shares` stores the exact split. Divide integer kopecks equally; allocate any remainder in ascending participant-ID order. Shares must sum to the expense amount. The payer need not be included among participants. Never create debt rows in `settlements` when creating an expense: unpaid debts are derived.

Net opposite debts between each pair, within the same room. Subtract only confirmed repayments; requested payments do not change balances. Do not simplify debts across third parties.

`balance = expenses paid − allocated expense shares + confirmed repayments sent − confirmed repayments received`

Positive means receivable; negative means payable. From the actual seed expenses (684 / 4; 258 / 3; 432 / 3):

| Member | Net UAH |
|---|---:|
| Sofia | +283 |
| Marko | +31 |
| Anna | +1 |
| Taras | −315 |

Pairwise: Marko → Sofia 27; Anna → Sofia 85; Taras → Sofia 171; Marko → Anna 86; Taras → Marko 144. Sofia's cards show 0 owed and 283 receivable. Seed settlements in the frontend are not imported as authoritative debt records.

`app/balances.py` and HTTP regression tests capture these values. Request creation validates against current pairwise outstanding debt minus other pending reservations. Confirmation revalidates current outstanding debt, excluding its own reservation. All domain mutations acquire `BEGIN IMMEDIATE` before state reads and commit before returning a response. Concurrent requests cannot overreserve the same debt or create duplicate weekly occurrences. Failed mutations roll back atomically. Tests cover these races as well as authorization, cross-room IDs and integer rounding.

Expense edits/deletes that change a pair with any confirmed repayment are conservatively rejected (409); metadata-only edits remain allowed. All expense writes also reject changes that invalidate pending repayment reservations. Cancel affected pending requests first. New spending after confirmed repayment is allowed.

## Privacy and scope

Never log expense notes, request/response bodies, passwords or bearer tokens. SQLAlchemy uses `hide_parameters=True`, SQL echo is disabled, and validation responses omit submitted inputs. Do not enable SQL debug/echo logging or body-capturing middleware/APM. Notes are intended only for authorized room responses and storage, not diagnostics. Uvicorn access logs contain method/path/status, not request bodies.

Frontend integration includes Today, chores and their edit/delete menu, shopping, expenses, money, repayments, profile save/statistics and the notification bell. Room edit/delete/leave/ownership-transfer remain unimplemented. See `../frontend/README.md` for the full inactive-UI list and browser verification checklist.

`PATCH /me` accepts optional `name` (trimmed, nonblank, at most 100 characters), palette `color`, `eye_style`, and `gaze`. It always updates the authenticated user, rejects attempts to change ID/email/password fields, and returns the same safe shape as `GET /me`. The frontend profile picker previews a local draft and submits name and avatar options together through the existing Save button.

`GET /me/stats` returns `{room_count, completed_chores, workloads: [{room_id, members: [{user_id, unfinished_chores, workload_percent}]}]}`. Counts include only rooms the caller belongs to; completed count covers their own assigned completed occurrences, and unfinished workload includes waiting/active occurrences assigned to each current member. Bar percentages are each member's fraction of the room's unfinished count, rounded to whole percentages; empty rooms return zero percentages. The endpoint reads a consistent SQLite snapshot and does not expose other rooms. No frontend chore cache is used for these metrics.

Runtime environment files and database files must remain untracked; only empty/documentation `.env.example` templates belong in Git. Backend test fixtures contain intentionally fake test-only credentials. Never use them as real configuration.

## Avatar stage 1: schema update required

The user model now stores `color` (body color, reusing the existing field), `eye_style` and `gaze`. Defaults are `#BF8790`, `plain`, `straight`: the current rose Roomie with its existing eye/pupil geometry. Allowed colors, drawn from existing avatar/CSS colors, are `#BF8790`, `#C48F78`, `#8D9C83`, `#C5A078`, `#A68D84`, `#DB8999`, `#9A786F`, `#9D76CF`. Input palette colors are case-insensitive and normalized to uppercase. Eye style is `plain` or `lashes`; gaze is `straight`, `left`, `right`, `up`, `happy`, or `sleepy`. Nulls and other values are rejected; SQL constraints enforce the vocabulary too.

**Existing dev database:** stop the backend first. From `backend`, with `DATABASE_URL` set to the same SQLite file your server uses (default `sqlite:///./roomie.db`), run:

```powershell
.\.venv\Scripts\python -m app.migrate_avatars
.\.venv\Scripts\python -m uvicorn app.main:create_app --factory --reload
```

Keep `JWT_SECRET` set in that terminal as described above. The migration creates an SQLite backup next to the database (`roomie.db-avatar-backup-<timestamp>`), adds columns, normalizes palette colors and changes old nonpalette colors to rose. Those old arbitrary colors were not used by the previous avatar renderer. Existing users default to plain/straight. Names, password hashes, room/financial/chore history and foreign keys are preserved. Re-running preserves valid customization. Legacy color-column enforcement uses triggers because SQLite cannot add a CHECK to that column without rebuilding the table. Backups are git-ignored alongside databases. This migration has tests; it has not been run against your dev database automatically.

**Disposable-data alternative:** instead of migrating, stop the backend and set `$env:DATABASE_URL = "sqlite:///./roomie-avatar-dev.db"`, then start it. A fresh schema will be created; register new users. Your original database remains untouched. `create_all` alone cannot update an existing schema.

Avatar fields are returned by `/me`, member lists, nested chore `owner`, expense `payer` and `participants` (including details), money debt/settlement `debtor`/`creditor`, and shopping `buyer`. Existing IDs and expense `shares` are unchanged. User objects never include password hashes. The frontend consumes these nested users, so historical expense participants do not depend on the current membership list.

To test customization before the picker is built, authorize in `/docs` and call `PATCH /api/v1/me` with:

```json
{"color":"#8D9C83","eye_style":"lashes","gaze":"sleepy"}
```

Reload the frontend, then inspect header/sidebar/profile, members, chores and money. Reset with `{"color":"#BF8790","eye_style":"plain","gaze":"straight"}`. The profile picker now provides the same options with live preview and Save/Cancel; see the frontend README for its browser checklist. No further migration is needed for stage 2.

## Notifications

Notifications are in-app database records; no email, push or external messages are sent. The frontend bell shows unread state, a dropdown with the latest 100 records, per-item read and read-all actions, and polling every 30 seconds while signed in. It also refreshes on opening and after successful writes. Logout cancels its polling and requests. The full unread count is independent of the visible page. See the frontend README for browser checks.

All routes require a JWT and use prefix `/api/v1`:

- `GET /notifications?limit=50&offset=0` returns `{items, unread_count, total}`. Items are ordered by `created_at DESC, id DESC`. Limit is 1–100; offset is nonnegative. Unread/total counts cover all the caller's records, independent of pagination. Unknown recipient filters cannot change ownership scoping.
- `POST /notifications/{id}/read` returns the owned notification with `read_at` set. Repeating preserves that timestamp. Missing IDs and other users' IDs both return 404.
- `POST /notifications/read-all` returns `{updated_count, unread_count: 0}` and changes only the caller's unread records. Repeating safely returns zero updated records. No request body is required for either read action.

Each item includes `id`, `recipient_id`, `actor_id`, safe `actor` profile/avatar, `kind`, `message`, `room_id`, nullable `chore_id`/`expense_id`/`settlement_id`, `created_at` and nullable `read_at`. UTC timestamps are real instants. Generic notification text never contains expense notes, card numbers, passwords or expense descriptions. No request/response bodies or notification contents are logged.

| Kind | Recipients / trigger |
|---|---|
| `chore_assigned` | Assignee when a chore is created or actually reassigned; also the next assignee when weekly completion generates an occurrence. |
| `expense_added` | Selected participants on expense creation; newly added participants on expense edits. Unchanged participants are not notified again. |
| `repayment_reported` | Creditor when the debtor creates a requested repayment. |
| `repayment_confirmed` | Debtor when the creditor first confirms receipt. |
| `room_joined` | Every existing member when a new member joins by invite. |

The actor is always excluded, including self-assigned chores, the paying participant and the joining user. The database also forbids `recipient_id == actor_id`. Events are inserted in the same transaction as the source action, so failures roll back both. Join writes are serialized; repeated/concurrent joins do not notify again. Repeat confirmation or completion calls do not duplicate transition notifications. Renames, unchanged assignments, read actions and merely copying an invite do not create notifications. There is no historical backfill.

Notifications retain their history when a related chore, expense, repayment or room is deleted; SQLite clears the corresponding nullable foreign key. A future frontend should not navigate when that resource ID is null, and must still handle normal room/resource permissions. The actor's safe profile is loaded at read time, so current names/avatars are returned.

### Update an existing dev database

Stop the backend. From `backend`, with the same `DATABASE_URL` as your app (default `sqlite:///./roomie.db`):

```powershell
.\.venv\Scripts\python -m app.migrate_notifications
.\.venv\Scripts\python -m uvicorn app.main:create_app --factory --reload
```

Keep `JWT_SECRET` set as described above. The additive migration creates a backup named `roomie.db-notifications-backup-<timestamp>`, then creates the table/index/constraints if missing. It is repeatable, preserves existing app data and produces no notifications for old actions. Database backups are covered by Git ignore rules. Fresh databases, and startup's missing-table creation, also obtain this table through `create_all`; the explicit migration provides the backup and repeatable upgrade step. It does not replace the earlier avatar migration if that is still needed. This migration has not been run against your dev database automatically.

Run `.\.venv\Scripts\python -m pytest` for all backend tests, or append `tests/test_notifications.py` for notification tests. They cover actor exclusion, every event kind, reassignment/rotation, expense privacy, cross-user isolation, pagination/unread counts, idempotent read/all-read, failed writes, concurrent joins, resource deletion and migration preservation.
