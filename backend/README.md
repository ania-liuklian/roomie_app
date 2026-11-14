# Roomie backend

Implemented now: FastAPI, SQLAlchemy/SQLite, all domain tables, bcrypt registration/login, 30-minute JWT access tokens, `GET /me`, rooms, persistent random invite codes, membership and invite previews. Chores, expense, repayment and shopping HTTP handlers come later. The balance module is pure arithmetic for the regression tests, not an exposed financial API.

## Run (PowerShell, from this backend directory)

Requires Python 3.11+.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$env:JWT_SECRET = (python -c "import secrets; print(secrets.token_urlsafe(48))")
$env:DATABASE_URL = "sqlite:///./roomie.db"
.\.venv\Scripts\python -m uvicorn app.main:create_app --factory --reload
```

Open http://127.0.0.1:8000/docs. Register or log in with JSON `{ "email": "sofia@example.com", "password": "password123", "name": "Sofia" }` (omit `name` for login). Use the returned `access_token` in Swagger's **Authorize**, or send `Authorization: Bearer <token>`.

Keep the generated JWT secret stable across restarts if existing tokens should remain valid; supply it through your deployment environment. No default secret is provided. Passwords must contain at least 8 characters and no more than 72 UTF-8 bytes, and are hashed with bcrypt (see [bcrypt's input limit](https://github.com/pyca/bcrypt)). Access tokens expire after 30 minutes; login again to obtain another. No refresh/logout endpoint yet. JWT decoding explicitly permits only HS256 and requires identity, issuance, expiry, issuer and audience claims; see [PyJWT usage](https://pyjwt.readthedocs.io/en/stable/usage.html).

The database is created at startup, relative to the working directory. Foreign keys are enabled per connection. `create_all` is for the initial schema only; introduce migrations before evolving a database containing real data. UTC timestamps round-trip through SQLite with timezone information restored. There are no per-room timezone/currency fields: the initial product uses Europe/Kyiv display/calendar rules and UAH integer kopecks.

```powershell
.\.venv\Scripts\python -m pytest
```

Tests use temporary SQLite files and an explicit test secret; no real data or seed accounts are installed.

## Implemented API

All paths below have prefix `/api/v1`.

| Method | Path | Behavior |
|---|---|---|
| POST | `/auth/register` | Unique normalized email, bcrypt password; returns JWT (201). |
| POST | `/auth/login` | JSON credentials; returns JWT. |
| GET | `/me` | Authenticated user's safe profile. |
| POST | `/rooms` | Create room, owner membership and random invite in one transaction (201). Body: `number`, optional hex `accent`. Returns room and `invite_code`. |
| GET | `/rooms` | Only the authenticated user's rooms. |
| GET | `/rooms/{room_id}` | Member-only room details and `member_ids`. |
| GET | `/rooms/{room_id}/members` | Member-only profiles. |
| GET | `/rooms/{room_id}/invite` | Member-only reusable code and frontend invite path. |
| GET | `/invites/{code}` | Public limited preview: number and accent only. |
| POST | `/invites/{code}/join` | Authenticated join; repeat joins return the same membership without changing its role. |

Invites have no expiry or revocation. Codes contain 24 random bytes encoded as URL-safe text. Room numbers are labels, not globally unique. Nonmembers receive 404 for private room resources. API field names use snake_case; future frontend integration must adapt existing camelCase types. Profile initials are derived from the user's name.

## Every current frontend action and its API mapping

`R` below means `/rooms/{room_id}`. **Now** means implemented; **Later** means a proposed contract only. Equivalent buttons in the sidebar, mobile navigation, cards and modals share the same mapping.

| Action in `App.tsx` | API / local behavior | Status |
|---|---|---|
| Logo / Today navigation | `GET R/today`: nearest incomplete chores, weekly progress, my debts, shopping counts | Later |
| Select room, or select a room in profile | `GET /rooms`, `GET R`, then selected screen's GET | Now for room data |
| Chores / Money / Shopping / Members navigation; Today money/shopping cards | GET endpoints for the selected screen below | Mixed |
| Profile avatar / profile navigation | `GET /me`, `GET /me/stats`, `GET /rooms` | Now except stats |
| Open create-room modal; submit | Opening is local; `POST /rooms` on submit | Now |
| Open invite modal / copy invite from sidebar, members or modal | `GET R/invite`, then clipboard locally | Now |
| Click invite link / open join preview | `GET /invites/{code}`; preview will no longer reuse the selected room's state | Now |
| Join room | `POST /invites/{code}/join`, refresh `/rooms` | Now |
| Chore filters: all, mine, waiting, done | `GET R/chores?filter=all\|mine\|waiting\|done`; waiting means assigned to me and awaiting acceptance | Later |
| Open chore modal | Local form; `GET R/members` supplies choices | Now for choices |
| Set chore difficulty, repeat, rotation, selected people; type title/due, choose assignee | Local draft only; convert due date/time into an ISO timestamp before submit | Local |
| Submit chore | `POST R/chores` | Later |
| Accept assigned chore | `POST R/chores/{id}/accept` | Later |
| Today chore check / board check | `POST R/chores/{id}/complete`; board undo uses `POST R/chores/{id}/reopen` | Later |
| Today “all chores” link | Navigate locally, then `GET R/chores` | Later |
| Read-only difficulty stars | No mutation; no endpoint | Local |
| Load money screen | `GET R/money`, `GET R/expenses` | Later |
| Open expense modal, select people, type amount/title/note | Local draft; `GET R/members` supplies choices | Now for choices |
| Submit expense | `POST R/expenses`; server sets payer to authenticated user and computes exact shares | Later |
| Report payment (“requested”) | `POST R/settlements` with creditor and integer amount; debtor comes from JWT | Later |
| Confirm receipt | `POST R/settlements/{id}/confirm`; only creditor, idempotent | Later |
| Open expense details | `GET R/expenses/{id}` | Later |
| Copy expense note/card | Clipboard locally; never log note content | Local |
| Load shopping screen | `GET R/shopping-items` | Later |
| Open shopping modal / type title / submit | Local draft, then `POST R/shopping-items` | Later |
| Check/uncheck shopping item | `PATCH R/shopping-items/{id}` with explicit `done`; server sets/clears buyer and completion time | Later |
| Load room/members screen | `GET R`, `GET R/members`, `GET R/invite` | Now |
| Edit profile name / cancel | Local draft / reset from `GET /me`; cancel needs no mutation | Local |
| Save profile | `PATCH /me` for name/color | Later |
| Open/close modal, click backdrop, cancel form, dismiss detail | Local only | Local |
| Notification bell, chore dots, static week strip | Currently no handlers; no API call | Local |

The existing UI permits checks on waiting chores and other people's chores. The future backend must enforce assignee-only `waiting → active → done` transitions; frontend integration must reflect these permissions. Reopening a recurring completion must atomically remove an untouched successor; reject with 409 if the successor has already been accepted or completed.

### Missing actions requested for the next stages

These are additions to the API plan, not working endpoints or frontend changes in this stage.

| Action | Proposed endpoint and rules |
|---|---|
| Edit/delete chore | `PATCH R/chores/{id}`, `DELETE R/chores/{id}`; creator or room owner; assignee may change state through dedicated actions. Preserve completed recurrence history. |
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

`app/balances.py` and its tests capture these values. The settlement validator rejects nonpositive, noninteger or excessive amounts. Future request creation must validate against current pairwise outstanding debt minus other pending reservations. Confirmation must revalidate against current outstanding debt and exclude its own reservation. Perform read/validate/write under one serialized SQLite write transaction (for example `BEGIN IMMEDIATE`) to prevent concurrent overpayment. Enforce membership and debtor/creditor authorization there too; these handlers are deliberately deferred.

## Privacy and scope

Never log expense notes, request/response bodies, passwords or bearer tokens. SQLAlchemy uses `hide_parameters=True`, SQL echo is disabled, and validation responses omit submitted inputs. Do not enable SQL debug/echo logging or body-capturing middleware/APM when expense routes are added. Notes are intended only for authorized room responses and storage, not diagnostics. Uvicorn access logs contain method/path/status, not request bodies.

No frontend files were changed. No chore, expense, settlement or shopping routes are registered. Those models exist now so the next stages can build on one schema.
