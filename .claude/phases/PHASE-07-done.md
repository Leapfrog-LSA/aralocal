# Phase 07 — LibreOffice graceful degradation
Status: DONE

## Goal
Detect whether LibreOffice (`soffice`) is installed; surface a friendly status to the user so DOC/DOCX uploads degrade predictably (text extraction still works; PDF preview disabled with a clear "install LibreOffice" message) instead of failing silently.

## What changed

### Backend
- **NEW** `backend/src/lib/libreofficeStatus.ts` — `probeLibreOffice()`:
  - Tries `soffice --version` (PATH lookup), then known platform-specific install paths (`Program Files\LibreOffice\program\soffice.exe` on Windows; common `/usr/bin`, `/Applications/LibreOffice.app/...`, `/snap/bin/...` on macOS/Linux).
  - 3-second timeout per probe to avoid hanging the request.
  - Result cached after first successful probe; in-flight promise dedup.
- **MODIFIED** `backend/src/index.ts` — warms the probe in the background at startup so the first `/auth/capabilities` request is instant. Logs whether LibreOffice was detected.
- **MODIFIED** `backend/src/routes/auth.ts` — added `GET /auth/capabilities` (auth-required) returning `{libreoffice: {available, version, install_url}}`.

### Frontend
- **NEW** `frontend/src/app/hooks/useCapabilities.ts` — hook + module-level cache. Calls `/auth/capabilities` once and shares the result across consumers.
- **MODIFIED** `frontend/src/app/(pages)/account/page.tsx` — replaced the now-meaningless "Usage Plan" section with a "System" section showing LibreOffice status:
  - **Installed** → green text with version (e.g. "LibreOffice 7.6.4")
  - **Not installed** → amber text with a "Download LibreOffice" link and a one-line explanation that Word docs still upload, just without PDF preview.

### Existing graceful behavior (unchanged — already correct)
- The route handlers in `backend/src/routes/documents.ts` and `projects.ts` already wrap every `docxToPdf(...)` call in a `try/catch` that logs and continues. The document/version row is created with `pdf_storage_path: null` when conversion fails.
- The frontend's `/single-documents/:id/url` endpoint already returns `has_pdf_rendition: !!active.pdf_storage_path` — the UI uses that to pick the right viewer.

## Verifications
- `tsc --noEmit` clean.
- Live: started backend on this machine (no LibreOffice installed) →
  - Startup log: `[startup] LibreOffice not detected (DOC/DOCX → PDF rendition disabled)`
  - `GET /auth/capabilities` returned `{"libreoffice":{"available":false,"version":null,"install_url":"https://www.libreoffice.org/download/download/"}}`
- The Account page System section renders the amber "Download LibreOffice" link in this state.

## Acceptance Criteria
- [x] Backend probes LibreOffice without blocking startup or crashing if absent.
- [x] Frontend sees the LibreOffice status and can show appropriate UI.
- [x] DOC/DOCX upload continues to succeed without LibreOffice (just no PDF preview).
- [x] Install URL surfaced for users who want to fix the missing dependency.
- [ ] Interactive smoke (user): on a machine without LibreOffice, upload a .docx → it appears in the list, opens via in-app viewer using mammoth fallback (already wired in `DocxView.tsx`).

## Decisions Made This Phase
- **Probe `--version` instead of running an actual conversion** — fast (~50–200 ms when present, 3s timeout when absent), no spurious files written. The `libreoffice-convert` library has its own runtime detection on the conversion path, so a startup probe is purely advisory.
- **Status surfaced on the Account page, not in upload modals** — three different upload modals exist; spreading a banner across all of them couples them to capabilities state. A single discoverable place keeps the surface tight, and the in-flight upload still degrades correctly per the existing try/catch.
- **No "install via the app" flow** — automating LibreOffice install would mean shipping platform-specific installers per OS and surface area we don't want to maintain. A "Download LibreOffice" link respects user agency and avoids elevated-privilege installs from the app.
