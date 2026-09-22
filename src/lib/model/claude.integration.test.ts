import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { seedDatabase } from "../seed";
import { ask } from "../frontdesk";
import { ClaudeFrontDeskModel } from "./claude";

/**
 * Live integration test against the real Claude API. It spends real money, so
 * it runs ONLY when BOTH an API key and an explicit opt-in flag are set:
 *
 *   RUN_LLM_IT=1 ANTHROPIC_API_KEY=sk-... npm test
 *
 * A plain `npm test` always skips it — CI and local runs never incur cost by
 * accident. The deterministic guardrail logic is covered by the fast unit tests
 * with a fake model; this is a smoke test of the Sonnet 5 adapter wiring.
 */
const enabled = process.env.RUN_LLM_IT === "1" && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!enabled)("ClaudeFrontDeskModel (live)", () => {
  let db: Database;
  beforeEach(() => {
    db = createMemoryDb();
    seedDatabase(db);
  });

  it("grounds the Veterans Day showcase and cites the closure calendar", async () => {
    const r = await ask(db, {
      question: "Are you open on Veterans Day?",
      model: new ClaudeFrontDeskModel(),
    });
    expect(r.decision).toBe("answered");
    expect(r.citations).toContain("hours.holidays.2026");
    expect(r.parent_message.length).toBeGreaterThan(0);
  }, 30_000);

  it("escalates a specific-child fever question rather than answering it", async () => {
    const r = await ask(db, {
      question: "My son had a fever last night — can he come in today?",
      model: new ClaudeFrontDeskModel(),
    });
    expect(r.decision).toBe("relayed");
  }, 30_000);
});
