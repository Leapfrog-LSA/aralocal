# Mike (local desktop edition)

A downloadable desktop version of the Mike AI legal platform. Everything runs
on your computer: documents, database, settings. No Supabase, no cloud
storage, no external login.

This fork rewires the upstream `rafal-fryc/mikelocal` web app to:

- store data in a SQLite database inside a workspace folder you pick
- save documents to that same workspace folder
- protect the app with a local password
- ship as a Windows installer (NSIS) — no browser needed

The original architecture (Next.js + Express) is preserved; an Electron shell
spawns both as child processes and gates them behind a lock screen.

## Using the app (after install)

1. Run the installer.
2. Launch **Mike** from the Start menu.
3. **First launch** — pick a workspace folder. This is where your documents,
   database, and settings will live. Pick somewhere you back up (e.g. inside
   `Documents`).
4. **Set a password.** You'll enter it every time you open Mike. It can't be
   recovered, so write it down somewhere safe.
5. **Settings → Account → API Keys** — paste in at least one model provider
   key (Anthropic and/or Gemini). Links to where to get each key are
   alongside the form.
6. (Optional) Install [LibreOffice](https://www.libreoffice.org/download/download/)
   if you want Word documents (`.docx` / `.doc`) to render as PDF previews
   inside the app. Without it, you can still upload Word files; you just
   won't get the PDF preview.

The lock screen shows on every launch. Five wrong passwords trigger a
30-second lockout.

## Building from source

```bash
# Install deps for all three workspaces
npm run install:all
```

```bash
# Run the dev stack (frontend + electron, electron spawns the backend)
npm run dev
```

```bash
# Produce the NSIS installer in dist/
npm run dist
```

The installer ends up at `dist/Mike-Setup-<version>.exe`.

> **Native modules** — `better-sqlite3` ships a native binary that must be
> built against Electron's Node version, not your system Node. `electron-builder`
> handles this automatically when running `npm run dist` (via
> `install-app-deps`). If you ever see "wrong NODE_MODULE_VERSION" at runtime,
> run `npm run rebuild-native`.

## Where everything lives

```
<your workspace>/
├── .mike/
│   ├── auth.json          ← scrypt password hash
│   ├── mike.db            ← SQLite (all projects, chats, documents, profiles)
│   └── mike.db-wal, -shm  ← SQLite WAL journal files
└── files/
    ├── documents/local-user/<doc-id>/source.<ext>
    ├── documents/local-user/<doc-id>/versions/...
    └── converted-pdfs/...
```

You can copy this folder to back up Mike. To start fresh, delete it (or pick
a different workspace folder on next launch).

## What's different from upstream

See `DECISIONS.md` for the full list. High points:

- Supabase Auth → local scrypt password + per-launch HS256 JWT
- Supabase Postgres → SQLite (`better-sqlite3`) via a compat shim that lets
  every existing `db.from('x').select(...)` route handler keep working
- S3/R2 → local filesystem under `<workspace>/files/`
- LibreOffice **not bundled** — detected at runtime, app degrades gracefully
- Cloudflare/OpenNext deploy path removed
- Windows-first; macOS / Linux installers are an electron-builder config
  change away

## Project layout

```
mikelocal/
├── electron/              Electron main process, lock screen, IPC bridge
├── frontend/              Next.js app (the renderer)
├── backend/               Express API + SQLite + storage
│   ├── src/db/            SQLite client, migrations, Supabase compat shim
│   ├── src/auth/          Local JWT signer/verifier
│   ├── src/lib/storage.ts Local-FS storage with path-traversal guard
│   └── migrations/        SQLite schema
├── scripts/               Build helpers (electron asset copy, frontend stage)
├── .claude/phases/        Per-phase implementation notes
└── DECISIONS.md           Architectural decision log
```

## Development notes

- **Code signing**: the `.exe` is unsigned. Windows SmartScreen will warn the
  first time it runs. Click "More info" → "Run anyway". Future versions may
  add Authenticode signing.
- **Auto-update**: not implemented. New versions require a manual reinstall.
- **Multi-user**: not supported. Multiple OS users on the same machine should
  each pick their own workspace folder.

## License

AGPL-3.0-only — same as upstream. See `LICENSE`.
