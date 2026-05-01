import { app, BrowserWindow, ipcMain } from "electron";
import * as crypto from "crypto";
import * as path from "path";
import {
  readConfig,
  writeConfig,
  isWorkspaceValid,
  pickWorkspace,
} from "./workspace";
import {
  hasPassword,
  setPassword,
  verifyPassword,
  isLockedOut,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "./auth";
import { readSecrets } from "./secrets";
import { signLocalJwt } from "./jwt";
import { spawnBackend, stopBackend, waitForBackend, getBackendPort } from "./backend";
import { spawnFrontend, stopFrontend, waitForFrontend } from "./frontend";

const isDev = process.env.NODE_ENV === "development";
const FRONTEND_URL = "http://localhost:3000";
const LOCAL_USER_ID = "local-user";
const LOCAL_USER_EMAIL = "user@local";
const JWT_TTL_SECONDS = 60 * 60 * 24; // 24h

let win: BrowserWindow | null = null;
let currentWorkspace: string | null = null;
let sessionJwt: string | null = null;
let sessionSecret: string | null = null;

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: "Mike",
    backgroundColor: "#0b0b0d",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  w.removeMenu();
  return w;
}

function loadLockScreen(w: BrowserWindow): void {
  void w.loadFile(path.join(__dirname, "lock", "lock.html"));
}

function loadMainApp(w: BrowserWindow): void {
  void w.loadURL(FRONTEND_URL);
}

async function startSession(workspace: string): Promise<void> {
  sessionSecret = crypto.randomBytes(32).toString("hex");
  sessionJwt = signLocalJwt(
    sessionSecret,
    LOCAL_USER_ID,
    LOCAL_USER_EMAIL,
    JWT_TTL_SECONDS,
  );

  const apiKeys = readSecrets(workspace) as Record<string, string | undefined>;
  spawnBackend({
    workspace,
    jwtSecret: sessionSecret,
    userId: LOCAL_USER_ID,
    userEmail: LOCAL_USER_EMAIL,
    apiKeys,
  });
}

ipcMain.handle("mike:getState", () => {
  const cfg = readConfig();
  const ws =
    currentWorkspace ??
    (isWorkspaceValid(cfg.lastWorkspace) ? cfg.lastWorkspace! : null);
  if (ws !== currentWorkspace) currentWorkspace = ws;
  const lock = isLockedOut();
  return {
    workspace: ws,
    hasPassword: ws ? hasPassword(ws) : false,
    lockedOut: lock.locked,
    lockoutSecondsRemaining: lock.secondsRemaining,
  };
});

ipcMain.handle("mike:pickWorkspace", async () => {
  const picked = await pickWorkspace();
  if (!picked) return { ok: false };
  writeConfig({ lastWorkspace: picked });
  currentWorkspace = picked;
  return { ok: true, workspace: picked, hasPassword: hasPassword(picked) };
});

ipcMain.handle("mike:setPassword", (_e, password: unknown) => {
  if (!currentWorkspace) return { ok: false, error: "No workspace selected." };
  if (typeof password !== "string") {
    return { ok: false, error: "Invalid password input." };
  }
  try {
    setPassword(currentWorkspace, password);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle("mike:unlock", async (_e, password: unknown) => {
  if (!currentWorkspace) return { ok: false, error: "No workspace selected." };
  if (typeof password !== "string") {
    return { ok: false, error: "Invalid password input." };
  }
  const lock = isLockedOut();
  if (lock.locked) {
    return {
      ok: false,
      error: `Too many failed attempts. Try again in ${lock.secondsRemaining}s.`,
    };
  }
  if (!verifyPassword(currentWorkspace, password)) {
    recordFailedAttempt();
    return { ok: false, error: "Incorrect password." };
  }
  recordSuccessfulAttempt();

  await startSession(currentWorkspace);
  // In prod, spawn the Next.js standalone server too. In dev, `next dev`
  // is launched externally via concurrently.
  spawnFrontend();
  const [backendReady, frontendReady] = await Promise.all([
    waitForBackend(20_000),
    waitForFrontend(20_000),
  ]);
  if (!backendReady)
    console.warn("Backend did not become ready in time; loading frontend anyway.");
  if (!frontendReady)
    console.warn("Frontend did not become ready in time; loading anyway.");
  if (win) loadMainApp(win);
  return { ok: true };
});

ipcMain.handle("mike:getToken", () => sessionJwt);
ipcMain.handle("mike:getUser", () => {
  if (!sessionJwt) return null;
  return { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL };
});
ipcMain.handle("mike:getApiPort", () => getBackendPort());

app.whenReady().then(() => {
  const cfg = readConfig();
  if (isWorkspaceValid(cfg.lastWorkspace)) {
    currentWorkspace = cfg.lastWorkspace!;
  }
  win = createWindow();
  loadLockScreen(win);
  win.on("closed", () => {
    win = null;
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  stopFrontend();
  app.quit();
});

app.on("before-quit", () => {
  stopBackend();
  stopFrontend();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && app.isReady()) {
    win = createWindow();
    loadLockScreen(win);
  }
});
