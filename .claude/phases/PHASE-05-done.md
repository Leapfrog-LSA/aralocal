# Phase 05 — Local file storage (replace S3/R2)
Status: DONE

## Goal
Drop the Cloudflare R2/S3 storage layer; persist all uploaded documents and rendered PDFs under `<WORKSPACE_PATH>/files/`. Match the existing module's exported surface so callers don't change.

## What changed

### Modified
- **`backend/src/lib/storage.ts`** — full rewrite:
  - `uploadFile/downloadFile/deleteFile` now use `fs.promises` against `<workspace>/files/<key>`.
  - `resolveSafe(key)` rejects keys whose absolute resolution falls outside the files root (path-traversal guard). Verified against `../`, absolute paths, and nested `../` traversal.
  - `storageEnabled` is hard-wired to `true` (workspace existence is the new precondition; backend won't start without `WORKSPACE_PATH`).
  - All key-helper exports (`storageKey`, `pdfStorageKey`, `generatedDocKey`, `versionStorageKey`, `normalizeDownloadFilename`, `buildContentDisposition`, etc.) preserved unchanged.
- **`backend/src/lib/storage.ts`** also gains:
  - `signFileToken(key, filename, ttl)` and `verifyFileToken(token)` — short-lived HS256 tokens that bake in the storage key + intended download filename. Same `JWT_SECRET` as the auth JWTs.
  - `getSignedUrl(key, expiresIn, downloadFilename)` now returns `http://localhost:<PORT>/files?t=<token>` — drop-in replacement for the R2 pre-signed URL.
- **`backend/src/index.ts`** — mounts `filesRouter` at `/files`.

### New
- **`backend/src/routes/files.ts`** — `GET /files?t=<token>`:
  - Verifies the file token; rejects missing/expired/tampered with 400/401.
  - Streams the file from disk with proper `Content-Type` (extension-based) and `Content-Disposition: inline` carrying the requested download filename.
  - No auth header needed — works in `<iframe src>` / `<a href>` exactly like an R2 pre-signed URL.

### Unchanged (intentional)
- `backend/src/routes/documents.ts` — the only `getSignedUrl` caller. Still gets a URL string back; the new URL just points to the local backend instead of R2.
- `backend/src/lib/upload.ts` — multer memory storage upstream of `uploadFile`; unaffected by the storage backend swap.

## Verifications (live)

- `tsc --noEmit` clean.
- Wrote a file at `<workspace>/files/documents/local-user/abc/source.txt` directly, called `getSignedUrl(...)`, fetched the URL with `curl`:
  - `200 OK`, correct `Content-Type: text/plain; charset=utf-8`, correct `Content-Disposition: inline; filename="hello.txt"; filename*=UTF-8''hello.txt`, body matches.
- Tampered token (extra chars) → `401 Invalid file token signature`.
- Missing token → `400 Missing token`.
- Path-traversal smoke — all rejected:
  - `../../etc/evil.txt` → `Storage key escapes workspace`
  - `/absolute/etc/evil.txt` → `Storage key escapes workspace`
  - `subdir/../../../etc/evil.txt` → `Storage key escapes workspace`

## Acceptance Criteria
- [x] R2/S3 calls gone from `backend/src/lib/storage.ts`.
- [x] All `uploadFile`/`downloadFile`/`deleteFile`/`getSignedUrl` callers compile unchanged.
- [x] `getSignedUrl` URLs are usable in cross-origin contexts (CORS already enabled on the Express app).
- [x] Path-traversal blocked on read, write, and delete paths (all funnel through `resolveSafe`).
- [ ] Interactive smoke (user): upload a PDF inside the running app, see it open via `/single-documents/:id/url`.

## Decisions Made This Phase
- **`@aws-sdk/*` deps left in `backend/package.json` for now** — not used after this rewrite, but removing them is cleanup that belongs to PHASE-08 (packaging trim). Keeping them in source lets the existing Cloudflare/OpenNext deploy path of the upstream stay buildable for anyone who pulls our fork and wants both targets. (Could revisit in PHASE-08 if installer size is sensitive.)
- **File tokens use a separate `typ: "FT"` JWT header** — distinguishable from auth `JWT` tokens at a glance and makes the verify path explicit. Same secret keeps the env passing surface small.
- **`Content-Disposition: inline`** by default — frontend renders PDFs in `<iframe>`. Download buttons can override by adding `?download=1` later if needed; not used today, so deferred.
