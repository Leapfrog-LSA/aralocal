import { ChildProcess, spawn } from "child_process";
import * as path from "path";

const FRONTEND_PORT = 3000;

let frontendProc: ChildProcess | null = null;

export function spawnFrontend(): void {
  if (process.env.NODE_ENV === "development") return; // dev runs `next dev` externally
  if (frontendProc !== null) return;

  // electron-builder ships the Next.js standalone bundle at:
  //   resources/app.asar.unpacked/frontend/.next/standalone/server.js
  // The cwd needs to be the standalone dir so `require()` resolves correctly.
  const repoRoot = path.resolve(__dirname, "..");
  const standaloneDir = path.join(
    repoRoot,
    "frontend",
    ".next",
    "standalone",
  );
  const serverEntry = path.join(standaloneDir, "server.js");

  frontendProc = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      PORT: String(FRONTEND_PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  frontendProc.stdout?.on("data", (b: Buffer) =>
    process.stdout.write(`[frontend] ${b.toString()}`),
  );
  frontendProc.stderr?.on("data", (b: Buffer) =>
    process.stderr.write(`[frontend] ${b.toString()}`),
  );
  frontendProc.on("exit", (code, signal) => {
    console.log(`[frontend] exited code=${code} signal=${signal}`);
    frontendProc = null;
  });
}

export function stopFrontend(): void {
  if (frontendProc && !frontendProc.killed) frontendProc.kill();
  frontendProc = null;
}

export async function waitForFrontend(timeoutMs = 30_000): Promise<boolean> {
  const url = `http://localhost:${FRONTEND_PORT}/`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (resp.ok || resp.status < 500) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function getFrontendPort(): number {
  return FRONTEND_PORT;
}
