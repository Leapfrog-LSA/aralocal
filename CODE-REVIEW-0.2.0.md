# Code Review — `mikelocal` v0.2.0 (pre-ship)

**Date:** 2026-05-03
**Scope:** `d969096..e2a80b0` — full conversion from upstream cloud app to local Electron desktop app.
**Method:** Three parallel `superpowers:code-reviewer` subagents (security & Electron shell / backend correctness / frontend & build), each with a scoped file list and charter.
**Verdict:** **Do not ship as-is.** Two of three reviewers returned "Do not ship"; the third returned "Ship with fixes". 5 Critical issues block release.

---

## Critical — must fix before tagging 0.2.0

### C1. Download-token signing secret falls back to `"dev-secret"`
**Files:** `backend/src/lib/downloadTokens.ts:13-18`, `electron/backend.ts:57-65`

```ts
return process.env.DOWNLOAD_SIGNING_SECRET
    ?? process.env.SUPABASE_SECRET_KEY
    ?? "dev-secret";
```

`DOWNLOAD_SIGNING_SECRET` is never set in `electron/backend.ts` (the env block injects only `JWT_SECRET`, `WORKSPACE_PATH`, `LOCAL_USER_*`, `FRONTEND_URL`, AI keys). `SUPABASE_SECRET_KEY` is also unset post-Supabase removal. Every packaged build signs and verifies download tokens with the literal string `"dev-secret"`. Anyone who reads the codebase can forge `/download/:token` URLs for any `storage_path`. On a single-user install all rows belong to `local-user`, so the `ensureDocAccess` post-check passes.

**Fix:** mint a per-launch random secret in `electron/main.ts` alongside the JWT secret, pass via `DOWNLOAD_SIGNING_SECRET` env to the backend, remove the `"dev-secret"` fallback and throw if missing.

---

### C2. `verifyLocalJwt` does not validate the `alg` header
**File:** `backend/src/auth/local.ts:69-91`

The function decodes signature/payload but never inspects `headerB64`. An HS256-only verifier should still parse the header and reject anything where `alg !== "HS256"` or `typ !== "JWT"`. Today the signature path is the only verification path, so this is latent — but it is a defense-in-depth tripwire that costs five lines and protects against a future copy-paste of this verifier into a place that branches on `alg`.

**Fix:** decode the header, assert `header.alg === "HS256"` and `header.typ === "JWT"` before HMAC compare.

---

### C3. `sandbox: false` on the renderer BrowserWindow
**File:** `electron/main.ts:51-56`

```ts
webPreferences: { preload: ..., contextIsolation: true, nodeIntegration: false, sandbox: false }
```

With `sandbox: false`, the preload runs with full Node integration even when context isolation is on. A renderer-process compromise (XSS in the Next.js app, malicious markdown rendered from a chat reply, embedded SVG, etc.) gives the attacker a much larger blast radius than under Chromium's sandbox. Your `preload.js` only uses `contextBridge` and `ipcRenderer` — both work under `sandbox: true`.

**Fix:** set `sandbox: true`. Verify the preload still loads.

---

### C4. `chat_messages.workflow` column does not exist — every chat message insert fails
**Files:** `backend/src/routes/chat.ts:395-402`, `backend/src/routes/projectChat.ts:84-91` vs. `backend/migrations/001_sqlite_schema.sql:179-187`

Both routes insert `{ chat_id, role, content, files, workflow: lastUser.workflow ?? null }`. Schema defines `chat_messages` with `id, chat_id, role, content, files, annotations, created_at` — no `workflow` column. `encodeForSqlite` skips `undefined` but keeps `null`, so the `?? null` coalescing forces a column reference and SQLite throws `no such column: workflow` on every user-message persist.

The streaming response still works (the throw happens inside the prologue try/catch and is returned as 500 *after* the stream), but the user message is never saved — chat history breaks on reload.

**Fix:** drop `workflow:` from both inserts, or add a `workflow TEXT` column to `chat_messages` (and to `JSON_COLUMNS_BY_TABLE` if it stores objects). Verify with `POST /chat` then `GET /chat/:chatId` — second call should list the user message.

---

### C5. Raw Anthropic stream logged to disk unbounded
**File:** `backend/src/lib/llm/claude.ts:13-16, 86`

Every Claude stream event is written to `<cwd>/claude-raw-stream.log` via `fs.appendFile` and to stdout via `console.log("[claude raw stream]", line)`. The log grows unboundedly and contains the user's prompts, document excerpts, and assistant output for every chat. No rotation, no size cap, path is `process.cwd()` (in the packaged Electron app this depends on how the backend is spawned — possibly inside `Program Files` or the workspace).

This is a privacy regression versus the upstream cloud version's "local-only" pitch and a real disk-bloat issue (a heavy user produces gigabytes/day).

**Fix:** gate behind `if (process.env.MIKE_DEBUG_RAW_STREAM)` and route through a logger the user can opt into, or remove entirely. Same treatment for the `console.log`.

