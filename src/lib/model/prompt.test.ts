import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { getCenter } from "../repo/center";
import { listPublishedEntries } from "../repo/knowledge";
import { seedDatabase } from "../seed";
import { buildSystemPrefix, relayMessage } from "./prompt";

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
  seedDatabase(db);
});

describe("buildSystemPrefix", () => {
  const build = () =>
    buildSystemPrefix(getCenter(db)!, listPublishedEntries(db));

  it("includes persona, center facts, and the grounding + escalation rules", () => {
    const s = build();
    expect(s).toContain("Little Acorns");
    expect(s).toContain("Albuquerque");
    expect(s).toContain("Answer ONLY from the CENTER POLICIES");
    expect(s).toContain("Policy vs. case");
    expect(s).toContain("check with our team");
  });

  it("embeds every published policy with its id and structured data", () => {
    const s = build();
    for (const p of listPublishedEntries(db)) {
      expect(s).toContain(`[${p.id}]`);
    }
    expect(s).toContain('"fever_f":100.4'); // structured payload is inlined
  });

  it("is deterministic (cache-stable) — identical across calls", () => {
    expect(build()).toBe(build());
  });

  it("orders policies by id so the cached prefix is byte-stable", () => {
    const s = build();
    const ids = listPublishedEntries(db)
      .map((p) => p.id)
      .sort((a, b) => a.localeCompare(b));
    const positions = ids.map((id) => s.indexOf(`[${id}]`));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });
});

describe("relayMessage", () => {
  it("is a warm holding message that mentions the team", () => {
    expect(relayMessage(null).toLowerCase()).toContain("team");
  });

  it("escalates urgency for hard-sensitive categories (safety → 911)", () => {
    expect(relayMessage("safety")).toContain("911");
  });
});
