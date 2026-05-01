import * as crypto from "crypto";

/**
 * Minimal HS256 JWT helpers backed by Node `crypto`. Avoids the `jsonwebtoken`
 * dependency for a self-contained desktop build.
 *
 * The signing secret is supplied via the JWT_SECRET env var. Electron derives
 * it from the user's password + workspace salt and passes it at spawn time.
 */

interface Payload {
  sub: string;
  email?: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function getSecret(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return Buffer.from(secret, "hex");
}

export function signLocalJwt(
  sub: string,
  email: string,
  ttlSeconds = 60 * 60 * 24,
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub,
      email,
      iat: now,
      exp: now + ttlSeconds,
    } satisfies Payload),
  );
  const signing = `${header}.${payload}`;
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(signing)
    .digest();
  return `${signing}.${b64url(sig)}`;
}

export interface VerifiedJwt {
  sub: string;
  email: string;
}

export function verifyLocalJwt(token: string): VerifiedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = b64urlDecode(sigB64);
  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    throw new Error("Invalid signature");
  }

  const payload = JSON.parse(b64urlDecode(payloadB64).toString()) as Payload;
  if (payload.exp * 1000 < Date.now()) {
    throw new Error("Token expired");
  }
  return { sub: payload.sub, email: payload.email ?? "" };
}
