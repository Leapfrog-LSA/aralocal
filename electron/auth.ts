import * as fs from "fs";
import * as crypto from "crypto";
import { promisify } from "util";
import {
  authFilePath,
  authStateFilePath,
  atomicWriteFileSync,
} from "./workspace";

interface AuthFile {
  version: 1;
  algo: "scrypt";
  salt: string;
  hash: string;
  N: number;
  r: number;
  p: number;
  keylen: number;
}

interface AuthState {
  version: 1;
  failedAttempts: number;
  lockoutUntil: number;
}

// Tuned for ~400 ms per derive on a modern laptop. Higher than the original
// N=16384 (~50 ms) to slow offline brute-force against a stolen workspace.
// scrypt's memory cost is ~128 * N * r bytes ≈ 128 MB at these params, so
// maxmem must be raised accordingly.
const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1, keylen: 64 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

const MIN_PASSWORD_LENGTH = 10;

const FAILED_ATTEMPT_LIMIT = 5;
const LOCKOUT_MS = 30_000;

const scryptAsync = promisify(
  (
    pw: crypto.BinaryLike,
    salt: crypto.BinaryLike,
    keylen: number,
    options: crypto.ScryptOptions,
    cb: (err: Error | null, key: Buffer) => void,
  ) => crypto.scrypt(pw, salt, keylen, options, cb),
);

async function deriveKey(
  password: string,
  saltB64: string,
  params: { N: number; r: number; p: number; keylen: number } = SCRYPT_PARAMS,
): Promise<Buffer> {
  const salt = Buffer.from(saltB64, "base64");
  return scryptAsync(password, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function hasPassword(workspace: string): boolean {
  try {
    return fs.statSync(authFilePath(workspace)).isFile();
  } catch {
    return false;
  }
}

export const PASSWORD_MIN_LENGTH = MIN_PASSWORD_LENGTH;

export async function setPassword(
  workspace: string,
  password: string,
): Promise<void> {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  const salt = crypto.randomBytes(16);
  const hash = await deriveKey(password, salt.toString("base64"));
  const file: AuthFile = {
    version: 1,
    algo: "scrypt",
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    ...SCRYPT_PARAMS,
  };
  atomicWriteFileSync(
    authFilePath(workspace),
    JSON.stringify(file, null, 2),
    { mode: 0o600 },
  );
}

/**
 * Verify the password against the stored hash. If the stored hash uses
 * older scrypt parameters than `SCRYPT_PARAMS`, transparently re-derive
 * with the new params and rewrite `auth.json` (lazy upgrade).
 *
 * Returns true on match, false on mismatch or any read/parse failure.
 */
export async function verifyPassword(
  workspace: string,
  password: string,
): Promise<boolean> {
  let raw: string;
  try {
    raw = fs.readFileSync(authFilePath(workspace), "utf8");
  } catch {
    return false;
  }
  let file: AuthFile;
  try {
    file = JSON.parse(raw) as AuthFile;
  } catch {
    return false;
  }
  const candidate = await deriveKey(password, file.salt, {
    N: file.N,
    r: file.r,
    p: file.p,
    keylen: file.keylen,
  });
  const stored = Buffer.from(file.hash, "base64");
  if (candidate.length !== stored.length) return false;
  if (!crypto.timingSafeEqual(candidate, stored)) return false;

  // Match — opportunistically upgrade to current scrypt parameters.
  const needsUpgrade =
    file.N !== SCRYPT_PARAMS.N ||
    file.r !== SCRYPT_PARAMS.r ||
    file.p !== SCRYPT_PARAMS.p ||
    file.keylen !== SCRYPT_PARAMS.keylen;
  if (needsUpgrade) {
    try {
      await setPassword(workspace, password);
      console.log(
        `[auth] migrated password hash to N=${SCRYPT_PARAMS.N} for ${authFilePath(
          workspace,
        )}`,
      );
    } catch (err) {
      console.warn("[auth] password hash upgrade failed:", err);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lockout state — persisted per workspace
// ---------------------------------------------------------------------------

function readState(workspace: string): AuthState {
  try {
    const raw = fs.readFileSync(authStateFilePath(workspace), "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    return {
      version: 1,
      failedAttempts: Number(parsed.failedAttempts ?? 0) || 0,
      lockoutUntil: Number(parsed.lockoutUntil ?? 0) || 0,
    };
  } catch {
    return { version: 1, failedAttempts: 0, lockoutUntil: 0 };
  }
}

function writeState(workspace: string, state: AuthState): void {
  try {
    atomicWriteFileSync(
      authStateFilePath(workspace),
      JSON.stringify(state, null, 2),
      { mode: 0o600 },
    );
  } catch (err) {
    console.warn("[auth] failed to persist auth-state:", err);
  }
}

export function isLockedOut(workspace: string): {
  locked: boolean;
  secondsRemaining: number;
} {
  const state = readState(workspace);
  const now = Date.now();
  if (now < state.lockoutUntil) {
    return {
      locked: true,
      secondsRemaining: Math.ceil((state.lockoutUntil - now) / 1000),
    };
  }
  return { locked: false, secondsRemaining: 0 };
}

export function recordFailedAttempt(workspace: string): void {
  const state = readState(workspace);
  state.failedAttempts++;
  if (state.failedAttempts >= FAILED_ATTEMPT_LIMIT) {
    state.lockoutUntil = Date.now() + LOCKOUT_MS;
    state.failedAttempts = 0;
  }
  writeState(workspace, state);
}

export function recordSuccessfulAttempt(workspace: string): void {
  writeState(workspace, {
    version: 1,
    failedAttempts: 0,
    lockoutUntil: 0,
  });
}
