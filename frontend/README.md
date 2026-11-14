# Roomie frontend

Auth, rooms, members, invitation joining, shopping, chores, money and Today now use the backend. Existing CSS is unchanged. There are no seed records or localStorage calls. Only the auth token is stored in the browser, in sessionStorage; all other state is transient API results or form/UI state.

## Run both servers locally (PowerShell)

Use two terminals. Start both command sequences from the repository folder containing `backend` and `frontend`. Requirements: Python 3.11+ and Node.js 22.12+ (Node 24 works).

Terminal 1, backend (install/create the environment on first use):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$env:JWT_SECRET = (.\.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(48))")
$env:DATABASE_URL = "sqlite:///./roomie.db"
.\.venv\Scripts\python -m uvicorn app.main:create_app --factory --reload
```

Terminal 2, frontend:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Keep both terminals running. App: http://localhost:8443; API docs: http://127.0.0.1:8000/docs. Use `Ctrl+C` in each terminal to stop. For subsequent starts in the same terminals, only rerun each server command. Vite forwards `/api` to `http://127.0.0.1:8000`, so the browser uses same-origin requests without backend CORS changes.

`src/api.ts` reads `VITE_API_BASE_URL`, default `/api/v1`. Copy `.env.example` to `.env.local` to configure it. Include `/api/v1` in the base URL. An absolute API URL requires that backend/deployment to allow the frontend origin; the local default uses the proxy. Production hosting needs a matching `/api` reverse proxy or a CORS-enabled API URL. No secrets belong in Vite environment variables.

| Variable | Where | Meaning |
|---|---|---|
| `JWT_SECRET` | Backend process environment | Required, random secret of at least 32 bytes. Never expose it through Vite. Keep it stable to preserve tokens across backend restarts. |
| `DATABASE_URL` | Backend process environment | Default `sqlite:///./roomie.db`, relative to backend's working directory. |
| `VITE_API_BASE_URL` | Frontend `.env.local` / build environment | Default `/api/v1`; restart Vite after changing it. |
| `PORT` | Vite process environment | Optional frontend port; default 8443. |

`backend/.env.example` documents the backend variables; backend `.env` files are not automatically loaded. The commands above set its process environment directly. A newly generated JWT secret invalidates older tokens; log in again. `.env*` (except `.env.example`) and SQLite databases/journals are git-ignored.

JWTs live in sessionStorage (per tab, survives reload), and are sent as Bearer tokens. Logout or an authenticated 401 clears the token and unmounts the signed-in app. `/me` supplies the current identity; there is no hardcoded user ID. Network/server failures show retryable errors rather than falling back to demo data. Profile Save uses `PATCH /me` and updates the displayed signed-in user after success.

## Test step 1

1. Register a new account. Confirm the empty-room state, then create a room.
2. Open Members and check the signed-in name/email and “ЦЕ ВИ”. Reload: the room and identity must persist.
3. Copy the invite link. Open it in another browser profile/private window; register or log in as a second user. The invitation survives authentication; preview and join it.
4. Reload the first user's room to see both members. Repeat joining the same code: no duplicate membership.
5. Create another room and switch rooms: member lists and invite codes must match the selected room. Rapid switches must not show results from old requests.
6. Log out and switch accounts: no previous user's room data remains. Try a bad password, duplicate email, invalid invite and backend outage; verify error/retry states. Expired tokens return to login.

For joining without an invite URL, use “Приєднатися до кімнати” and paste a code or full link. Invite previews show only the number/accent provided by the public API; they do not reuse another room's member list. Join links use the current frontend origin and Vite base path, so they work locally.

## Test step 2: shopping

1. Open Shopping. Add an item; reload and verify it remains in that room.
2. Check it as bought: the API supplies the buyer and completion time. Reload, then uncheck it; buyer and completion time should clear.
3. Switch rooms: each list must contain only that room's items. Switch rapidly while loading; older responses must not replace the selected room's list.
4. Stop the backend and try loading or updating the list. Verify the error/retry state and that a failed checkbox update leaves its previous value. Restart the backend and retry. Failed adds retain the form title and show an error.
5. Log out and switch users; shopping data must not carry across sessions. A second member can reload the same room's list to see changes.

