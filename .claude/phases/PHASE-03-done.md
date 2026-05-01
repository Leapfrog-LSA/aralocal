# Phase 03 — Local JWT auth (replace Supabase Auth)
Status: DONE

## Goal
Replace Supabase JWT verification with locally-issued JWTs everywhere auth is checked. Keep the Supabase data layer intact (PHASE-04 swaps that). After this phase, the Electron lock-screen owns the entire auth lifecycle.

## What changed

### Backend
- **NEW** `backend/src/auth/local.ts` — HS256 sign+verify using Node `crypto`. No JWT library dependency.
- **REWRITTEN** `backend/src/middleware/auth.ts` — calls `verifyLocalJwt`; populates `res.locals.userId/userEmail` exactly as before.
- **NEW** `backend/src/routes/auth.ts` — `GET /auth/me` (token-bound user) and `GET /auth/health` (public probe).
- **MODIFIED** `backend/src/lib/supabase.ts` — kept `createServerSupabase` for routes that still hit Supabase; deleted `getUserIdFromRequest` (was unused).
- **MODIFIED** `backend/src/index.ts` — mounted `authRouter` at `/auth`.
- Backend now reads `JWT_SECRET`, `LOCAL_USER_ID`, `LOCAL_USER_EMAIL`, `WORKSPACE_PATH` from env (all set by Electron at spawn).

### Frontend
- **REPLACED** `frontend/src/lib/supabase.ts` — now a compatibility shim. `supabase.auth.getSession()` proxies to `window.mike.getToken/getUser`. `supabase.from(...)` throws (forces PHASE-04 migration of any direct DB callers).
- **DELETED** `frontend/src/lib/auth.ts` (dead code — no Next.js API routes used it).
- **DELETED** `frontend/src/lib/supabase-server.ts` (dead code — no callers).
- **REPLACED** `frontend/src/app/login/page.tsx` and `signup/page.tsx` — now show "Mike is locked, use the launcher" notice (the Electron lock screen owns auth).
- AuthContext, all hooks (`useFetchSingleDoc`, `useFetchDocxBytes`, `useDocumentVersions`), and components (`DocPanel`, `DocxView`, `EditCard`, `AssistantMessage`) work unchanged via the shim.
- UserProfileContext still calls `supabase.from(...)` — the throw is caught by its existing `try/catch` and falls through to a default profile. PHASE-04 routes those calls through the backend.

### Electron
- **NEW** `electron/jwt.ts` — mirrors backend HS256 signer so main can mint tokens with the shared secret.
- **NEW** `electron/backend.ts` — spawns the Express backend as a child process with the right env (JWT_SECRET, WORKSPACE_PATH, LOCAL_USER_*, decrypted API keys), polls `/health` until ready.
- **MODIFIED** `electron/main.ts` — on unlock: random 32-byte JWT secret per launch → mint 24h token → `spawnBackend()` → `waitForBackend()` → navigate window. Adds IPC handlers `mike:getToken`, `mike:getUser`, `mike:getApiPort`. Stops backend on quit.
- **MODIFIED** `electron/preload.js` — exposes `getToken`, `getUser`, `getApiPort`.
- **MODIFIED** root `package.json` — `dev` script no longer spawns backend separately (Electron owns it). Frontend + Electron run via concurrently.

## Verifications run
- `tsc --noEmit` on backend + electron — both clean.
- `node scripts/electron-boot-check.js` — PASS.
- Live JWT round-trip: backend started with `JWT_SECRET=<random>`, signed token via Node crypto, hit `/auth/me` → returns `{"id":"local-user","email":"user@local"}`. Tampered token → 401 "Malformed token".

## Acceptance Criteria (interactive)
- `npm run dev` from repo root opens lock screen → unlock → frontend loads at `localhost:3000`.
- Frontend `AuthContext` reports `isAuthenticated: true` (via shim → window.mike).
- Calls to backend (e.g. `/projects`) include the local JWT and pass `requireAuth`.
- Logout flow: not implemented (close window to "log out"; lock screen returns on next launch). Confirmed acceptable for v1.

## Decisions Made This Phase
- **JWT_SECRET = fresh random 32 bytes per launch** (not derived from password). Tokens are valid only for the current process lifetime; relaunch mints new ones. Simplifies the threat model — losing the in-memory secret on quit is by design.
- **Compatibility shim instead of editing every call site.** ~12 files do `supabase.auth.getSession()`; the shim keeps them working unchanged. Direct `supabase.from(...)` calls intentionally throw to surface PHASE-04 work.
- **No `jsonwebtoken` dependency.** ~50 lines of crypto.HMAC code is enough for HS256 sign/verify. One fewer dep to vendor.
