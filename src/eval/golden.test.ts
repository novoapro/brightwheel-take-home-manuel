import { describe, it, expect } from "vitest";
import { createMemoryDb } from "../lib/db";
import { seedDatabase } from "../lib/seed";
import { listPolicies } from "../lib/repo/policies";
import { INTENTS, SENSITIVE_CATEGORIES } from "../lib/types";
import { GOLDEN_CASES } from "./golden";

describe("golden set integrity", () => {
  it("has a substantial set with unique ids", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(60);
    const ids = GOLDEN_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every answered case cites at least one REAL seeded policy id", () => {
    const db = createMemoryDb();
    seedDatabase(db);
    const realIds = new Set(listPolicies(db).map((p) => p.id));
    for (const c of GOLDEN_CASES) {
      if (c.expect.decision !== "answered") continue;
      expect(c.expect.citesAny, `${c.id} must declare citesAny`).toBeTruthy();
      for (const id of c.expect.citesAny!) {
        expect(realIds.has(id), `${c.id} cites unknown policy ${id}`).toBe(true);
      }
      expect((INTENTS as readonly string[]).includes(c.expect.intent!)).toBe(true);
    }
  });

  it("covers all five intents on the answered side", () => {
    const answeredIntents = new Set(
      GOLDEN_CASES.filter((c) => c.expect.decision === "answered").map((c) => c.expect.intent),
    );
    for (const i of INTENTS) expect(answeredIntents.has(i)).toBe(true);
  });

  it("exercises every sensitive category and the out-of-scope + adversarial buckets", () => {
    const cats = new Set(
      GOLDEN_CASES.map((c) => c.expect.sensitiveCategory).filter(Boolean),
    );
    for (const cat of SENSITIVE_CATEGORIES) {
      expect(cats.has(cat), `missing escalation case for ${cat}`).toBe(true);
    }
    expect(GOLDEN_CASES.some((c) => c.category === "adversarial")).toBe(true);
    expect(GOLDEN_CASES.some((c) => c.category === "out_of_scope")).toBe(true);
    expect(GOLDEN_CASES.some((c) => c.category === "paraphrase")).toBe(true);
  });
});
