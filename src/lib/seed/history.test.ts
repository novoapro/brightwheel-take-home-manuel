import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { seedDatabase } from "./index";
import { seedHistory } from "./history";
import { getEntry } from "../repo/knowledge";
import { listWaitingEscalations } from "../repo/escalations";

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
  seedDatabase(db);
});

const auditCount = (db: Database) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM interaction_audit`).get() as { n: number }).n;

describe("seedHistory", () => {
  it("seeds a week of interactions, escalations, and one captured policy", () => {
    const r = seedHistory(db);
    expect(r.audits).toBe(56);
    expect(r.escalations).toBe(14);
    expect(r.capturedEntries).toBe(1);
    expect(auditCount(db)).toBe(56);
    expect(getEntry(db, "captured.seed.summer-camp")?.origin).toBe("captured");
    expect(listWaitingEscalations(db)).toHaveLength(2);
  });

  it("is idempotent — re-running does not duplicate history", () => {
    seedHistory(db);
    seedHistory(db);
    expect(auditCount(db)).toBe(56);
    const captured = (
      db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE id LIKE 'captured.seed.%'`).get() as { n: number }
    ).n;
    expect(captured).toBe(1);
  });

  it("links the captured policy to its answered escalation (the loop)", () => {
    seedHistory(db);
    const esc = db
      .prepare(`SELECT * FROM escalations WHERE promoted_entry_id IS NOT NULL`)
      .get() as { status: string; promoted_entry_id: string } | undefined;
    expect(esc?.status).toBe("answered");
    expect(esc?.promoted_entry_id).toBe("captured.seed.summer-camp");
  });
});
