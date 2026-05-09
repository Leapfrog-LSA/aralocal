# Phase 08 — Packaging
Status: DONE

## Goal
Produce a Windows installer the user can double-click. Bundle Electron, the
Next.js standalone server, the compiled Express backend, and the SQLite
native binary, with a clear `npm run dist` flow.

## What changed

### Frontend
- **`frontend/next.config.ts`** — set `output: "standalone"` so `next build`
  emits `.next/standalone/server.js` (a self-contained Node server). Removed
  the `rewrites` block (those API routes don't exist in this fork). The
  desktop app has no SEO surface, so static-export tradeoffs aren't worth it.
- **`frontend/package.json`** — removed deps that no longer apply:
  `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@opennextjs/cloudflare`,
  `@supabase/auth-helpers-nextjs`, `@supabase/auth-js`, `@supabase/supabase-js`,
  `resend`, `wrangler`. Removed Cloudflare deploy scripts (`preview`, `deploy`,
  `upload`, `cf-typegen`). The supabase shim in `frontend/src/lib/supabase.ts`
  has no runtime dep on `@supabase/*` — it's a hand-written compat layer.
- **Deleted** `frontend/src/lib/storage.ts` (dead code — leftover frontend
  S3 client; nothing imported it).
- **Deleted** `frontend/open-next.config.ts` (Cloudflare-only).

### Electron
- **NEW** `electron/frontend.ts` — `spawnFrontend()` / `stopFrontend()` /
  `waitForFrontend()`. Spawns `node frontend/.next/standalone/server.js` on
  port 3000 in production. Skipped in dev (where `next dev` is run externally
  via `concurrently`).
- **MODIFIED** `electron/main.ts` — on unlock, spawns frontend in addition to
  backend, awaits both `/health` probes in parallel before navigating the
  window. Stops both on quit.

### Build pipeline
- **NEW** `scripts/stage-frontend.js` — copies `frontend/public/` and
  `frontend/.next/static/` into `frontend/.next/standalone/`. Next.js's
  standalone output doesn't include those by default (documented caveat).
- **MODIFIED** root `package.json`:
  - `"build:frontend"` → `next build && node scripts/stage-frontend.js`
  - `"dist"` → `npm run build && electron-builder`
  - `"rebuild-native"` → `electron-builder install-app-deps` for fixing
    native-module ABI mismatches if anyone hits one.
  - `electron-builder` config:
    - `asar: true` with `asarUnpack` for `better-sqlite3`, `bindings`,
      `file-uri-to-path` (native modules can't run from asar), the standalone
      Next.js bundle, and the compiled backend.
    - Files list bundles `dist-electron/`, `frontend/.next/standalone/` +
      `static/` + `public/`, `backend/dist/` + `migrations/` +
      `node_modules/`, and root `node_modules/`.
    - Windows NSIS target: `AraLegal-Setup-${version}.exe`, per-user install,
      installation directory selectable, Start menu shortcut "AraLegal".

### Docs
- **`README.md`** — full rewrite for end users. Sections: how to use the
  app, build from source, where data lives, what's different from upstream,
  project layout, dev notes (signing, auto-update, multi-user).

## Verifications
- `tsc --noEmit -p tsconfig.electron.json` — clean (with new `frontend.ts`).
- `npm run build:electron` → `dist-electron/` populated, including new
  `frontend.js` / `backend.js`.
- `npm run build:backend` → `backend/dist/` populated correctly.
- Compiled prod backend smoke: `node backend/dist/index.js` with synthetic
  `WORKSPACE_PATH` / `JWT_SECRET` / `PORT`:
  - migration applied
  - `AraLegal backend running on port 3006`
  - LibreOffice probe ran (logged "not detected")
  - `GET /health` → `{"ok":true}`

## Acceptance Criteria
- [x] Backend ships as compiled JS that boots from `node backend/dist/index.js`.
- [x] Frontend builds to a self-contained standalone server.
- [x] Electron-builder config bundles all required pieces, unpacks native
      modules from asar.
- [x] User-facing README documents install + first-launch + workspace layout.
- [ ] **Interactive (user)**: run `npm run install:all && npm run dist` →
      `dist/AraLegal-Setup-0.1.0.exe` produced. Install on a clean Windows account,
      launch, pick workspace, set password, paste API key, ask the assistant
      a question, see streaming response.

## Decisions Made This Phase
- **`output: "standalone"` over `output: "export"`** — the app uses Next.js
  App Router with dynamic routes (`[id]`, `[chatId]` etc.). Static export
  doesn't support those without manually generating params. Standalone keeps
  the runtime dynamic and ships a small Node server (~30 MB).
- **Spawn the standalone server, don't load via `file://`** — `<iframe>` of
  PDFs and other dynamic content needs HTTP semantics. A localhost server is
  simpler than wiring custom Electron protocols.
- **`asarUnpack` for `better-sqlite3` and friends** — native `.node` files
  can't be `require()`'d from inside an asar archive on Windows. The unpack
  list also includes the standalone server + compiled backend so spawned
  child processes can `require()` their own dependency tree.
- **Per-user NSIS install (`perMachine: false`)** — avoids requiring admin
  rights on each install. Trade-off: each Windows user account installs
  separately, which is fine for a single-user app.
- **No code signing in v1** — already logged. README documents the
  SmartScreen warning.
