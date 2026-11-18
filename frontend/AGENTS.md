# Roomie frontend

React, Vite, TypeScript, and Tailwind CSS v4. Use npm and the checked-in package lock. Run `npm ci` before starting the app or building it.

- `npm run dev` serves the app on port 8443 by default and proxies `/api` to the local FastAPI server on port 8000.
- `npm run build` creates `dist/` for S3 and CloudFront.
- `node --test tests/*.test.mjs` runs the frontend tests.
- `npm exec -- tsc --noEmit --noUnusedLocals --noUnusedParameters` checks types.
- `src/App.tsx` contains the signed-in UI, and `src/api.ts` contains the API client.
