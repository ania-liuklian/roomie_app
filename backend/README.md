# Roomie backend

Implemented now: FastAPI, SQLAlchemy/SQLite, all domain tables, bcrypt registration/login, 30-minute JWT access tokens, `GET /me`, rooms, persistent random invite codes, membership, chores with recurrence/rotation, shopping, expenses, repayments, money summaries and Today. The frontend still uses its existing local state.

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

Invites have no expiry or revocation. Codes contain 24 random bytes encoded as URL-safe text. Room numbers are labels, not globally unique. Authenticated nonmembers receive 403 for private room resources; missing rooms or resources return 404, and unauthenticated requests return 401. API field names use snake_case; future frontend integration must adapt existing camelCase types. Profile initials are derived from the user's name.

### Domain routes

Below, `R` means `/api/v1/rooms/{room_id}`. All routes require authentication and membership. Creates return 201; deletes return 204. Invalid fields return 422; conflicting state or overpayment returns 409. Swagger documents request bodies.

| Methods | Path | Behavior |
|---|---|---|
| GET, POST | `R/chores` | List (filter `all`, `mine`, `waiting`, `done`) / create. |
| PATCH, DELETE | `R/chores/{id}` | Creator or room owner; preserve completed recurrence history. |
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

Self-assignment starts active; assignments to others start waiting. Only assignees can accept/complete/reopen. Weekly completion creates exactly one waiting successor, preserving the completed occurrence. Advance the scheduled due date by one Kyiv calendar week (including DST changes); rotate through the supplied ordered IDs, skipping people who no longer belong to the room. Rotation must include the current assignee. Each successor requires acceptance, including when the same assignee continues. `once` or `same` normalizes rotation IDs to the assignee. Completed chores and generated successors cannot be deleted; reopen or edit the permitted occurrence instead. Reopen rejects a successor that has been edited, accepted or completed.

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
| Profile avatar / profile navigation | `GET /me`, `GET /me/stats`, `GET /rooms` | Now except stats |
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
| Save profile | `PATCH /me` for name/color | Later |
| Open/close modal, click backdrop, cancel form, dismiss detail | Local only | Local |
| Notification bell, chore dots, static week strip | Currently no handlers; no API call | Local |

The existing UI permits checks on waiting chores and other people's chores. The backend enforces assignee-only `waiting → active → done` transitions; frontend integration must reflect these permissions. Reopening a recurring completion atomically removes an untouched successor; it returns 409 if the successor has already changed.

### Additional actions and future contracts

Chore/expense/shopping edit/delete and repayment cancellation are implemented as above. Room management and profile changes below remain future contracts; no frontend changes are included.

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

`app/balances.py` and HTTP regression tests capture these values. Request creation validates against current pairwise outstanding debt minus other pending reservations. Confirmation revalidates current outstanding debt, excluding its own reservation. All domain mutations acquire `BEGIN IMMEDIATE` before state reads and commit before returning a response. Concurrent requests cannot overreserve the same debt or create duplicate weekly occurrences. Failed mutations roll back atomically. Tests cover these races as well as authorization, cross-room IDs and integer rounding.

Expense edits/deletes that change a pair with any confirmed repayment are conservatively rejected (409); metadata-only edits remain allowed. All expense writes also reject changes that invalidate pending repayment reservations. Cancel affected pending requests first. New spending after confirmed repayment is allowed.

## Privacy and scope

Never log expense notes, request/response bodies, passwords or bearer tokens. SQLAlchemy uses `hide_parameters=True`, SQL echo is disabled, and validation responses omit submitted inputs. Do not enable SQL debug/echo logging or body-capturing middleware/APM. Notes are intended only for authorized room responses and storage, not diagnostics. Uvicorn access logs contain method/path/status, not request bodies.

No frontend files were changed. Profile editing/statistics and room edit/delete/leave/ownership-transfer remain unimplemented. This stage changes no database tables; existing Stage 2 SQLite databases can be reused. Install the updated requirements for timezone data on Windows, then restart the backend to see the new routes in `/docs`.
