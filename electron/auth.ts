import * as fs from "fs";
import * as crypto from "crypto";
import { authFilePath } from "./workspace";

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

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

function deriveKey(password: string, saltB64: string): Buffer {
  const salt = Buffer.from(saltB64, "base64");
  return crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 64 * 1024 * 1024,
  });
}

export function hasPassword(workspace: string): boolean {
  try {
    return fs.statSync(authFilePath(workspace)).isFile();
  } catch {
    return false;
  }
}

export function setPassword(workspace: string, password: string): void {
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  const salt = crypto.randomBytes(16);
  const hash = deriveKey(password, salt.toString("base64"));
  const file: AuthFile = {
    version: 1,
    algo: "scrypt",
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    ...SCRYPT_PARAMS,
  };
  fs.writeFileSync(authFilePath(workspace), JSON.stringify(file, null, 2), {
    mode: 0o600,
  });
}

export function verifyPassword(workspace: string, password: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(authFilePath(workspace), "utf8");
  } catch {
    return false;
  }
  const file = JSON.parse(raw) as AuthFile;
  const candidate = deriveKey(password, file.salt);
  const stored = Buffer.from(file.hash, "base64");
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

const FAILED_ATTEMPT_LIMIT = 5;
const LOCKOUT_MS = 30_000;

let failedAttempts = 0;
let lockoutUntil = 0;

export function isLockedOut(): { locked: boolean; secondsRemaining: number } {
  const now = Date.now();
  if (now < lockoutUntil) {
    return {
      locked: true,
      secondsRemaining: Math.ceil((lockoutUntil - now) / 1000),
    };
  }
  return { locked: false, secondsRemaining: 0 };
}

export function recordFailedAttempt(): void {
  failedAttempts++;
  if (failedAttempts >= FAILED_ATTEMPT_LIMIT) {
    lockoutUntil = Date.now() + LOCKOUT_MS;
    failedAttempts = 0;
  }
}

export function recordSuccessfulAttempt(): void {
  failedAttempts = 0;
  lockoutUntil = 0;
}
