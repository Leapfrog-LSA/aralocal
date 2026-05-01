import { ChildProcess, spawn } from "child_process";
import * as path from "path";

const BACKEND_PORT = 3001;
const BACKEND_FRONTEND_URL = "http://localhost:3000";

interface SpawnOptions {
  workspace: string;
  jwtSecret: string;
  userId: string;
  userEmail: string;
  apiKeys: Record<string, string | undefined>;
}

let backendProc: ChildProcess | null = null;

export function isBackendRunning(): boolean {
  return backendProc !== null && !backendProc.killed && backendProc.exitCode === null;
}

export function spawnBackend(opts: SpawnOptions): void {
  if (isBackendRunning()) return;

  const isDev = process.env.NODE_ENV === "development";
  const repoRoot = path.resolve(__dirname, "..");
  const backendDir = path.join(repoRoot, "backend");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(BACKEND_PORT),
    FRONTEND_URL: BACKEND_FRONTEND_URL,
    JWT_SECRET: opts.jwtSecret,
    WORKSPACE_PATH: opts.workspace,
    LOCAL_USER_ID: opts.userId,
    LOCAL_USER_EMAIL: opts.userEmail,
  };
  for (const [k, v] of Object.entries(opts.apiKeys)) {
    if (v) env[k] = v;
  }

  let cmd: string;
  let args: string[];
  let useShell = false;
  if (isDev) {
    // Use the local tsx binary directly. On Windows, .cmd files needed shell:
    // true when invoked via spawn(); a direct path to tsx avoids the issue.
    const tsxBin =
      process.platform === "win32"
        ? path.join(backendDir, "node_modules", ".bin", "tsx.cmd")
        : path.join(backendDir, "node_modules", ".bin", "tsx");
    cmd = tsxBin;
    args = ["watch", "src/index.ts"];
    useShell = process.platform === "win32"; // .cmd needs cmd.exe wrapper
  } else {
    cmd = process.execPath;
    args = [path.join(backendDir, "dist", "index.js")];
  }

  console.log(`[backend] spawning: ${cmd} ${args.join(" ")} (cwd=${backendDir})`);
  backendProc = spawn(cmd, args, {
    cwd: backendDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: useShell,
  });
  backendProc.on("error", (err) => {
    console.error(`[backend] spawn error:`, err);
  });

  backendProc.stdout?.on("data", (b: Buffer) => {
    process.stdout.write(`[backend] ${b.toString()}`);
  });
  backendProc.stderr?.on("data", (b: Buffer) => {
    process.stderr.write(`[backend] ${b.toString()}`);
  });
  backendProc.on("exit", (code, signal) => {
    console.log(`[backend] exited code=${code} signal=${signal}`);
    backendProc = null;
  });
}

export function stopBackend(): void {
  if (backendProc && !backendProc.killed) {
    backendProc.kill();
  }
  backendProc = null;
}

export async function waitForBackend(timeoutMs = 30_000): Promise<boolean> {
  const url = `http://localhost:${BACKEND_PORT}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function getBackendPort(): number {
  return BACKEND_PORT;
}