---

## Important — fix in 0.2.1 (optional for 0.2.0 if time-boxed)

### Security / Electron shell
- **No CSP on the renderer window.** No `Content-Security-Policy` header on the BrowserWindow nor injected `<meta http-equiv="Content-Security-Policy">`. LLM-rendered markdown is the realistic injection vector. Add via `session.defaultSession.webRequest.onHeadersReceived` in `main.ts` or via Next.js middleware.
- **DevTools always available, including on the lock screen** (`electron/main.ts:77-95`). F12 / Ctrl+Shift+I are wired unconditionally. Wrap in `if (!app.isPackaged)` or disable while `lockWebContents !== null`.
- **Lockout state in user-writable `auth-state.json`** (`electron/auth.ts:156-205`). Plaintext, trivially editable — `rm auth-state.json` resets the counter. Either HMAC the state file with a key derived from `file.hash`, or document explicitly in `DECISIONS.md` that this is a UX rate-limit only.
- **`payload.exp` not type-checked** in `verifyLocalJwt`. `NaN < Date.now()` silently passes. Add `typeof payload.exp !== "number" || !Number.isFinite(payload.exp)` check, plus type-check `sub`.
- **`shell: true` on dev backend spawn** (`electron/backend.ts:73-94`). Static argv today, but anyone editing this later who passes a workspace path or arg through has a shell-injection bug. Drop `shell: true`; spawn `cmd.exe /c tsx.cmd watch …` with a fixed argv array.
- **`pickWorkspace` not normalized / not checked against install dir** (`electron/workspace.ts:48-66`). No `fs.realpathSync`, no check that the path is not inside `app.getAppPath()` / `process.resourcesPath`. Junctions on Windows can resolve into the app bundle. Store the realpath, assert it's outside the install dir.
- **`getBackendPort` falls back to `3001`** (`electron/backend.ts:165-175`). If `runtime.json` is missing the renderer talks to whatever process happens to bind 3001. Return `null`/throw and have the renderer surface the error.
- **CORS `credentials: true` with env-driven origin** plus `import "dotenv/config"` at the top of `backend/src/index.ts`. A `backend/.env` next to the binary would override Electron's `FRONTEND_URL`. In `app.isPackaged` mode, refuse to read `dotenv` and trust only `process.env`.
- **`getBackendPort` / `getToken` / `getUser` IPC has no auth gate** (`electron/main.ts:305-310`). Today `sessionJwt` is null while the lock screen is showing, so this is fine in practice — but for parity with `setPassword`, assert `event.sender !== lockWebContents` for these handlers too.

### Backend correctness
- **`documents.ts:90` DELETE filters by `id` only** — outlier. Every other route uses belt-and-braces `id + user_id` (`projects.ts:281`, `chat.ts:253`, `workflows.ts:227`). Add `.eq("user_id", userId)`.
- **`projects.ts:558` folder cleanup unscoped.** `db.from("documents").update({ folder_id: null }).eq("folder_id", folderId)` with no `project_id`/`user_id`. Add `.eq("project_id", projectId)`.
- **`migrate.ts` regex too narrow** (lines 15-18). Only picks `*_sqlite_schema.sql` or `\d+_.+\.sqlite\.sql$`. A future contributor naming `002_add_workflow_column.sql` will have it silently skipped. Either widen the regex with an explicit deny-list, or move `000_one_shot_schema.sql` into a `migrations/postgres/` subfolder.
- **`synchronous = NORMAL` not set** (`backend/src/db/sqlite.ts:22-23`). Default is FULL; with WAL the conventional pairing is NORMAL — significantly faster for the doc-upload + edit churn with no real durability loss for desktop. Or document the choice.
- **No global Express error handler** (`backend/src/index.ts:20-43`). Any unhandled async throw past per-route try/catch leaks Node's default stack trace. Body limit `50mb` vs upload limit `100mb` is also mismatched (not dangerous, but worth aligning).
- **`getSignedUrl` uses `localhost`** (`backend/src/lib/storage.ts:218`) while the server binds `127.0.0.1` (`index.ts:68`). On Windows `localhost` may resolve to `::1` first. Use `127.0.0.1` in the URL.
- **`.or()` filter built by string concatenation with `userId` interpolated** (`backend/src/routes/chat.ts:38-46`). Latent today (`userId === "local-user"`), but a string-injection-shaped pattern. Parameterise the `.or()` parser or use a different builder shape.
- **LibreOffice `convert.ts:84-93` has no timeout / max-output-size.** A pathological DOCX can hang `soffice` indefinitely or produce a multi-GB PDF in a Buffer. Wrap in `Promise.race` with a 60s timeout that aborts and kills the child; cap output bytes.
- **`JWT_SECRET` parsed as hex without length check** (`backend/src/lib/storage.ts:133-137`). `Buffer.from(x, "hex")` silently produces a shorter/empty buffer for non-hex input. Throw at startup if `< 32` bytes.
- **`storageKey` interpolates `userId` and `docId` unsanitised** (`storage.ts:265-271`). Server-generated only today; add a runtime assertion `[a-zA-Z0-9_-]+` so a future bug can't escape via path components.
- **`PATCH /single-documents/:documentId/versions/:versionId`** (`documents.ts:543-579`) UPDATE filters on `id + document_id` only. Pre-check is correct, but consistency with the codebase's belt-and-braces pattern would add `user_id`.
- **Console-log debug noise in `documents.ts:635-817`** edit-resolution path. Demote to `console.debug` or gate behind an env flag.
- **`.contains()` on JSON arrays uses `LIKE %JSON.stringify(needle)%`** (`supabaseShim.ts:246-261`). False positives possible (e.g. `"alice@x"` matching `"alice@x.com"`). Acceptable for v1.

