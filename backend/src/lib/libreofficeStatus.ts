/**
 * LibreOffice availability detection.
 *
 * The desktop installer doesn't bundle LibreOffice (~400 MB). DOC/DOCX
 * uploads still work without it for text extraction (mammoth handles that),
 * but PDF rendition needs `soffice`. This module probes for `soffice` once
 * at startup and exposes the result so the frontend can show a "Install
 * LibreOffice" banner instead of failing silently.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface Probe {
  available: boolean;
  version: string | null;
  path: string | null;
}

let cached: Probe | null = null;
let inflight: Promise<Probe> | null = null;

const WIN_INSTALL_PATHS = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

const NIX_INSTALL_PATHS = [
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/snap/bin/libreoffice",
];

function existingInstall(): string | null {
  const candidates = process.platform === "win32"
    ? WIN_INSTALL_PATHS
    : NIX_INSTALL_PATHS;
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // not present
    }
  }
  return null;
}

async function runProbe(executable: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = "";
    let resolved = false;
    const finish = (v: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    try {
      const proc = spawn(executable, ["--version"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.stdout?.on("data", (b: Buffer) => (stdout += b.toString()));
      proc.on("error", () => finish(null));
      proc.on("exit", (code) => {
        if (code === 0 && stdout.trim()) finish(stdout.trim());
        else finish(null);
      });
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
        finish(null);
      }, 3000);
    } catch {
      finish(null);
    }
  });
}

export async function probeLibreOffice(): Promise<Probe> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    // Try `soffice --version` (PATH lookup) first, then known install paths.
    const candidates = ["soffice"];
    const installed = existingInstall();
    if (installed) candidates.push(installed);

    for (const c of candidates) {
      const version = await runProbe(c);
      if (version) {
        const result: Probe = {
          available: true,
          version: version.split(/\r?\n/)[0],
          path: c === "soffice" ? null : c,
        };
        cached = result;
        return result;
      }
    }
    const result: Probe = { available: false, version: null, path: null };
    cached = result;
    return result;
  })();

  return inflight;
}

export function getCachedProbe(): Probe | null {
  return cached;
}

export const LIBREOFFICE_DOWNLOAD_URL =
  "https://www.libreoffice.org/download/download/";
