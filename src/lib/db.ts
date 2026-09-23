import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate, SCHEMA_VERSION } from "./schema";

/**
 * Single better-sqlite3 connection for the app.
 *
 * The full schema (center, policies, escalations, interaction_audit,
 * conversations, messages, settings) lives in ./schema.ts and is applied on
 * first connect. In production the file lives on the Railway persistent volume
 * via DATABASE_PATH; locally it defaults to ./data/app.db (gitignored).
 */
const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";

let _db: Database.Database | null = null;

/**
 * Open (or return the cached) app connection, running migrations once. The
 * connection is a process-wide singleton so repositories share one handle.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db);

  _db = db;
  return db;
}

/**
 * Create a fresh, isolated in-memory database with the schema applied. Used by
 * tests so each suite runs against a clean DB with no shared state.
 */
export function createMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export type Health = {
  ok: boolean;
  dbPath: string;
  app: string | null;
  schemaVersion: string | null;
  entryCount: number;
  now: string;
};

export function getHealth(): Health {
  const db = getDb();
  const row = (key: string) =>
    (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
      | { value: string }
      | undefined)?.value ?? null;

  const entryCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries`).get() as { n: number }
  ).n;

  return {
    ok: true,
    dbPath: DB_PATH,
    app: row("app"),
    schemaVersion: row("schema_version") ?? String(SCHEMA_VERSION),
    entryCount,
    now: new Date().toISOString(),
  };
}
