import { safeStorage } from "electron";
import * as fs from "fs";
import { secretsFilePath } from "./workspace";

export interface SecretsBundle {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  RESEND_API_KEY?: string;
}

export function readSecrets(workspace: string): SecretsBundle {
  if (!safeStorage.isEncryptionAvailable()) return {};
  let buf: Buffer;
  try {
    buf = fs.readFileSync(secretsFilePath(workspace));
  } catch {
    return {};
  }
  try {
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as SecretsBundle;
  } catch {
    return {};
  }
}

export function writeSecrets(
  workspace: string,
  secrets: SecretsBundle,
): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS-level secret storage is unavailable on this machine. Cannot save API keys.",
    );
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(secrets));
  fs.writeFileSync(secretsFilePath(workspace), encrypted, { mode: 0o600 });
}

export function hasSecrets(workspace: string): boolean {
  try {
    return fs.statSync(secretsFilePath(workspace)).isFile();
  } catch {
    return false;
  }
}