The list refreshes when entering Shopping, switching rooms, or retrying. Mutations use the existing JWT client and are blocked while saving to prevent duplicate submissions. Leaving the screen or room cancels outstanding requests; the next visit reloads server state, including writes that the server may have completed before cancellation. The UI has no edit/delete controls, so none were added.

## Test step 3: chores

1. Open Chores. Test All, Mine, Waiting for approval, and Done. Each uses the corresponding API filter; Waiting shows only chores assigned to the signed-in user.
2. Create a one-time chore assigned to yourself: it should be `active`. Assign one to another member: it should be `waiting`; only that assignee can accept it, making it `active`.
3. Complete an active chore: it becomes `done`. A waiting chore cannot be completed before acceptance; other people's acceptance/completion controls are disabled.
4. Create a weekly rotating chore with the assignee included in the selected people. Complete it and select All: the backend-generated next occurrence should appear one calendar week later, with the next assignee and `waiting` status. The frontend never generates successors or advances rotation itself.
5. Undo completion using the existing check button. The API reopens the chore and removes an untouched successor; if that successor was already accepted/changed, the API returns a conflict and the UI shows an error without a local status change.
6. Reload, switch rooms/filters rapidly, and test an unavailable backend. Loading/error/retry states should appear; older requests must not replace the current room/filter. Failed creates retain the form. Leaving a screen cancels its requests; re-entry reloads server state.

Due dates use a native date/time picker in the existing form, interpreted in the device's local timezone and sent as an ISO UTC instant. `formatTimestamp()` displays Kyiv-local Ukrainian strings such as “Сьогодні, 19:00”. API `once`/`weekly` map to “Один раз”/“Щотижня”; `waiting`/`active`/`done` are preserved exactly in state and CSS classes. The dots menu now opens Edit or Delete for incomplete chores. Edit changes title, difficulty, due date and assignee; Delete requires confirmation. All room members may manage incomplete chores; only assignees accept/complete/reopen them. Completed chores must be reopened before editing or deleting.

For a weekly chore, edits apply to that occurrence and the next occurrence generated when it is completed; completed history is not rewritten. Reassigning a rotating chore to a person outside its queue replaces the old assignee's queue slot. Deleting an incomplete weekly occurrence (including an upcoming one) removes its rotation rows and generates no successor; earlier completed occurrences remain. Reopening and recompleting an earlier occurrence explicitly can generate a new successor again.

Menu verification: test editing all four fields, Cancel without saving, delete confirmation Cancel/confirm, failed saves/deletes with the backend stopped, and a second room member managing the chore. Complete a weekly chore, then edit/delete its upcoming occurrence and verify the completed history remains. Try a nonmember's API token: PATCH and DELETE must return 403. The list reloads after success, menu closes on outside click/Escape, and pending requests are canceled on room/filter changes.

Today now uses its own API summary, independently of previously visited screens. The chore week strip also uses current Kyiv calendar dates instead of fixed demo dates.

## Test step 4: money

1. Open Money and verify the net balance, amount owed, amount receivable, per-person debt cards and expense history. All amounts come from `GET /money`; the frontend does not derive debts from expenses or create settlement rows locally.
2. Create an expense for 100 UAH with three selected participants. Open its details and verify the server's shares display as 33.34 / 33.33 / 33.33 UAH. Reload and verify persistence. Try `0.29`, comma decimals, an empty participant selection, and excess decimal places. At least one participant is required; the payer can be excluded.
3. Sign in as a debtor and click “Я вже віддав(-ла)”. It reports the available outstanding amount (minus any already pending requests); no debtor or payer ID is sent. The debt remains outstanding while its request awaits confirmation.
4. Sign in as the creditor and reopen Money. Confirm the specific pending repayment. The backend changes it to paid and updates balances. Both parties see confirmed rows in their existing debt sections without further action buttons. Only creditors see confirmation buttons; only debtors see reporting buttons. Each pending request has its own confirmation ID/amount; if partial requests exist, a debtor may report only the remaining unrequested amount.
5. Open an expense detail. Its note/payment details appear only in the existing note block and can be copied. No notes appear on debt cards, expense history, alerts or logs. History state discards notes; details are fetched separately. Failed loads can be retried.
6. Switch rooms rapidly, stop/restart the backend, try a stale overpayment request, and switch accounts. Verify loading/errors/retry, failed-create form retention, and that old responses cannot replace the selected room's data. Re-entering Money reloads the summary/history, and every successful write refreshes both.

