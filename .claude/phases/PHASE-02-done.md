# Phase 02 — Electron shell, workspace picker, lock screen
Status: DONE

## Goal
Wrap the existing app in Electron with a working first-launch flow: pick workspace → set password → log in. Backend still hits Supabase at this point (auth/data swap is PHASE-03/04). Goal is to verify the Electron + child-process plumbing.

## Tasks
- [x] Add root `package.json` with `electron`, `electron-builder`, `concurrently`, `cross-env`, `tsx`, `wait-on`
- [x] Create `electron/main.ts`: app lifecycle, window creation, IPC handlers
- [x] Create `electron/preload.js` (plain JS): contextBridge exposing `mike.*`
- [x] Create `electron/workspace.ts`: read/write `userData/config.json`, native folder picker, validation
- [x] Create `electron/secrets.ts`: safeStorage wrappers (write/read encrypted blob)
- [x] Create `electron/auth.ts`: scrypt password hashing + 5×/30s lockout (replaced bcryptjs — see decision below)
- [x] Create lock screen (`electron/lock/lock.{html,css,js}`)
- [x] Wire `npm run dev` at root: Electron main + Next.js dev + backend dev concurrently
- [x] `tsconfig.electron.json` + `scripts/copy-electron-assets.js` build pipeline
- [x] Type-check passes (`tsc --noEmit`)
- [x] Boot smoke check passes (`node scripts/electron-boot-check.js`)
- [ ] Interactive smoke (user): launch dev, pick workspace, set password, unlock — see existing app

## Acceptance Criteria
- `npm run dev` at repo root opens an Electron window
- First launch: folder picker appears
- Workspace path persisted in app userData
- "Set password" then "log in" flow works (bcrypt hash file written)
- After unlock, existing Next.js UI loads in the window
- Wrong password rejected; 5× lockout works
- File rename to `PHASE-02-done.md` only after manual smoke passes

## Decisions Made This Phase
- **scrypt instead of bcryptjs.** scrypt is built into Node `crypto` (no extra dep, no native module). Memory-hard hashing is appropriate here. PHASE-03 will revisit when JWT signing is added.
- **Single window, navigate to swap views.** Lock window loads `lock.html`; on successful unlock, the same window navigates to `localhost:3000`. Avoids multi-window IPC complexity.
- **Plain `.js` preload.** Electron's preload runs in a separate process; loading TS via tsx there isn't worth the friction. Preload is tiny.
- **Compile-then-run dev script.** Electron doesn't accept Node's `-r` flag, so `dev:electron` runs `tsc -p tsconfig.electron.json` + asset copy + `electron .`. Watch mode deferred.

## Smoke Test Steps (for user)

1. From repo root: `npm install` (already done) and `npm install --prefix frontend` and `npm install --prefix backend` if you want the full app to load post-unlock.
2. To test the lock screen alone (no frontend/backend needed): `npm run electron:lock-only`
3. To test full flow: `npm run dev` — opens 3 processes. Once frontend is reachable on :3000, Electron window opens with lock screen.
4. First launch: workspace picker → choose any folder → "Create password" form → set password → unlock → navigates to localhost:3000.
5. Quit. Relaunch. Lock screen should remember workspace and prompt for password directly.
6. 5 wrong passwords → 30s lockout message.
7. Verify `<workspace>/.mike/auth.json` exists and is JSON with `algo: "scrypt"`.
