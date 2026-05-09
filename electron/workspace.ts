import { app, dialog } from "electron";
import * as fs from "fs";
import * as path from "path";

interface AppConfig {
  lastWorkspace?: string;
}

const CONFIG_FILE = "config.json";
const ARALEGAL_DIR = ".aralegal";

function configPath(): string {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

export function readConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return JSON.parse(raw) as AppConfig;
  } catch {
    return {};
  }
}

export function writeConfig(cfg: AppConfig): void {
  atomicWriteFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

export function isWorkspaceValid(workspace: string | undefined): boolean {
  if (!workspace) return false;
  try {
    const stat = fs.statSync(workspace);
    if (!stat.isDirectory()) return false;
    fs.accessSync(workspace, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function ensureAraLegalDir(workspace: string): string {
  const aralegalDir = path.join(workspace, ARALEGAL_DIR);
  fs.mkdirSync(aralegalDir, { recursive: true });
  fs.mkdirSync(path.join(workspace, "files"), { recursive: true });
  return aralegalDir;
}

function isInsideInstallTree(workspace: string): boolean {
  const candidates = [app.getAppPath()];
  // process.resourcesPath is only set under Electron; guard for type safety.
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  if (resourcesPath) candidates.push(resourcesPath);
  const ws = path.resolve(workspace);
  for (const c of candidates) {
    const installRoot = path.resolve(c);
    const rel = path.relative(installRoot, ws);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return true;
    }
  }
  return false;
}

export async function pickWorkspace(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Choose a AraLegal workspace folder",
    properties: ["openDirectory", "createDirectory"],
    message:
      "AraLegal will store all of your documents, settings, and database in this folder.",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const rawPicked = result.filePaths[0];
  // realpath defeats junctions/symlinks that point into the install tree.
  let picked: string;
  try {
    picked = fs.realpathSync(rawPicked);
  } catch {
    picked = path.resolve(rawPicked);
  }
  if (!isWorkspaceValid(picked)) {
    await dialog.showMessageBox({
      type: "error",
      message: "Selected folder is not readable/writable. Please pick another.",
    });
    return null;
  }
  if (isInsideInstallTree(picked)) {
    await dialog.showMessageBox({
      type: "error",
      message:
        "Workspace cannot live inside the AraLegal install directory. " +
        "Please pick a folder elsewhere (e.g. inside Documents).",
    });
    return null;
  }
  ensureAraLegalDir(picked);
  return picked;
}

export function authFilePath(workspace: string): string {
  return path.join(workspace, ARALEGAL_DIR, "auth.json");
}

export function secretsFilePath(workspace: string): string {
  return path.join(workspace, ARALEGAL_DIR, "secrets.enc");
}

export function authStateFilePath(workspace: string): string {
  return path.join(workspace, ARALEGAL_DIR, "auth-state.json");
}

export function runtimeFilePath(workspace: string): string {
  return path.join(workspace, ARALEGAL_DIR, "runtime.json");
}

/**
 * Atomic write — writes to a temp file then renames over the destination.
 * Avoids leaving a half-written file if power loss / crash interrupts.
 */
export function atomicWriteFileSync(
  dest: string,
  data: string | Buffer,
  opts: { mode?: number } = {},
): void {
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(tmp, data, { mode: opts.mode });
  fs.renameSync(tmp, dest);
}
