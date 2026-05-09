import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { backendDir as resolveBackendDir } from "./paths";
import { runtimeFilePath } from "./workspace";
import { setLogRedactions } from "./logging";

const BACKEND_FRONTEND_URL = "http://localhost:3000";

interface SpawnOptions {
  workspace: string;
  jwtSecret: string;
  downloadSecret: string;
  userId: string;
  userEmail: string;
  apiKeys: Record<string, string | undefined>;
}

interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

let backendProc: ChildProcess | null = null;
let backendPort: number | null = null;
let backendWorkspace: string | null = null;
let lastExitInfo: ExitInfo | null = null;

export function isBackendRunning(): boolean {
  return (
    backendProc !== null && !backendProc.killed && backendProc.exitCode === null
  );
}

export function spawnBackend(opts: SpawnOptions): void {
  if (isBackendRunning()) return;
  lastExitInfo = null;
  backendPort = null;
  backendWorkspace = opts.workspace;

  // C1: redact secrets from log file
  setLogRedactions([
    opts.jwtSecret,
    opts.downloadSecret,
    ...Object.values(opts.apiKeys),
  ]);

  // Clear any stale runtime.json before the new backend writes its assigned
  // port — otherwise waitForBackend could read the previous run's port.
  try {
    fs.unlinkSync(runtimeFilePath(opts.workspace));
  } catch {
    // not present — fine
  }

  const isDev = process.env.NODE_ENV === "development";
  const backendDir = resolveBackendDir();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: "0", // C3: OS picks an available port
    FRONTEND_URL: BACKEND_FRONTEND_URL,
    JWT_SECRET: opts.jwtSecret,
    DOWNLOAD_SIGNING_SECRET: opts.downloadSecret,
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
    const tsxBin =
      process.platform === "win32"
        ? path.join(backendDir, "node_modules", ".bin", "tsx.cmd")
        : path.join(backendDir, "node_modules", ".bin", "tsx");
    cmd = tsxBin;
    args = ["watch", "src/index.ts"];
    // Win32 .cmd shims require shell:true to invoke. All args here are
    // static literals (no user input flows into argv) so the future-shell-
    // injection concern from CODE-REVIEW-0.2.0.md doesn't bite. Cmd.exe
    // /c with the path passed as an arg breaks the dev spawn silently —
    // the child exits before stdout is even wired, leaving no log trail.
    useShell = process.platform === "win32";
  } else {
    env.ELECTRON_RUN_AS_NODE = "1";
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
    const s = b.toString();
    process.stdout.write(`[backend] ${s}`);
    console.log(`[backend.stdout] ${s.replace(/\n+$/, "")}`);
  });
  backendProc.stderr?.on("data", (b: Buffer) => {
    const s = b.toString();
    process.stderr.write(`[backend] ${s}`);
    console.error(`[backend.stderr] ${s.replace(/\n+$/, "")}`);
  });
  backendProc.on("exit", (code, signal) => {
    console.log(`[backend] exited code=${code} signal=${signal}`);
    lastExitInfo = { code, signal };
    backendProc = null;
  });
}

export function stopBackend(): void {
  if (backendProc && !backendProc.killed) {
    backendProc.kill();
  }
  backendProc = null;
  backendPort = null;
  backendWorkspace = null;
  setLogRedactions([]);
}

function readRuntimeFile(): { port?: number } | null {
  if (!backendWorkspace) return null;
  try {
    const raw = fs.readFileSync(runtimeFilePath(backendWorkspace), "utf8");
    return JSON.parse(raw) as { port?: number };
  } catch {
    return null;
  }
}

/**
 * Wait until the backend has written its runtime.json (containing the
 * dynamically-assigned port) AND responds on /health. Returns false on
 * timeout or if the backend has already exited.
 */
export async function waitForBackend(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (lastExitInfo) return false; // backend died — give up immediately

    if (backendPort === null) {
      const rt = readRuntimeFile();
      if (rt?.port) backendPort = rt.port;
    }
    if (backendPort !== null) {
      try {
        const resp = await fetch(`http://localhost:${backendPort}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (resp.ok) return true;
      } catch {
        // not ready yet
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export function getBackendPort(): number {
  // Renderer asks for this via window.aralegal.getApiPort. Falls back to 3001 to
  // keep the legacy default if the runtime file is missing for any reason.
  if (backendPort !== null) return backendPort;
  const rt = readRuntimeFile();
  if (rt?.port) {
    backendPort = rt.port;
    return rt.port;
  }
  return 3001;
}

export function getBackendExitInfo(): ExitInfo | null {
  return lastExitInfo;
}
