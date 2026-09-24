import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { createMemoryDb } from "./db";
import { migrate, SCHEMA_VERSION } from "./schema";

const TABLES = [
  "meta",
  "center",
  "knowledge_entries",
  "conversations",
  "interaction_audit",
  "escalations",
  "messages",
  "settings",
];

describe("schema / migrate", () => {
  it("creates every entity table", () => {
    const db = createMemoryDb();
    const names = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it("records the schema version", () => {
    const db = createMemoryDb();
    const v = (
      db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
        | { value: string }
        | undefined
    )?.value;
    expect(v).toBe(String(SCHEMA_VERSION));
  });

  it("is idempotent — running twice is safe and does not duplicate meta", () => {
    const db = createMemoryDb();
    expect(() => migrate(db)).not.toThrow();
    const n = (
      db.prepare(`SELECT COUNT(*) AS n FROM meta WHERE key = 'app'`).get() as {
        n: number;
      }
    ).n;
    expect(n).toBe(1);
  });

  it("enforces foreign keys (message → conversation)", () => {
    const db = createMemoryDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, text, created_at)
           VALUES ('m1', 'nope', 'parent', 'hi', '2026-01-01')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("enforces the capture-edge FK (escalation.promoted_entry_id → knowledge_entries)", () => {
    const db = createMemoryDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO escalations (id, question, reason, promoted_entry_id, created_at)
           VALUES ('e1', 'q', 'out_of_scope', 'ghost.entry', '2026-01-01')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("allows any (operator-configurable) category — no intent CHECK", () => {
    const db = createMemoryDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO knowledge_entries (id, intent, title, body_md, updated_at)
           VALUES ('p', 'transportation', 't', 'b', '2026-01-01')`,
        )
        .run(),
    ).not.toThrow();
  });

  it("rejects invalid enum values via CHECK constraints", () => {
    const db = createMemoryDb();
    // bad status
    expect(() =>
      db
        .prepare(
          `INSERT INTO knowledge_entries (id, intent, title, body_md, status, updated_at)
           VALUES ('p', 'hours', 't', 'b', 'nonsense', '2026-01-01')`,
        )
        .run(),
    ).toThrow(/CHECK/i);
    // bad decision
    expect(() =>
      db
        .prepare(
          `INSERT INTO interaction_audit (id, session_id, timestamp, parent_question, decision, decision_reason)
           VALUES ('a', 's', '2026-01-01', 'q', 'maybe', 'grounded')`,
        )
        .run(),
    ).toThrow(/CHECK/i);
  });

  it("locks settings to a single row (id = 1)", () => {
    const db = createMemoryDb();
    db.prepare(`INSERT INTO settings (id) VALUES (1)`).run();
    expect(() => db.prepare(`INSERT INTO settings (id) VALUES (2)`).run()).toThrow(
      /CHECK/i,
    );
  });

  it("back-fills cache_ttl on a pre-existing settings table (the deploy path)", () => {
    // Simulate a database created before the cache_ttl column existed: a legacy
    // settings table with a populated row. migrate() must ADD the column
    // idempotently and default the existing row to '1h' — not recreate the table.
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        caution_level TEXT NOT NULL DEFAULT 'balanced',
        active_provider TEXT NOT NULL DEFAULT 'anthropic',
        availability TEXT NOT NULL DEFAULT 'online',
        operator_name TEXT NOT NULL DEFAULT '',
        away_message TEXT NOT NULL DEFAULT '',
        offline_at TEXT,
        developer_mode INTEGER NOT NULL DEFAULT 0,
        audit_mode TEXT NOT NULL DEFAULT 'off',
        judge_enabled INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO settings (id) VALUES (1);
    `);
    const cols = () =>
      (db.prepare(`PRAGMA table_info(settings)`).all() as { name: string }[]).map(
        (c) => c.name,
      );
    expect(cols()).not.toContain("cache_ttl");

    migrate(db);
    expect(cols()).toContain("cache_ttl");
    expect(
      (db.prepare(`SELECT cache_ttl FROM settings WHERE id = 1`).get() as {
        cache_ttl: string;
      }).cache_ttl,
    ).toBe("1h");

    // Idempotent: a second migrate() must not throw (column already present).
    expect(() => migrate(db)).not.toThrow();
  });
});