### Frontend / build
- **Dead `incrementMessageCredits` PATCH on every assistant turn** (`UserProfileContext.tsx:73`, `AuthContext.tsx:30`). `creditsRemaining` is hard-coded `UNMETERED = 999_999` and nothing reads `messageCreditsUsed`. Remove the call site or make the function a no-op.
- **JWT re-fetched via IPC on every API call** (`UserProfileContext.tsx:79-86`, `useCapabilities.ts:22-30`). The token is stable for the launch lifetime by design. Cache at module scope on first read; clear on `signOut`.
- **`useCapabilities` cache never refreshes** (`useCapabilities.ts:15-16`). If the user installs LibreOffice mid-session, the "Not detected" message lies until restart. Either expose a `refresh()` the account page can call, or add restart copy to the UI.
- **No backend defence-in-depth for LibreOffice gating.** `useCapabilities` gates the upload UI; a script can `POST /single-documents` with a DOCX and bypass it. Backend should return a clean error when conversion is required but `soffice` is missing.
- **`stage-backend.js:88` uses `--no-package-lock`** — non-deterministic installer between runs days apart. Acceptable for v0.2.0; before v1.0 generate / check in a separate `backend/.dist-bundle/package-lock.json`.
- **`fetch-libreoffice.js:113-121` SHA sidecar fetched same channel as MSI.** Defends against MITM but not against mirror compromise. Pin the expected hash in source as a constant (bumped manually with `LO_VERSION`) instead of fetching it.
- **`extraResources` placement of native modules is correct by accident** (`package.json:41-52`). `better-sqlite3` and `@napi-rs/canvas` ride in `extraResources` (outside `app.asar`) so they load. Add a comment next to `"asar": true`: *"Native modules ride in extraResources, so asar:true is safe — do not move backend/** into files[]"*.
- **Cross-check `tabular_model` vs `tabularModel` field-name** between `UserProfileContext.tsx:73` (snake) and the backend column. If they disagree, the saved choice is masked by the default on every load.

### Cosmetic / Minor
- `electron/jwt.ts:28` — variable named `secretHex` but `Buffer.from(x, "hex")` silently ignores non-hex. Add a `/^[0-9a-f]+$/i` + length check.
- `lock.js:73,77` — clear `$("password").value = ""` immediately after successful unlock (DOM is replaced on nav, but a race could leave it briefly).
- `safeSpawn` — name implies more than it delivers; consider `spawnWithCleanEnv`.
- `electron/preload.js` — main-process handlers type-check, but a 4096-byte size cap in the preload would avoid main-process work on garbage input.
- `electron-boot-check.js` — not wired into `npm run dist`. Either wire it or remove.
- `stage-frontend.js` — no `*.map` strip from `.next/static`. Optional installer-size win.
- `fetch-libreoffice.js:26` — pinned to LO 25.8.6; document bump cadence.

---

## Out of scope (already tracked or explicitly deferred)

Per `DECISIONS.md` / `TODO.md` — not re-flagged by reviewers:
- Code signing (unsigned `.exe`, SmartScreen prompts).
- Auto-update.
- macOS / Linux installers.
- Plaintext API keys in `user_profiles` (no worse than upstream Supabase storage).
- No logout button (close-and-reopen is the documented flow).
- Next.js 16 CVE-2025-66478.
- Transitive deprecation warnings inside `electron-builder` / `electron-rebuild`.
- `npm run dist` requires Developer Mode on Win11.

---

## Recommended path to ship

1. Fix C1–C5 (estimated ~1 focused session).
2. Smoke-test: workspace pick → password → unlock → upload `.txt` and `.pdf` → chat (verify message persists across reload) → close → reopen → unlock.
3. Targeted: try a path-traversal upload filename, confirm rejection in `storage.ts`. Five wrong passwords, confirm 30-s lockout.
4. Tag `v0.2.0`.
5. File the Important list as a 0.2.1 milestone.

Suggested fix order: **C4 → C1 → C5 → C2 → C3.** C4 is the simplest and easiest to verify; C1 mirrors the existing JWT-secret hand-off pattern; C5 is a one-line gate; C2 is five lines; C3 is a one-flag flip plus a smoke test.
