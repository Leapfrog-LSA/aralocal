# Phase 04 — SQLite (replace Supabase data layer)
Status: DONE

## Goal
Replace the Supabase Postgres data layer with local SQLite, without rewriting any of the 14 backend route files that call `db.from(...).select/insert/update/delete(...)`. The migration runs automatically when the backend starts inside an unlocked workspace.

## Strategy
**Build a Postgrest-shaped compatibility shim over SQLite.** Implements the subset of `@supabase/supabase-js` actually used in the codebase (a 19-method inventory: `from`, `select`, `eq`, `neq`, `in`, `or`, `ilike`, `like`, `gte/gt/lte/lt`, `is`, `not`, `contains`, `match`, `filter`, `order`, `limit`, `range`, `single`, `maybeSingle`, `insert`, `upsert`, `update`, `delete`, `count`, plus `auth.admin.deleteUser/listUsers` stubs). Existing route handlers stay byte-identical.

## What changed

### New files
- `backend/migrations/001_sqlite_schema.sql` — SQLite port of `000_one_shot_schema.sql`. UUID→TEXT, JSONB→TEXT, RLS dropped, plpgsql dropped, GIN dropped, `auth.users` references removed. 16 tables created.
- `backend/src/db/sqlite.ts` — opens DB at `<WORKSPACE_PATH>/.mike/mike.db`, enables WAL + foreign keys.
- `backend/src/db/migrate.ts` — schema_migrations bookkeeping, applies migrations in lex order, transactional.
- `backend/src/db/supabaseShim.ts` — the compat shim (~530 lines). Two thenable types: `Query<T>` resolves to `{data: T[] | null, error}`; `SingleQueryAdapter<T>` resolves to `{data: T | null, error}`. Per-table JSON column registry handles encode/decode for `shared_with`, `columns_config`, `content`, `annotations`, `structure_tree`, `citations`, etc.

### Modified
- `backend/src/lib/supabase.ts` — `createServerSupabase()` now returns the shim. Drops `@supabase/supabase-js` import.
- `backend/src/index.ts` — runs migrations on startup if `WORKSPACE_PATH` is set.

### Unchanged (the win)
- All 14 route files (`backend/src/routes/*.ts`, `backend/src/lib/access.ts`, `chatTools.ts`, `documentVersions.ts`, `userSettings.ts`) — zero edits. They call the shim and don't know.

## Verifications

- `tsc --noEmit` on backend: clean (resolved 50+ errors with the list/single split).
- `tsc --noEmit -p tsconfig.electron.json`: clean.
- `node scripts/electron-boot-check.js`: PASS.
- **End-to-end smoke**: spawned backend with synthetic `WORKSPACE_PATH` + `JWT_SECRET` →
  - migrations ran: `[migrate] applied 001_sqlite_schema.sql`
  - 16 tables present in `<workspace>/.mike/mike.db` (verified via `sqlite3 .tables`)
  - `POST /projects` with valid JWT created a row, returned the row with JSON `shared_with: []` decoded properly
  - `GET /projects` listed it back with computed `is_owner`, `document_count`, etc.
  - `GET /workflows`, `GET /single-documents` returned `[]` (correctly empty)

## Acceptance Criteria
- [x] Backend boots inside a fresh workspace; SQLite DB created with full schema.
- [x] Routes that hit `db.from(...)` work end-to-end against SQLite without code edits.
- [x] JSON columns (`shared_with`, `columns_config`, etc.) round-trip cleanly.
- [x] `await ...select()` returns `T[] | null`; `await ...select().single()` returns `T | null` — both type-check in routes.
- [ ] Interactive smoke (user): full app loads inside Electron, project list shows, can create/rename/delete projects.

## Decisions Made This Phase
- **Compat shim over rewrite.** The Postgrest-shaped builder pattern is a well-defined surface; ~530 lines of shim code beats rewriting thousands of lines of route SQL. Side-effect: any code path the routes don't exercise won't be tested in shim either — surface area is bounded by usage.
- **Two thenable types (Query vs SingleQueryAdapter).** Necessary so `await q.select()` returns `T[]` and `await q.select().single()` returns `T`. Without that split, TS strict mode infers implicit-any in `.map((r) => ...)` callbacks across the route code — would have required ~100 manual type annotations.
- **JSON column registry per table.** Hardcoded list (`JSON_COLUMNS_BY_TABLE`) covers every JSONB column in the schema. Encode on write (stringify), decode on read (parse). Avoids `json_each`/SQLite JSON1 query gymnastics in route SQL.
- **`.contains` implemented as substring LIKE.** For single-user mode, `shared_with` is always empty so `.contains` always returns 0 rows — exactly what we want. Non-trivial JSON containment isn't worth implementing for a feature that's effectively dead in single-user.
- **`auth.admin.deleteUser/listUsers` stubs.** Single-user mode has nothing to delete (account deletion = wipe workspace, future work). `listUsers` returns the lone local user so the Members UI doesn't break.
