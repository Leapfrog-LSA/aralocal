import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

let db: Database.Database | null = null;

function dbPath(): string {
  const ws = process.env.WORKSPACE_PATH;
  if (!ws) {
    throw new Error(
      "WORKSPACE_PATH is not set; backend must be spawned by Mike Electron main.",
    );
  }
  const dir = path.join(ws, ".mike");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "mike.db");
}

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
