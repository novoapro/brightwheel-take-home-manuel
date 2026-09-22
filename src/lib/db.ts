import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Single better-sqlite3 connection for the app (M0 skeleton).
 *
 * The full schema (PolicyRecord, Escalation, InteractionAudit, Conversation,
 * Message, Settings) lands in M1 — see analysis/01-data-and-knowledge-model.md
 * and analysis/06-build-sequence.md. For now this just proves durable,
 * server-side reads/writes end-to-end (the M0 walking skeleton).
 *
 * In production the file lives on the Railway persistent volume via
 * DATABASE_PATH; locally it defaults to ./data/app.db (gitignored).
 */
const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Minimal meta table so the health check reads something real (M0).
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const seed = db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO NOTHING`,
  );
  seed.run("app", "ai-front-desk");
  seed.run("schema_version", "0");

  _db = db;
  return db;
}

export type Health = {
  ok: boolean;
  dbPath: string;
  app: string | null;
  schemaVersion: string | null;
  now: string;
};

export function getHealth(): Health {
  const db = getDb();
  const row = (key: string) =>
    (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
      | { value: string }
      | undefined)?.value ?? null;

  return {
    ok: true,
    dbPath: DB_PATH,
    app: row("app"),
    schemaVersion: row("schema_version"),
    now: new Date().toISOString(),
  };
}
