# Phase 06 — API key Settings UI
Status: DONE

## Goal
Make the existing Settings UI work end-to-end against the local backend, so non-technical users can paste in their Anthropic / Gemini keys and have them take effect immediately.

## Strategic shift (logged in DECISIONS.md)
Originally planned: encrypt keys via Electron `safeStorage` to `<workspace>/.mike/secrets.enc`, inject as env at backend spawn. **Switched to**: store keys in `user_profiles` SQLite row (the upstream cloud app's own design). The workspace password already gates access; `safeStorage` only adds complexity (backend↔Electron IPC, restart-on-save) without meaningfully raising the bar.

## What changed

### Backend
- **`backend/src/routes/user.ts`** — added:
  - `GET /user/profile` → auto-creates the user_profiles row, returns it
  - `PATCH /user/profile` → partial update, allowlist of fields (`display_name`, `organisation`, `tabular_model`, `claude_api_key`, `gemini_api_key`, `message_credits_used`). Empty string normalizes to NULL.
  - `DELETE /user/account` → no-op success (in single-user local mode there's nothing to delete; the user clears the workspace folder if they want a fresh start).

### Frontend
- **`frontend/src/contexts/UserProfileContext.tsx`** — full rewrite:
  - All `supabase.from("user_profiles")...` calls replaced with `fetch(API_BASE + "/user/profile")` calls (GET / PATCH).
  - Same context API surface as before — every consumer (`ModelsAndApiKeysPage`, `account/page.tsx`, `useUserProfile()` callers) keeps working unchanged.
  - Local build is unmetered: `creditsRemaining` hard-wired to 999_999 so credit-gating UIs always pass.
- **`frontend/src/app/(pages)/account/models/page.tsx`** — small UX polish for non-technical users:
  - "Where do I get a Claude key?" / "Where do I get a Gemini key?" links per provider, pointing at the official console URLs (`console.anthropic.com/settings/keys`, `aistudio.google.com/app/apikey`).
  - Updated copy: removed the developer-aimed "if you are running your own instance" sentence; replaced with a sentence about workspace-local storage.

### Unchanged (intentional)
- LLM helpers (`backend/src/lib/llm/*.ts`) already accept an `apiKeys` override and fall back to env. No edits.
- `getUserApiKeys` / `getUserModelSettings` (`backend/src/lib/userSettings.ts`) — already shape-compatible; the shim's `.from("user_profiles")` calls work directly.
- Route handlers — they all already source keys via `getUserApiKeys(userId)` then pass to the LLM helpers.

## Verifications (live)
- `tsc --noEmit` clean.
- Spawned backend with synthetic workspace + JWT_SECRET, exercised:
  - `GET /user/profile` (initial) → row auto-created, returned with `claude_api_key: null`
  - `PATCH /user/profile {display_name, claude_api_key}` → fields persisted, returned updated row
  - Re-`GET /user/profile` → values still set
  - `PATCH /user/profile {claude_api_key: ""}` → key cleared (normalized to NULL)
  - `PATCH /user/profile {random_field: "x"}` → 400 "No allowed fields in body"

## Acceptance Criteria
- [x] Users can enter and save Claude / Gemini keys via the existing Settings page.
- [x] Saved keys persist across app restarts (SQLite is durable in the workspace).
- [x] LLM calls automatically use the saved keys (no backend restart needed — every request reads keys from DB).
- [x] Empty input clears the key.
- [x] Help links present for non-technical users.
- [ ] Interactive smoke (user): unlock → Settings → paste a real Claude key → ask the assistant a question → response streams.

## Decisions Made This Phase
- **Drop the safeStorage path entirely (vs. keeping it as belt-and-suspenders).** Carrying both means two places to update, two places that can drift. Single source of truth (DB) is better.
- **GET /user/profile always upserts.** Idempotent — first load creates the row, every later load just returns it. No separate "init" step needed.
- **Empty-string → NULL normalization in PATCH.** Lets the UI clear a key by submitting `""` without needing a separate "delete" affordance.
- **Credit metering left hard-wired to UNMETERED.** Removing every credit-gated UI (paywall modals, etc.) is more invasive than just making them always-allow. Keep the code paths; bypass the gate.
