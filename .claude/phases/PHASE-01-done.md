# Phase 01 — Bootstrap & Audit
Status: DONE

## Goal
Clone the upstream repo, audit Supabase / storage / schema touchpoints, set up phase tracking, log decisions, and produce a concrete file-by-file modification plan for subsequent phases.

## Tasks
- [x] Clone `github.com/rafal-fryc/mikelocal` into working directory
- [x] Inventory backend Supabase touchpoints (14 files identified)
- [x] Inventory frontend Supabase touchpoints (15 files identified)
- [x] Read schema, identify Postgres-only features (RLS, jsonb GIN, plpgsql triggers, pgcrypto)
- [x] Read storage interface (`backend/src/lib/storage.ts` — clean adapter, easy swap)
- [x] Read auth middleware (`backend/src/middleware/auth.ts` — 37 lines, simple)
- [x] Create `.claude/phases/`
- [x] Create `DECISIONS.md`

## Acceptance Criteria
- Repo cloned with full source intact
- `DECISIONS.md` lists at minimum: Electron, SQLite, bcrypt+JWT, safeStorage, no LibreOffice bundle, AGPL-3.0 acknowledgement
- Concrete list of files to modify in PHASE-02..08 (in this file)
- This file renamed to `PHASE-01-done.md`

## Confirmed File-by-File Targets

### Backend — files needing Supabase removal
- `backend/src/middleware/auth.ts` — replace with local JWT verify
- `backend/src/lib/supabase.ts` — delete; new `db/sqlite.ts` + `auth/local.ts`
- `backend/src/lib/access.ts` — uses Supabase client for ACL checks
- `backend/src/lib/userSettings.ts` — reads `user_profiles` (move to SQLite)
- `backend/src/lib/documentVersions.ts` — uses Supabase client
- `backend/src/lib/chatTools.ts` (2838 lines!) — large LLM tool definitions, Supabase calls inside
- `backend/src/routes/chat.ts`, `documents.ts`, `downloads.ts`, `projectChat.ts`, `projects.ts`, `tabular.ts`, `user.ts`, `workflows.ts` — all Supabase calls swap to SQLite

### Backend — storage & config
- `backend/src/lib/storage.ts` — replace S3 implementation with local-FS implementation; keep same exported functions
- `backend/src/index.ts` — config bootstrap, mount new `/api/auth` and `/api/settings` routes
- `backend/.env.example` — drop SUPABASE/R2; keep PORT/FRONTEND_URL only (keys come from safeStorage)

### Backend — schema port
- `backend/migrations/000_one_shot_schema.sql` — keep for reference
- `backend/migrations/001_sqlite_schema.sql` — NEW: SQLite-compatible port (no RLS, no jsonb-as-type, no plpgsql triggers, uuid→text, gen_random_uuid()→app-side crypto.randomUUID())
- New migration runner in `backend/src/db/migrate.ts`

### Frontend — files needing Supabase removal
- `frontend/src/lib/supabase.ts`, `supabase-server.ts`, `auth.ts` — delete
- `frontend/src/contexts/AuthContext.tsx`, `UserProfileContext.tsx` — replace with local auth client
- `frontend/src/app/login/page.tsx`, `signup/page.tsx` — replace with local-password lock screen
- `frontend/src/app/lib/mikeApi.ts` — base URL from electron preload
- `frontend/src/app/hooks/useFetchSingleDoc.ts`, `useFetchDocxBytes.ts`, `useDocumentVersions.ts` — strip Supabase token, use local JWT
- `frontend/src/app/components/shared/DocPanel.tsx`, `DocxView.tsx` — same
- `frontend/src/app/components/assistant/EditCard.tsx`, `AssistantMessage.tsx` — same
- `frontend/.env.local.example` — remove all Supabase entries

### Frontend — packaging
- `frontend/package.json` — remove `@opennextjs/cloudflare`, `wrangler`, cloudflare-specific scripts
- `frontend/next.config.ts` — switch to standard Next.js or `output: 'export'` (decide in PHASE-08)
- Delete `frontend/open-next.config.ts`

### NEW files (to be created in later phases)
- `electron/main.ts`, `preload.ts`, `workspace.ts`, `secrets.ts`, `windows.ts` (PHASE-02)
- `backend/src/db/sqlite.ts`, `db/migrate.ts` (PHASE-04)
- `backend/src/auth/local.ts`, `backend/src/routes/auth.ts` (PHASE-03)
- `backend/src/routes/settings.ts` (PHASE-06)
- `frontend/src/app/(pages)/account/settings/page.tsx` (PHASE-06 — extend existing account section)
- Root `package.json`, `electron-builder.yml` (PHASE-08)

## Decisions Made This Phase
- Electron + Express + Next.js as three layers (logged to `DECISIONS.md`)
- SQLite via `better-sqlite3` (logged)
- bcryptjs + jsonwebtoken for local auth (logged)
- Electron `safeStorage` for API keys + password hash (logged)
- LibreOffice not bundled — runtime detection w/ graceful fallback (logged)
- No code signing in v1 (logged)
- Windows-first; macOS/Linux deferred (logged)
- Drop Cloudflare/OpenNext packaging entirely — Next.js bundled into Electron (logged)
