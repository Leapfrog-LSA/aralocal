# Deferred fixes / known issues

## Security

- **Next.js 16.0.3 has a security advisory** ([CVE-2025-66478](https://nextjs.org/blog/CVE-2025-66478)). Bump `frontend/package.json` `next` to the latest 16.x patch when convenient. Drop-in within the 16.x line.

## Dependency hygiene (low priority)

These all come from transitive deps inside `electron-builder` / `electron-rebuild` — not our code, not directly changeable. Track only:
- `inflight@1.0.6` — leaked memory module, deprecated
- `glob@7.2.3` — old, has security CVEs in its own deps
- `rimraf@2.7.1` — pre-v4, unsupported
- `lodash.isequal@4.5.0` — deprecated, use `node:util.isDeepStrictEqual`
- `fstream@1.0.12` — unsupported
- `next-step:` resolves on its own when `electron-builder` updates upstream

## Build / packaging

- **Code signing**: `.exe` is unsigned. Windows SmartScreen prompts users.
- **Auto-update**: not implemented. Manual reinstall for each release.
- **`npm run dist` requires Developer Mode (or admin) on Windows.** electron-builder
  unpacks `winCodeSign-2.6.0.7z`, which contains macOS symlinks (`libcrypto.dylib`,
  `libssl.dylib`). Extracting symlinks needs the SeCreateSymbolicLinkPrivilege.
  One-time fix: Settings → Privacy & Security → For developers → enable
  Developer Mode. Or run the build as administrator. After first success, the
  toolkit caches and subsequent builds skip the download.

## Behavior gaps

- **No "delete account" cleanup yet** — `DELETE /user/account` returns 204 but does nothing. Future: clear all SQLite tables and reset the password file.
- **Document conversion failures** when LibreOffice is missing log to console but don't surface to the user inside the upload flow. The Account → System section shows status, but a banner inside the upload modal would be friendlier.
- **No logout button works in desktop mode** — the AuthContext `signOut` is a no-op. To "log out", user must close and re-open the app. Acceptable for v1; revisit if needed.
- **Frontend depends on `mikelocal-desktop: "file:.."`** — npm added this during `install:all` from the workspace context. Harmless but unusual. Clean up later if it causes install issues elsewhere.

## Cross-platform

- **Windows-only NSIS installer** in v1. macOS / Linux targets are an `electron-builder` config addition (`"mac"` and `"linux"` blocks). Not yet tested.

## From CODE-REVIEW-0.2.0.md (Critical fixes landed; Important deferred to 0.2.1)

Critical (C1–C5) shipped: download-token signing secret, JWT alg/typ check + exp type-guard, sandbox flip, raw-stream log gate, chat_messages.workflow column mismatch.

Deferred Important items (full list in `CODE-REVIEW-0.2.0.md`):

- ~~CSP header on the renderer window~~ — landed (`electron/main.ts:installCsp`)
- ~~Disable DevTools in production builds (or at least on the lock screen)~~ — landed (`electron/main.ts` before-input gate + devtools-opened slam-shut)
- ~~HMAC-protect or migrate `auth-state.json` lockout state~~ — documented as a UX rate-limit only (`DECISIONS.md` 2026-05-03)
- ~~`electron/backend.ts` dev spawn uses `shell: true`~~ — investigated and **left as-is**. Reverted the `cmd.exe /c` form because it broke the dev backend silently (child exits before stdout is wired). All argv values here are static literals — no user input flows in — so the "future shell-injection footgun" risk doesn't bite. Production spawn uses `process.execPath` directly with no shell.
- ~~`electron/workspace.ts` `pickWorkspace` should `realpath` and reject install-dir-internal locations~~ — landed (`isInsideInstallTree` + `fs.realpathSync`)
- `electron/backend.ts` `getBackendPort` falls back to 3001 instead of erroring
- ~~Refuse `import "dotenv/config"` in the backend when packaged~~ — landed (gated on `WORKSPACE_PATH`)
- ~~`documents.ts:90` DELETE is the lone route that doesn't belt-and-braces filter by `user_id`~~ — landed
- ~~`projects.ts:558` folder-cleanup UPDATE not scoped to `project_id`~~ — landed
- Widen `migrate.ts` regex or move the Postgres one-shot schema out of `migrations/` (silent skip risk)
- Set `synchronous = NORMAL` to pair with WAL
- ~~Add a global Express error handler; align body limit (50mb) with upload limit (100mb)~~ — landed (handler returns generic 500, body limit now matches `MAX_UPLOAD_SIZE_BYTES`)
- ~~Use `127.0.0.1` instead of `localhost` in `getSignedUrl`~~ — landed
- ~~LibreOffice convert: 60s timeout + max output size~~ — landed (60s timeout, 200MB cap) cap
- `JWT_SECRET` length check at startup (≥32 bytes hex)
- ~~Frontend: drop dead `incrementMessageCredits` PATCH~~ — landed (function deleted; no callers in `frontend/src`, contrary to reviewer's claim it fired per turn)
- ~~Frontend: cache JWT at module scope rather than IPC-fetch on every API call~~ — landed (`frontend/src/lib/supabase.ts` cachedBridge, cleared in `signOut`)
- Frontend: `useCapabilities` cache never refreshes (UI lies if LO installed mid-session — though we now bundle, so lower urgency)
- Pin LibreOffice SHA in `fetch-libreoffice.js` source instead of fetching the sidecar same-channel as the MSI
- `stage-backend.js` `--no-package-lock` makes installer non-deterministic; check in a separate dist-bundle lockfile before v1.0
- ~~Cross-check `tabular_model` (snake) vs `tabularModel` (camel) field name~~ — verified non-issue (backend column `tabular_model`, frontend reads `p?.tabular_model` — match)

Plus minors listed in CODE-REVIEW-0.2.0.md.
