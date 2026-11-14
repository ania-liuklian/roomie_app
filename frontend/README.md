# Roomie frontend: API integration, steps 1–4

Auth, rooms, members, invitation joining, shopping, chores and money now use the backend. Existing CSS is unchanged. Today remains for step 5. No seed data or business records are read from or written to localStorage.

## Run locally (PowerShell)

Start the backend as described in `../backend/README.md`, on port 8000. From this frontend directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the printed local URL (default http://localhost:8443). Restart Vite if it was already running before the proxy configuration changed. Vite forwards `/api` to `http://127.0.0.1:8000`, so the browser uses same-origin requests without backend CORS changes.

`src/api.ts` reads `VITE_API_BASE_URL`, default `/api/v1`. Copy `.env.example` to `.env.local` to configure it. Include `/api/v1` in the base URL. An absolute API URL requires that backend/deployment to allow the frontend origin; the local default uses the proxy. Production hosting needs a matching `/api` reverse proxy or a CORS-enabled API URL. No secrets belong in Vite environment variables.

JWTs live in sessionStorage (per tab, survives reload), and are sent as Bearer tokens. Logout or an authenticated 401 clears the token and unmounts the signed-in app. `/me` supplies the current identity; there is no hardcoded user ID. Network/server failures show retryable errors rather than falling back to demo data. Profile name editing is disabled because `PATCH /me` is not implemented by the backend yet.

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

The list refreshes when entering Shopping, switching rooms, or retrying. Mutations use the existing JWT client and are blocked while saving to prevent duplicate submissions. Leaving the screen or room cancels outstanding requests; the next visit reloads server state, including writes that the server may have completed before cancellation. The UI has no edit/delete controls, so none were added. Today remains for step 5.

## Test step 3: chores

1. Open Chores. Test All, Mine, Waiting for approval, and Done. Each uses the corresponding API filter; Waiting shows only chores assigned to the signed-in user.
2. Create a one-time chore assigned to yourself: it should be `active`. Assign one to another member: it should be `waiting`; only that assignee can accept it, making it `active`.
3. Complete an active chore: it becomes `done`. A waiting chore cannot be completed before acceptance; other people's acceptance/completion controls are disabled.
4. Create a weekly rotating chore with the assignee included in the selected people. Complete it and select All: the backend-generated next occurrence should appear one calendar week later, with the next assignee and `waiting` status. The frontend never generates successors or advances rotation itself.
5. Undo completion using the existing check button. The API reopens the chore and removes an untouched successor; if that successor was already accepted/changed, the API returns a conflict and the UI shows an error without a local status change.
6. Reload, switch rooms/filters rapidly, and test an unavailable backend. Loading/error/retry states should appear; older requests must not replace the current room/filter. Failed creates retain the form. Leaving a screen cancels its requests; re-entry reloads server state.

Due dates use a native date/time picker in the existing form, interpreted in the device's local timezone and sent as an ISO UTC instant. `formatTimestamp()` displays Kyiv-local Ukrainian strings such as “Сьогодні, 19:00”. API `once`/`weekly` map to “Один раз”/“Щотижня”; `waiting`/`active`/`done` are preserved exactly in state and CSS classes. There are no working edit/delete controls in the current chore UI (the dots button has no handler), so no new controls were added.

**Known leftover for step 5:** Today's progress and nearest chores still read the cached, unfiltered chore list loaded when visiting Chores. Before that visit they may be empty, and progress counts all cached occurrences rather than the current week. They do not use `GET /today` yet. The Today check button now opens Chores instead of performing a local-only completion. The static week strip on Chores is unchanged. Today money/shopping cards similarly use cached data loaded on those screens. Step 5 must connect Today to its authoritative API summary.

## Test step 4: money

1. Open Money and verify the net balance, amount owed, amount receivable, per-person debt cards and expense history. All amounts come from `GET /money`; the frontend does not derive debts from expenses or create settlement rows locally.
2. Create an expense for 100 UAH with three selected participants. Open its details and verify the server's shares display as 33.34 / 33.33 / 33.33 UAH. Reload and verify persistence. Try `0.29`, comma decimals, an empty participant selection, and excess decimal places. At least one participant is required; the payer can be excluded.
3. Sign in as a debtor and click “Я вже віддав(-ла)”. It reports the available outstanding amount (minus any already pending requests); no debtor or payer ID is sent. The debt remains outstanding while its request awaits confirmation.
4. Sign in as the creditor and reopen Money. Confirm the specific pending repayment. The backend changes it to paid and updates balances. Both parties see confirmed rows in their existing debt sections without further action buttons. Only creditors see confirmation buttons; only debtors see reporting buttons. Each pending request has its own confirmation ID/amount; if partial requests exist, a debtor may report only the remaining unrequested amount.
5. Open an expense detail. Its note/payment details appear only in the existing note block and can be copied. No notes appear on debt cards, expense history, alerts or logs. History state discards notes; details are fetched separately. Failed loads can be retried.
6. Switch rooms rapidly, stop/restart the backend, try a stale overpayment request, and switch accounts. Verify loading/errors/retry, failed-create form retention, and that old responses cannot replace the selected room's data. Re-entering Money reloads the summary/history, and every successful write refreshes both.

`src/money.ts` is the single conversion boundary: strings in UAH become integer kopecks through digit parsing/BigInt; integer kopecks become display strings through digit slicing. No money division, multiplication or rounding uses floating-point arithmetic. API-provided expense shares are displayed directly; totals are taken directly from the summary. The amount input stays styled as before, accepts a dot or comma and at most two decimal places, and rejects invalid/excessive values instead of rounding.

The money hero displays the backend's signed net balance; the debt sections show gross amounts owed/receivable. Paid rows are historical repayments and do not count toward outstanding totals. Backend permission/overpayment rules remain authoritative. Pending requests do not reduce a debt until confirmed. No expense edit/delete controls exist in this UI, so none were added.

```powershell
npx.cmd tsc --noEmit
npm.cmd run build
node --test tests/api.test.mjs tests/money.test.mjs
```
