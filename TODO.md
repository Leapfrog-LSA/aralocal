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
