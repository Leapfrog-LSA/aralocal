/**
 * Local-filesystem storage for the Mike desktop app.
 *
 * Files live under `<WORKSPACE_PATH>/files/<key>`. Every read/write resolves
 * the absolute path and rejects anything outside the workspace root (path-
 * traversal guard). The "signed URL" returned to the frontend is a short-lived
 * token URL that hits the `/files` route on the local backend.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getServerPort } from "./serverPort";

function workspacePath(): string {
  const ws = process.env.WORKSPACE_PATH;
  if (!ws) {
    throw new Error("WORKSPACE_PATH is not set");
  }
  return ws;
}

function filesRoot(): string {
  return path.join(workspacePath(), "files");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Resolve a storage key relative to <workspace>/files, rejecting anything
 * that escapes after path resolution. If the resolved path (or any prefix
 * of it) is a symlink/junction, follow it with realpath and re-check —
 * preventing a malicious key from pointing outside the workspace via a
 * link inside files/.
 *
 * NOTE: storage keys are server-generated only. Accepting client-supplied
 * keys would warrant a defence-in-depth review of every caller.
 */
function resolveSafe(key: string): string {
  const root = path.resolve(filesRoot());
  const candidate = path.resolve(root, key);
  if (!isInsideRoot(root, candidate)) {
    throw new Error(`Storage key escapes workspace: ${key}`);
  }
  // realpath follows symlinks. We only have a real path if the file (or one
  // of its existing ancestors) exists; for newly-created keys, walk up until
  // we find an existing ancestor and check that.
  try {
    const realRoot = fs.realpathSync(root);
    let probe = candidate;
    // Walk up to the first existing ancestor.
    while (!fs.existsSync(probe) && probe !== path.dirname(probe)) {
      probe = path.dirname(probe);
    }
    if (fs.existsSync(probe)) {
      const realProbe = fs.realpathSync(probe);
      if (!isInsideRoot(realRoot, realProbe)) {
        throw new Error(`Storage key escapes workspace via symlink: ${key}`);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // ancestor disappeared between checks — treat as safe (will fail later
      // with a clearer error from the actual fs op).
    } else {
      throw err;
    }
  }
  return candidate;
}

export const storageEnabled = true;

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  _contentType: string,
): Promise<void> {
  const dest = resolveSafe(key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, Buffer.from(content));
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  try {
    const src = resolveSafe(key);
    const buf = await fs.promises.readFile(src);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteFile(key: string): Promise<void> {
  try {
    const target = resolveSafe(key);
    await fs.promises.unlink(target);
  } catch {
    // Missing file = already deleted; not an error.
  }
}

// ---------------------------------------------------------------------------
// Signed URL  → short-lived JWT-bearing URL to the local /files route
// ---------------------------------------------------------------------------

const FILE_TOKEN_TTL_SECONDS = 3600;

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getJwtSecret(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return Buffer.from(secret, "hex");
}

export function signFileToken(
  key: string,
  filename?: string,
  ttlSeconds = FILE_TOKEN_TTL_SECONDS,
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "FT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      key,
      fn: filename ?? null,
      iat: now,
      exp: now + ttlSeconds,
    }),
  );
  const signing = `${header}.${payload}`;
  const sig = crypto
    .createHmac("sha256", getJwtSecret())
    .update(signing)
    .digest();
  return `${signing}.${b64url(sig)}`;
}

export interface VerifiedFileToken {
  key: string;
  filename: string | null;
}

export function verifyFileToken(token: string): VerifiedFileToken {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed file token");
  const [headerB64, payloadB64, sigB64] = parts;
  const expected = crypto
    .createHmac("sha256", getJwtSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = Buffer.from(
    sigB64.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (sigB64.length % 4)) % 4),
    "base64",
  );
  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    throw new Error("Invalid file token signature");
  }
  const payload = JSON.parse(
    Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (payloadB64.length % 4)) % 4),
      "base64",
    ).toString(),
  ) as { key: unknown; fn: unknown; exp: unknown };
  // B3: payload shape validation. Reject anything that doesn't match what
  // signFileToken produces, even if the HMAC is correct.
  if (typeof payload.key !== "string" || payload.key.length === 0) {
    throw new Error("File token has invalid 'key' field");
  }
  if (payload.fn !== null && typeof payload.fn !== "string") {
    throw new Error("File token has invalid 'fn' field");
  }
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error("File token has invalid 'exp' field");
  }
  if (payload.exp * 1000 < Date.now()) throw new Error("File token expired");
  return { key: payload.key, filename: payload.fn };
}

export async function getSignedUrl(
  key: string,
  expiresIn = FILE_TOKEN_TTL_SECONDS,
  downloadFilename?: string,
): Promise<string | null> {
  try {
    const token = signFileToken(key, downloadFilename, expiresIn);
    // Use the actual listening port (set by index.ts after app.listen
    // resolves the OS-assigned port from PORT=0). Reading process.env.PORT
    // here would yield "0" and produce broken URLs.
    // 127.0.0.1 not "localhost" — on Windows, "localhost" can resolve to
    // ::1 (IPv6) first while the backend binds 127.0.0.1 only.
    return `http://127.0.0.1:${getServerPort()}/files?t=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

export function resolveStoragePath(key: string): string {
  return resolveSafe(key);
}

export function streamableExists(key: string): boolean {
  try {
    return fs.statSync(resolveSafe(key)).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers (unchanged from the R2 version — same key shapes)
// ---------------------------------------------------------------------------

export function normalizeDownloadFilename(name: string): string {
  const trimmed = name.trim();
  const base = trimmed || "download";
  return base.replace(/[\x00-\x1F\x7F]/g, "_").replace(/[\\/]/g, "_");
}

export function sanitizeDispositionFilename(name: string): string {
  return normalizeDownloadFilename(name).replace(/["\\]/g, "_");
}

export function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function buildContentDisposition(
  kind: "inline" | "attachment",
  filename: string,
): string {
  const normalized = normalizeDownloadFilename(filename);
  return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`;
}

export function storageKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`;
}

export function pdfStorageKey(
  userId: string,
  docId: string,
  stem: string,
): string {
  return `documents/${userId}/${docId}/${stem}.pdf`;
}

export function generatedDocKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`;
}

export function versionStorageKey(
  userId: string,
  docId: string,
  versionSlug: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`;
}

function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return fallback;
  const ext = filename.slice(lastDot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}
