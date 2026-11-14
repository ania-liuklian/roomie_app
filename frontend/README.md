# Roomie frontend: API integration, steps 1–2

Auth, rooms, members, invitation joining and shopping now use the backend. Existing CSS is unchanged. Chores, money and Today are deliberately not connected yet; their existing interactions use empty in-memory state and reset on reload/logout. No seed data or business records are read from or written to localStorage.

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

`formatTimestamp()` prepares Kyiv-local Ukrainian labels such as “Сьогодні, 19:00” from ISO timestamps for subsequent steps. Rooms and shopping have no displayed date field in the current UI.

```powershell
npx.cmd tsc --noEmit
npm.cmd run build
node --test tests/api.test.mjs
```