`src/money.ts` is the single conversion boundary: strings in UAH become integer kopecks through digit parsing/BigInt; integer kopecks become display strings through digit slicing. No money division, multiplication or rounding uses floating-point arithmetic. API-provided expense shares are displayed directly; totals are taken directly from the summary. The amount input stays styled as before, accepts a dot or comma and at most two decimal places, and rejects invalid/excessive values instead of rounding.

The money hero displays the backend's signed net balance; the debt sections show gross amounts owed/receivable. Paid rows are historical repayments and do not count toward outstanding totals. Backend permission/overpayment rules remain authoritative. Pending requests do not reduce a debt until confirmed. No expense edit/delete controls exist in this UI, so none were added.

## Test step 5: Today

1. Log in and open Today directly, without first visiting any other screen. Verify nearest chores, current-week progress, debt totals and remaining shopping count against the room's API summary.
2. Complete your own active chore with the existing check button. Today must reload, remove the completed item from nearest chores, and update weekly progress. Weekly rotation still happens on the backend. Waiting chores must be accepted in Chores first; other people's check buttons are disabled.
3. Make changes on Shopping, Chores or Money, then return to Today. All four summary areas reload from `/rooms/{id}/today`.
4. Test a room with completed chores outside this week. Progress must use the server's Kyiv-local Monday-to-Monday due-date interval, not all completed chores. The server may include overdue items among the nearest incomplete chores.
5. Switch rooms rapidly and stop/restart the backend. Verify cancellation, loading/error/retry, and no old-room results. Missing data displays dashes rather than fabricated zero totals.

## Checks

Profile verification: change your name and avatar, save, and confirm the sidebar and Members show the saved profile; reload to verify persistence. Save submits name, color, eye style and gaze together. Failed saves retain the draft and show an error; Cancel restores the last saved name and avatar options.

`GET /me/stats` loads on Profile/Members entry and room changes. It supplies room count, completed assigned chores across the caller's rooms, and per-room unfinished workloads (waiting plus active). Workload bars represent each member's share of that room's unfinished chore count; an empty workload is zero. Test these screens directly without visiting Chores first, then stop the backend to verify stats error/retry states. No unfiltered chore cache remains.

From `frontend`:

```powershell
npx.cmd tsc --noEmit --noUnusedLocals --noUnusedParameters
npm.cmd run build
node --test tests/api.test.mjs tests/money.test.mjs tests/avatar.test.mjs tests/choreForm.test.mjs tests/notifications.test.mjs
```

From `backend`:

```powershell
.\.venv\Scripts\python -m pytest
```

Backend tests use temporary SQLite files and test-only JWT secrets; they do not modify your app database. Frontend client tests mock HTTP; the browser checklist above covers interactive verification.

## Remaining inactive UI / limitations

- Shopping and expenses have no edit/delete controls, although the backend supports them. Chores use their dots menu; notifications use the bell dropdown.
- Room accent and initials metadata remain unused by the fixed room design and character avatars.
- Backend room edit/delete/leave/ownership transfer remain unimplemented. No polling or push updates: revisit a screen or reload to see another member's changes.

No unused TypeScript bindings remain under the strict unused checks. All seed/business persistence code has been removed from `App.tsx`; auth token storage lives only in `api.ts`.

## Avatar customization

