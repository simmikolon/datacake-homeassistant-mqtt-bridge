import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { childLogger } from "../utils/logger";
import { applyMigrations } from "./migrations";

const log = childLogger("db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "bridge.db");
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  log.info({ dbPath }, "Opening SQLite database");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
