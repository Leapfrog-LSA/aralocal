import { app, dialog } from "electron";
import * as fs from "fs";
import * as path from "path";

interface AppConfig {
  lastWorkspace?: string;
}

const CONFIG_FILE = "config.json";
const MIKE_DIR = ".mike";

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
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
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

export function ensureMikeDir(workspace: string): string {
  const mikeDir = path.join(workspace, MIKE_DIR);
  fs.mkdirSync(mikeDir, { recursive: true });
  fs.mkdirSync(path.join(workspace, "files"), { recursive: true });
  return mikeDir;
}

export async function pickWorkspace(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Choose a Mike workspace folder",
    properties: ["openDirectory", "createDirectory"],
    message:
      "Mike will store all of your documents, settings, and database in this folder.",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const picked = result.filePaths[0];
  if (!isWorkspaceValid(picked)) {
    await dialog.showMessageBox({
      type: "error",
      message: "Selected folder is not readable/writable. Please pick another.",
    });
    return null;
  }
  ensureMikeDir(picked);
  return picked;
}

export function authFilePath(workspace: string): string {
  return path.join(workspace, MIKE_DIR, "auth.json");
}

export function secretsFilePath(workspace: string): string {
  return path.join(workspace, MIKE_DIR, "secrets.enc");
}
