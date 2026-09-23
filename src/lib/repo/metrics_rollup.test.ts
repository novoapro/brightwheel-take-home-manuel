import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { createConversation } from "./conversations";
import { createParentSession, setSessionRating } from "./sessions";
import { insertAudit, setJudgeScores } from "./audit";
import {
  foldTurn,
  foldGroundedness,
  foldCsat,
  readRollup,
  recomputeMetrics,
  metricsNeedBackfill,
} from "./metrics_rollup";

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

const T = "2026-09-20T10:00:00.000Z";

describe("metrics rollup — incremental folds", () => {
  it("folds turns, groundedness, and CSAT into readable totals", () => {
    foldTurn(db, { timestamp: T, intent: "hours", provider: "anthropic", decision: "answered", decision_reason: "grounded", cited_count: 1 });
    foldTurn(db, { timestamp: T, intent: "hours", provider: "anthropic", decision: "answered", decision_reason: "grounded", cited_count: 0 });
    foldTurn(db, { timestamp: T, intent: "out_of_scope", provider: "anthropic", decision: "escalated", decision_reason: "out_of_scope", cited_count: 0 });
    foldGroundedness(db, { timestamp: T, intent: "hours", provider: "anthropic" }, 0.9);
    foldCsat(db, T, "up");
    foldCsat(db, T, "down");

    const r = readRollup(db, null);
    expect(r.answered).toBe(2);
    expect(r.escalated).toBe(1);
    expect(r.outOfScope).toBe(1);
    expect(r.answeredWithSource).toBe(1);
    expect(r.groundednessSum).toBeCloseTo(0.9);
    expect(r.groundednessN).toBe(1);
    expect(r.thumbsUp).toBe(1);
    expect(r.thumbsDown).toBe(1);
    expect(r.byIntent.find((i) => i.intent === "hours")!.answered).toBe(2);
  });

  it("filters by the range start (day bucket)", () => {
    foldTurn(db, { timestamp: "2026-09-01T00:00:00Z", intent: "hours", provider: "a", decision: "answered", decision_reason: "grounded", cited_count: 1 });
    foldTurn(db, { timestamp: "2026-09-20T00:00:00Z", intent: "hours", provider: "a", decision: "answered", decision_reason: "grounded", cited_count: 1 });
    expect(readRollup(db, null).answered).toBe(2);
    expect(readRollup(db, new Date("2026-09-10T00:00:00Z")).answered).toBe(1);
  });
});

describe("metrics rollup — recompute + backfill", () => {
  it("rebuilds the rollup from raw audit rows + ratings", () => {
    const conv = "c1";
    createConversation(db, { id: conv, session_id: "s1", active_provider: "anthropic" });
    createParentSession(db, { id: "s1", name: "P", email: "p@x.com", conversation_id: conv });
    insertAudit(db, {
      id: "i1",
      session_id: "s1",
      conversation_id: conv,
      parent_question: "?",
      detected_intent: "hours",
      decision: "answered",
      decision_reason: "grounded",
      provider: "anthropic",
      cited_sources: ["hours.regular"],
    });
    setJudgeScores(db, "i1", { groundedness: 0.8, answer_relevancy: 1 });
    setSessionRating(db, "s1", { rating: "up" });

    expect(metricsNeedBackfill(db)).toBe(true); // rollup empty, audit rows exist
    recomputeMetrics(db);
    expect(metricsNeedBackfill(db)).toBe(false);

    const r = readRollup(db, null);
    expect(r.answered).toBe(1);
    expect(r.answeredWithSource).toBe(1);
    expect(r.groundednessSum).toBeCloseTo(0.8);
    expect(r.groundednessN).toBe(1);
    expect(r.thumbsUp).toBe(1);
  });
});