`src/Avatar.tsx` is the sole character renderer. It uses SVG for the rounded body and white eyes/dark pupils, at every existing avatar location (including the large profile character and Today greeting). Its default is the same rose/plain/straight look, preserving the previous eye geometry and layout classes. No external images or generated assets are used, and other styling is unchanged.

Supported options: the exported eight-color `AVATAR_COLORS` palette, `eye_style: plain/lashes`, and `gaze: straight/left/right/up/happy/sleepy`. Default body color is `#BF8790`; happy uses closed curved eyes and sleepy uses half-closed lids. API fields use `color` for body color, retaining the existing profile contract.

First migrate an existing backend database using the instructions in `../backend/README.md`; `create_all` will not add the new columns automatically. No dev data has been migrated automatically. The migration backs up the file, preserves app records and supplies defaults. Fresh databases get the new schema directly.

Test stage 1 using `/docs`: PATCH your authenticated `/me` with `{"color":"#8D9C83","eye_style":"lashes","gaze":"happy"}`, then reload the frontend and inspect avatars across screens. Another room member can reload to see the same settings on chore owners, expense payers/participants and debt cards. Nested API user objects supply appearance even when users are absent from the current member list. Invalid options should return 422. To reset, use `{"color":"#BF8790","eye_style":"plain","gaze":"straight"}`.

Stage 2 adds `src/AvatarPicker.tsx` inside the existing profile form: eight palette swatches, plain/lashes toggle and six gaze buttons. All controls support keyboard focus and expose their pressed state. Only picker-scoped styles were added; the surrounding design is unchanged.

The large profile character previews draft choices immediately. Other avatars keep the saved appearance until Save succeeds. Save uses one `PATCH /me` request for the trimmed name and all three avatar options, adopts the server response as the new saved profile, and updates the header/sidebar/member registry. Cancel restores that saved profile and clears any save error. Saving disables the form controls and duplicate submissions; failures retain the draft for retry. Drafts are never stored in browser storage.

Browser checklist:

1. Change each color, eye style and gaze and verify the live preview. Confirm header/sidebar avatars remain unchanged while editing.
2. Change the name too, then Cancel. Name and all avatar options must revert, with no API write.
3. Change them again and Save. Header/sidebar and other screens must show the saved avatar/name. Reload to verify persistence.
4. Make another draft change and Cancel; it must restore the most recent successful save, not the initial login values.
5. Stop the backend and Save. Verify the error, retained name/appearance draft, and enabled retry/Cancel after the request fails. Restart the backend, retry and verify success.


## Notification bell

The bell fetches the signed-in user's notification list on mount, every 30 seconds, when opened, and after successful read actions. It works independently of the selected room, including the empty-room onboarding state. The dot appears only when the API reports unread records. The dropdown shows actor avatars, generic messages, Kyiv-local timestamps and read/unread styling, using the existing palette and buttons. No expense notes are shown or logged.

Click an unread item to mark it read; use the read-all button to mark every notification owned by the current user read, including records beyond the latest 100 displayed. The API's list and unread count are reloaded after a write. Read failures retain the previous state and show an error/retry control. Polls pause during read writes, and superseded fetches are canceled. Logout/user switching tears down the interval and pending requests. Outside click, the bell button or Escape closes the dropdown; Escape restores focus to the bell. Clicking a notification marks it read without navigating to its resource.

Browser checks:

1. Use a second room member to assign you a chore or include you in an expense. Wait up to 30 seconds: your bell should gain an unread dot. The actor should receive no self-notification.
2. Open the dropdown and verify newest-first ordering, actor appearance, timestamps and unread styling. Click an unread item: its styling and unread count should update after the API response.
3. Generate several notifications, then mark all read. The count/dot should clear. Refresh and verify persistence.
4. Stop the backend and open/retry or mark a notification read. Verify loading/error states; restart and retry. An expired token should return to login.
5. Log out and switch accounts: the previous list must not appear and no previous session's poll should continue.

No backend schema change is needed for this frontend stage. If the notifications table has not been installed yet, follow the backend notifications migration instructions first.
