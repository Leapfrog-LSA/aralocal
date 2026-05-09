# AraLegal (local desktop edition)

> **Fork notice**: AraLegal (aralocal) is a modified version of [mikelocal](https://github.com/rafal-fryc/mikelocal) by rafal-fryc, originally licensed under AGPL-3.0. Modified by Leapfrog-LSA — May 2026.

A downloadable desktop version of the AraLegal AI legal platform. Everything
runs on your computer: documents, database, settings, model API calls.
No Supabase, no cloud storage, no external login. The only network calls
the app makes are to whichever model providers' API keys you configure
(Anthropic and/or Gemini).

This fork rewires the upstream web app (Next.js + Express + Supabase + S3)
into an Electron desktop app:

- **Storage** moved from Supabase Postgres to a local SQLite database
  (`better-sqlite3`) inside a workspace folder you pick.
- **File storage** moved from S3/R2 to the same workspace folder, behind
  a path-traversal-guarded filesystem layer.
- **Auth** moved from Supabase Auth to a local scrypt-hashed password +
  per-launch HS256 JWT.
- **Distribution** moved from a Cloudflare/OpenNext deploy to a Windows
  NSIS installer that bundles everything (including LibreOffice for DOCX
  conversion).

The original Next.js + Express architecture is preserved; an Electron
shell spawns both as child processes and gates them behind a lock screen.

---

## Table of contents

1. [Using the app](#using-the-app)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Security model](#security-model)
5. [Data layout](#data-layout)
6. [Building from source](#building-from-source)
7. [Project layout](#project-layout)
8. [Tech stack](#tech-stack)
9. [What changed from upstream](#whats-different-from-upstream)
10. [Known limitations](#known-limitations)
11. [License](#license)

---

## Using the app

1. Run `AraLegal-Setup-<version>.exe` from `dist/`. (Unsigned — Windows
   SmartScreen will warn the first time. Click "More info" → "Run
   anyway".)
2. Launch **AraLegal** from the Start menu.
3. **First launch** — pick a workspace folder. This is where your
   documents, database, and settings will live. Pick somewhere you back
   up (e.g. inside `Documents`). AraLegal will refuse to use a folder inside
   its own install directory.
4. **Set a password** (minimum 10 characters). You'll enter it every
   time you open AraLegal. **It can't be recovered** — if you forget it,
   the workspace data is unreadable. Write it down somewhere safe.
5. **Settings → Models & API Keys** — paste in at least one model
   provider key (Anthropic and/or Gemini). Links to where to get each
   key are alongside the form.

The lock screen shows on every launch. Five wrong passwords trigger a
30-second lockout (UX rate-limit only — see [Security model](#security-model)).

LibreOffice ships bundled with the installer (~330 MB extracted), so
DOCX/DOC files render as PDF previews out of the box. No separate install
needed.

### Backing up

Copy the entire workspace folder. That's it — everything (DB, files,
auth hash, settings) lives inside `.aralegal/` and `files/` under your
chosen workspace.

### Starting fresh

Delete the workspace folder (or pick a different one on next launch).
AraLegal doesn't store anything outside the workspace and Electron's
`userData` directory (which only holds the path to the last-used
workspace).

---

## Features

- **Local-first AI legal assistant**: chat with Anthropic Claude or
  Google Gemini models, with conversation history, tool use, and
  reasoning streams.
- **Document workflows**: upload PDF, DOCX, DOC, TXT files; the
  assistant can read, edit, and produce annotated revisions of them
  with track-changes-style UI.
- **Project organisation**: group documents into projects with
  per-project chats and folder hierarchies.
- **Tabular review**: bulk-extract structured fields from many documents
  at once into a spreadsheet-like view.
- **Built-in legal workflows**: prebuilt prompt templates for common
  document-review tasks (contract review, NDA triage, etc.).
- **DOCX conversion** via bundled LibreOffice, so Word files render as
  PDFs inside the app.
- **No telemetry, no analytics, no remote calls** beyond the model
  provider you configured.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Electron main process (Node)                                 │
│  ─ Lock screen (HTML)                                          │
│  ─ Workspace + password management                             │
│  ─ Spawns child processes once unlocked:                       │
│      • Backend  (Express on 127.0.0.1:<random>)                │
│      • Frontend (Next.js standalone, dev: localhost:3000)      │
│  ─ IPC bridge (preload.js → contextBridge.exposeInMainWorld)   │
└───────────────────────────────────────────────────────────────┘
          │ contextBridge        │ child_process.spawn
          ▼                      ▼
┌─────────────────────┐  ┌──────────────────────────────────────┐
│  Renderer (sandbox) │  │  Backend (Node + Express)            │
│  Next.js app        │  │  ─ /chat, /projects, /documents, …   │
│  ─ supabase shim    │  │  ─ JWT auth middleware (HS256)       │
│  ─ getApiPort,      │◀─┤  ─ better-sqlite3 + migration runner │
│    getToken via IPC │  │  ─ Local-FS storage (path guarded)   │
└─────────────────────┘  │  ─ LLM clients (Claude, Gemini)      │
                         │  ─ LibreOffice convert (timeout-bound) │
                         └──────────────────────────────────────┘
```

### Process model

When AraLegal launches:

1. Electron main creates the BrowserWindow with the lock screen
   (`electron/lock/lock.html`). Renderer is sandboxed, no nodeIntegration,
   contextIsolation on, with a CSP that locks `script-src` / `connect-src`
   to `'self'` + `localhost` + the AI providers.
2. User picks a workspace and enters their password. `electron/auth.ts`
   verifies against the scrypt hash in `<workspace>/.aralegal/auth.json`.
3. On success, Electron mints **two random per-launch secrets**:
   - `JWT_SECRET` (32 random bytes, hex) — signs the session JWT the
     renderer presents to the backend.
   - `DOWNLOAD_SIGNING_SECRET` (another 32 random bytes) — signs
     non-expiring download URLs for stored files.
4. Electron spawns the backend (`backend/dist/index.js` via
   `process.execPath` with `ELECTRON_RUN_AS_NODE=1`) with these secrets
   in env, plus `WORKSPACE_PATH`, `LOCAL_USER_*`, the user's API keys,
   and `PORT=0` (OS-assigned port).
5. Backend writes the assigned port to
   `<workspace>/.aralegal/runtime.json`; Electron reads it and waits for
   `/health` to return 200 before navigating the renderer.
6. Renderer loads the Next.js frontend, calls `aralegal.getApiPort()` and
   `aralegal.getToken()` over IPC, attaches `Authorization: Bearer …` to
   every API request.

When the user clicks **Sign out** (or closes the window):
- Renderer clears its cached bridge state.
- Electron tears down the backend + frontend children, drops both
  secrets, returns to the lock screen.

The JWT and download secrets never persist across launches. There's no
"remember me".

### IPC surface (preload)

`electron/preload.js` exposes only this — minimal, all
parameter-validated on the main side:

```js
window.aralegal = {
  getState, pickWorkspace, setPassword, unlock,   // lock screen
  getToken, getUser, getApiPort,                   // post-unlock
  signOut, changePassword,
};
```

`setPassword` rejects unless the caller is the lock screen
(`event.sender === lockWebContents`).

### supabase compat shim

The frontend was originally a Supabase Postgres client. Rather than
rewriting every `db.from('x').select(...).eq(...)` chain, the backend
ships a **query-builder shim** at `backend/src/db/supabaseShim.ts` that
mimics the supabase-js builder API (eq, neq, in, or, ilike, range, order,
limit, contains, single, maybeSingle, RPC) and compiles to SQL against
`better-sqlite3`. JSONB columns are stored as TEXT and round-tripped
through JSON.stringify/parse automatically (per `JSON_COLUMNS_BY_TABLE`).

The frontend's `supabase.auth.*` calls go through `frontend/src/lib/supabase.ts`,
which is a thin shim over `window.aralegal.getToken/getUser/signOut`. The
JWT is cached at module scope on first read (stable for the launch
lifetime) and cleared on signOut.

### LibreOffice conversion

Bundled via electron-builder's `extraResources` from `vendor/libreoffice/`
(populated by `scripts/fetch-libreoffice.js`, which downloads the
official MSI from The Document Foundation, SHA-256 verifies it, and
extracts via `msiexec /a`). The backend probes for `soffice.exe` at
`<process.resourcesPath>/libreoffice/program/soffice.exe` first, with a
dev-fallback to the repo-root `vendor/` copy.

Conversions are wrapped with:
- A 60-second timeout (kills the soffice child if exceeded).
- A 200 MB output cap (rejects any conversion that produces a runaway
  PDF before returning the buffer).
- An env-scrub that hides `JWT_SECRET`, `DOWNLOAD_SIGNING_SECRET`, and
  the AI provider API keys from the soffice child.

---

## Security model

### Threat model

This is a **single-user local desktop app**. The threat model is:

1. **Casual access to the workspace folder** (another OS user, a backup
   that landed somewhere shared, a stolen laptop). The password gate
   defends against this.
2. **A compromised renderer** (XSS in LLM-rendered markdown, malicious
   embedded SVG/JS in a chat response). Sandbox + CSP + minimal preload
   API defend against this.
3. **A redistribution attack on the LibreOffice MSI**. SHA-256
   verification at fetch time defends against this.

It is **not** a defense against:

- An attacker with root/admin on the same machine (they can read RAM,
  inject DLLs, attach a debugger).
- An attacker who already knows the password.

### Password storage

`auth.json` in the workspace's `.aralegal/` directory holds:

```json
{
  "version": 1,
  "algo": "scrypt",
  "salt": "<base64, 16 random bytes>",
  "hash": "<base64, 64-byte derived key>",
  "N": 131072, "r": 8, "p": 1, "keylen": 64
}
```

Parameters tuned for ~400 ms per derive on a modern laptop (~128 MB
working set), giving meaningful resistance to offline brute-force if the
workspace is ever exfiltrated. Lazy-upgrade: if you raise the params and
re-unlock, the hash gets re-derived and rewritten transparently.

### JWT (HS256, hand-rolled)

`backend/src/auth/local.ts` implements minimal HS256 JWT helpers backed
by Node `crypto` — no `jsonwebtoken` dependency. The verifier checks:

- `header.alg === "HS256"`, `header.typ === "JWT"`
- HMAC signature via `crypto.timingSafeEqual`
- `payload.exp` is a finite number, not in the past
- `payload.sub` is a non-empty string

Tokens expire after 24 hours (configurable in `electron/main.ts`
`JWT_TTL_SECONDS`); the per-launch secret rotation means they don't
survive a relaunch anyway.

### Renderer hardening

`electron/main.ts` BrowserWindow:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true` (default, not overridden)

CSP (packaged builds only — dev mode skips it for Turbopack
compatibility):

```
default-src 'self' http://localhost:* ws://localhost:*;
script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*;
style-src 'self' 'unsafe-inline' http://localhost:*;
img-src 'self' data: blob: http://localhost:*;
font-src 'self' data: http://localhost:*;
connect-src 'self' http://localhost:* ws://localhost:*
            https://api.anthropic.com https://generativelanguage.googleapis.com;
frame-src 'none'; object-src 'none'; base-uri 'self';
```

Any upstream CSP is stripped first so this one applies. DevTools is
disabled in packaged builds (and on the lock screen always); F12 /
Ctrl+Shift+I are no-ops.

### Filesystem boundaries

`backend/src/lib/storage.ts` enforces that every path supplied via API
resolves (post-`fs.realpath`) inside `<workspace>/files/`. Path-traversal
attempts (`../../etc/passwd`-style or symlink-escape) return a 404. All
storage keys are server-generated; user-supplied filenames are only used
for display and download `Content-Disposition`, never as path components.

### Lockout state

`<workspace>/.aralegal/auth-state.json` tracks failed-attempt count and
lockout deadline. **Documented as a UX rate-limit, not an offline-attack
defense** — a user with shell access can edit/delete the file to reset
the counter. The real offline-attack defense is the scrypt parameters
(see `DECISIONS.md` 2026-05-03).

---

## Data layout

```
<your workspace>/
├── .aralegal/
│   ├── auth.json            scrypt password hash + parameters
│   ├── auth-state.json      lockout state (UX rate-limit)
│   ├── aralegal.db              SQLite — projects, chats, documents,
│   │                        document_versions, tabular_reviews, profiles, …
│   ├── aralegal.db-wal          SQLite WAL journal
│   ├── aralegal.db-shm          SQLite shared-memory file
│   └── runtime.json         backend's assigned port + PID (overwritten on launch)
└── files/
    ├── documents/local-user/<doc-id>/
    │   ├── source.<ext>          original upload
    │   └── versions/<vid>/...    edited versions
    └── converted-pdfs/<userId>/<docId>.pdf   LibreOffice-converted previews
```

Outside the workspace, AraLegal writes only to Electron's `userData`
directory (typically `%APPDATA%/AraLegal/`):

```
%APPDATA%/AraLegal/
├── config.json   { "lastWorkspace": "C:\\Users\\…\\AraLegalWorkspace" }
└── (no other persistent state)
```

---

## Building from source

### Prerequisites

- Node 20+ (the project pins `@types/node` to 22.x in devDependencies;
  any 20+ runtime works).
- npm 10+.
- Windows 10/11 with **Developer Mode enabled** (Settings → Privacy &
  Security → For developers). Required for `electron-builder` to extract
  symlinks from the macOS code-sign bundle on first run. After first
  successful build, the toolkit caches and Developer Mode is no longer
  required.
- Admin shell is also acceptable instead of Developer Mode.

### One-time setup

```bash
# Install deps for all three workspaces (root, frontend, backend)
npm run install:all
```

### Development

```bash
# Concurrently runs:
#   FRONTEND  → next dev (localhost:3000, Turbopack)
#   ELECTRON  → wait-on :3000, build electron, launch electron .
# Electron's main spawns the backend with tsx watch.
npm run dev
```

The Electron window comes up showing the lock screen. Pick a workspace,
set a password, unlock — the renderer navigates to `localhost:3000`.

DevTools (F12) works in dev only.

### Production build

```bash
# Chains:
#   1. fetch:libreoffice  (idempotent — skips if already extracted)
#   2. build              (electron + backend + frontend)
#   3. electron-builder   (NSIS installer)
npm run dist
```

The installer ends up at `dist/AraLegal-Setup-<version>.exe` (~480 MB with
bundled LibreOffice).

> **First-time `fetch:libreoffice`** downloads ~290 MB from
> https://download.documentfoundation.org and extracts ~1.5 GB into
> `vendor/libreoffice/`. Re-runs are no-ops while
> `vendor/libreoffice/program/soffice.exe` exists.

> **Native modules** — `better-sqlite3` and `@napi-rs/canvas` ship
> native binaries that must be built against Electron's Node ABI, not
> the system Node. `electron-builder install-app-deps` handles this
> during `npm run dist`. If you see "wrong NODE_MODULE_VERSION" at
> runtime, run `npm run rebuild-native`.

> **EPERM during build** — if `npm run dist` fails with
> `EPERM: operation not permitted, unlink … better_sqlite3.node`, you
> have a leftover `tsx watch` from a prior `npm run dev` holding the
> file. Stop the watcher (Ctrl+C the dev terminal) or kill the orphaned
> node process and retry.

### Quick rebuilds

```bash
npm run build:electron    # tsc + copy preload.js + lock/
npm run build:backend     # tsc + stage-backend (rebuild native modules)
npm run build:frontend    # next build + stage-frontend
```

---

## Project layout

```
aralocal/
├── electron/                    Electron main process
│   ├── main.ts                  app lifecycle, IPC handlers, CSP, DevTools gating
│   ├── auth.ts                  scrypt password hash + verify, lockout state
│   ├── jwt.ts                   HS256 token signer (mirror of backend verifier)
│   ├── secrets.ts               read API keys from workspace
│   ├── workspace.ts             pick workspace, atomic file write,
│   │                            install-dir guard, realpath
│   ├── backend.ts               spawn/wait/stop the Express backend
│   ├── frontend.ts              spawn/wait/stop the Next.js standalone server
│   ├── paths.ts                 resolve dist paths in dev vs packaged
│   ├── preload.js               contextBridge → window.aralegal
│   ├── logging.ts               file logging with secret redaction
│   └── lock/                    lock-screen HTML/CSS/JS (sandbox-safe)
│
├── frontend/                    Next.js 16 app (the renderer)
│   └── src/
│       ├── app/                 routes, components, hooks
│       ├── contexts/            AuthContext, UserProfileContext, ChatHistoryContext
│       └── lib/supabase.ts      shim over window.aralegal.* IPC
│
├── backend/                     Express API
│   ├── src/
│   │   ├── index.ts             app setup, CORS, error handler, listen
│   │   ├── db/
│   │   │   ├── sqlite.ts        better-sqlite3 client + WAL pragma
│   │   │   ├── migrate.ts       runs migrations/*.sqlite.sql in order
│   │   │   └── supabaseShim.ts  query-builder compat (~600 lines)
│   │   ├── auth/local.ts        HS256 JWT signer + verifier
│   │   ├── middleware/auth.ts   requireAuth, requireApiKey
│   │   ├── lib/
│   │   │   ├── storage.ts       local-FS storage with realpath traversal guard
│   │   │   ├── upload.ts        multer wrapper (100 MB cap)
│   │   │   ├── convert.ts       LibreOffice DOCX→PDF (60s timeout, 200 MB cap)
│   │   │   ├── downloadTokens.ts HMAC-signed download URLs
│   │   │   ├── safeSpawn.ts     env-scrubbed child spawn helper
│   │   │   ├── libreofficeStatus.ts  bundled-soffice probe
│   │   │   ├── llm/             Claude + Gemini clients, tool dispatch
│   │   │   └── ...
│   │   └── routes/              chat, projects, documents, tabular,
│   │                            workflows, user, downloads, files, auth
│   └── migrations/
│       └── 001_sqlite_schema.sql   full schema (UUID → TEXT, JSONB → TEXT,
│                                    RLS dropped, FK enforcement on)
│
├── scripts/                     Build helpers
│   ├── copy-electron-assets.js  preload.js + lock/ → dist-electron/
│   ├── fetch-libreoffice.js     download + verify + extract MSI → vendor/
│   ├── stage-backend.js         stage compiled backend + prod node_modules,
│   │                            rebuild native modules for Electron ABI
│   ├── stage-frontend.js        stage Next.js standalone output
│   └── electron-boot-check.js   smoke test that the window opens (manual)
│
├── vendor/                      gitignored — populated by fetch-libreoffice
├── dist/                        gitignored — installer + electron-builder output
├── dist-electron/               gitignored — compiled electron/*.ts
├── backend/.dist-bundle/        gitignored — staged backend for packaging
│
├── .claude/phases/              per-phase implementation notes (committed)
├── DECISIONS.md                 architectural decision log (committed)
├── TODO.md                      deferred fixes / known issues (committed)
├── CODE-REVIEW-0.2.0.md         pre-ship code review report (committed)
└── README.md                    this file
```

---

## Tech stack

| Layer        | Tech                                                          |
|--------------|---------------------------------------------------------------|
| Shell        | Electron 33 (Chromium 130, Node 20)                           |
| Renderer     | Next.js 16 (Turbopack), React 19, TypeScript 5, Tailwind 4    |
| Backend      | Express 4, TypeScript 5, tsx (dev), Node 20                   |
| Database     | SQLite via `better-sqlite3` (synchronous, WAL mode)           |
| Auth         | Node `crypto` (scrypt + HS256 HMAC) — no third-party deps     |
| File storage | Plain filesystem under `<workspace>/files/`                   |
| LLM          | `@anthropic-ai/sdk`, `@google/generative-ai`                  |
| DOCX→PDF     | LibreOffice 25.8.6 bundled via `libreoffice-convert`          |
| Packaging    | electron-builder + NSIS (Windows)                             |
| Dev tooling  | concurrently, wait-on, cross-env, tsx, electron-rebuild       |

---

## What's different from upstream

See `DECISIONS.md` for the full reasoning. High points:

- **Supabase Auth** → local scrypt password (`auth.json`) + per-launch
  random HS256 JWT secret in env, hand-rolled `crypto.HMAC` (no
  `jsonwebtoken` dep).
- **Supabase Postgres** → SQLite (`better-sqlite3`) via `supabaseShim.ts`
  that mimics the `supabase-js` query builder. Schema port: RLS
  dropped, JSONB → TEXT, UUID → TEXT, plpgsql triggers → `created_at
  DEFAULT CURRENT_TIMESTAMP`. Every route handler enforces its own
  `WHERE user_id = ?` post-RLS-removal.
- **S3/R2** → local filesystem under `<workspace>/files/`, with a
  realpath-based path-traversal guard in `storage.ts`.
- **LibreOffice** is now **bundled** with the installer (was: optional
  external install in earlier versions). Backend probes the bundled
  copy first, with a system-PATH fallback for non-Windows dev.
- **Cloudflare/OpenNext deploy path** removed; frontend uses Next.js
  `output: 'standalone'` for offline packaging.
- **Windows-first**; macOS / Linux installers are an electron-builder
  config addition away (`"mac"` and `"linux"` blocks).
- **No telemetry**, no analytics, no error reporting service.
  Logs stay on disk in the workspace.
- **API keys** stored in SQLite `user_profiles` (same as upstream's
  Postgres design) rather than `safeStorage.encryptString` — gated by
  the workspace password, so encryption-at-rest beyond that adds
  complexity without raising the bar against an attacker who already
  has filesystem access.

---

## Known limitations

Tracked in `TODO.md`. Highlights:

- **Code signing**: the `.exe` is unsigned. Windows SmartScreen warns
  on first run. Click "More info" → "Run anyway".
- **Auto-update**: not implemented. New versions require a manual
  reinstall (workspace data is preserved across reinstalls).
- **Multi-user**: not supported. Multiple OS users on the same machine
  should each pick their own workspace folder.
- **Logout button**: closes the window/returns to lock screen rather
  than backgrounding the app. To "log out", close and reopen.
- **Cross-platform**: Windows only for now. macOS / Linux is a config
  addition.
- **Next.js 16.0.3 has a security advisory (CVE-2025-66478)**. Bumping
  to the latest 16.x patch is on the to-do list. Lower urgency for
  this loopback-only deployment but worth tracking.

---

## License

AGPL-3.0-only — same as upstream. See `LICENSE`. All derivative source
remains open under the same terms.

---

## Project conventions (for contributors)

- **Phases**: substantial work is broken into numbered phases under
  `.claude/phases/PHASE-NN-{active|done}.md`. One active phase at a
  time. See `.claude/phases/PHASE-08-done.md` for the latest example.
- **Decisions**: every non-trivial technical decision goes in
  `DECISIONS.md` with the *why*, not just the *what*. Append-only.
- **Commits**: Conventional Commits (`feat`, `fix`, `refactor`, etc.),
  scope by area (`feat(security): ...`, `fix(chat): ...`).
- **Reviews**: pre-ship code reviews land in
  `CODE-REVIEW-<version>.md`. Each finding is either fixed in-session
  or moved to `TODO.md` with a note on why it was deferred.
