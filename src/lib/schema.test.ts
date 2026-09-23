import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
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

  it("migrates a legacy `policies` DB to `knowledge_entries` and repoints the FK", () => {
    // Build a pre-rename (schema ≤ 8) database by hand.
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE policies (
        id TEXT PRIMARY KEY,
        intent TEXT NOT NULL CHECK (intent IN ('hours','tuition','health','meals','tours')),
        title TEXT NOT NULL, body_md TEXT NOT NULL,
        structured TEXT NOT NULL DEFAULT '{}', keywords TEXT NOT NULL DEFAULT '[]',
        sensitivity TEXT NOT NULL DEFAULT 'none', effective_from TEXT, effective_to TEXT,
        source TEXT, status TEXT NOT NULL DEFAULT 'published',
        origin TEXT NOT NULL DEFAULT 'seed', version INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT, updated_at TEXT NOT NULL, embedding BLOB
      );
      CREATE TABLE escalations (
        id TEXT PRIMARY KEY, interaction_id TEXT, question TEXT NOT NULL,
        detected_intent TEXT, reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting', operator_answer TEXT, answered_by TEXT,
        answered_at TEXT, promoted_policy_id TEXT REFERENCES policies(id),
        delivery TEXT NOT NULL DEFAULT 'live', contact_name TEXT, contact_email TEXT,
        delivered_at TEXT, question_embedding BLOB, created_at TEXT NOT NULL
      );
      INSERT INTO policies (id, intent, title, body_md, updated_at)
        VALUES ('hours.regular', 'hours', 'Hours', 'Open 7–6.', '2026-01-01');
      INSERT INTO escalations (id, question, reason, promoted_policy_id, created_at)
        VALUES ('e1', 'q', 'captured', 'hours.regular', '2026-01-01');
    `);

    migrate(db);

    // Table renamed, row carried over.
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).toContain("knowledge_entries");
    expect(names).not.toContain("policies");
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries`).get() as { n: number }).n,
    ).toBe(1);

    // Escalation column renamed and still linked.
    const esc = db.prepare(`SELECT * FROM escalations WHERE id='e1'`).get() as {
      promoted_entry_id: string | null;
    };
    expect(esc.promoted_entry_id).toBe("hours.regular");

    // Post-migration the intent CHECK is gone (custom categories allowed).
    expect(() =>
      db
        .prepare(
          `INSERT INTO knowledge_entries (id, intent, title, body_md, updated_at)
           VALUES ('t.x', 'transportation', 't', 'b', '2026-01-01')`,
        )
        .run(),
    ).not.toThrow();
    db.close();
  });
});
