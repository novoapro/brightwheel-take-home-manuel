import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "./db";
import { seedDatabase } from "./seed";
import { seedHistory } from "./seed/history";
import { aggregate, computeDashboard, type DashboardMetrics } from "./metrics";
import type { AuditMetricRow } from "./repo/audit";
import type { Escalation } from "./repo/escalations";

function audit(over: Partial<AuditMetricRow>): AuditMetricRow {
  return {
    decision: "answered",
    decision_reason: "grounded",
    detected_intent: "hours",
    parent_feedback: null,
    cited_count: 1,
    timestamp: "2026-09-20T00:00:00Z",
    ...over,
  };
}
function esc(question: string, reason: string): Escalation {
  return {
    id: question + reason,
    interaction_id: "i",
    question,
    detected_intent: "out_of_scope",
    reason,
    status: "waiting",
    operator_answer: null,
    answered_by: null,
    answered_at: null,
    promoted_policy_id: null,
    created_at: "2026-09-20T00:00:00Z",
  };
}

describe("aggregate (pure)", () => {
  it("computes containment, attribution, hours saved, and feedback", () => {
    const audits: AuditMetricRow[] = [
      ...Array(6).fill(0).map(() => audit({ cited_count: 1 })),
      audit({ cited_count: 0, parent_feedback: "up" }), // answered, no source
      audit({ parent_feedback: "up" }),
      audit({ decision: "escalated", decision_reason: "out_of_scope", detected_intent: "out_of_scope" }),
      audit({ decision: "escalated", decision_reason: "sensitive:case_specific", detected_intent: "health", parent_feedback: "down" }),
    ];
    const m = aggregate(audits, [], 0, 0, 6);
    expect(m.total).toBe(10);
    expect(m.answered).toBe(8);
    expect(m.escalated).toBe(2);
    expect(m.containmentRate).toBeCloseTo(0.8);
    expect(m.escalationRate).toBeCloseTo(0.2);
    expect(m.coverageGapRate).toBeCloseTo(0.1); // one out_of_scope
    expect(m.attributionRate).toBeCloseTo(7 / 8); // 7 of 8 answered had a source
    expect(m.hoursSaved).toBeCloseTo((8 * 6) / 60); // 0.8h
    expect(m.thumbsUp).toBe(2);
    expect(m.thumbsDown).toBe(1);
  });

  it("ranks top gaps by frequency and excludes sensitive/case-specific relays", () => {
    const escs = [
      esc("Do you offer part-time?", "out_of_scope"),
      esc("Do you offer part-time?", "out_of_scope"),
      esc("Do you offer part-time?", "out_of_scope"),
      esc("Nut-free classroom?", "out_of_scope"),
      esc("My child has a fever", "sensitive:case_specific"),
    ];
    const m = aggregate([], escs, 0, 0);
    expect(m.topGaps.map((g) => [g.question, g.count])).toEqual([
      ["Do you offer part-time?", 3],
      ["Nut-free classroom?", 1],
    ]);
    expect(m.topGaps.some((g) => g.question.includes("fever"))).toBe(false);
  });

  it("handles an empty log without dividing by zero", () => {
    const m = aggregate([], [], 0, 0);
    expect(m).toMatchObject<Partial<DashboardMetrics>>({
      total: 0,
      containmentRate: 0,
      attributionRate: 0,
      hoursSaved: 0,
    });
  });
});

describe("computeDashboard over seeded history", () => {
  let db: Database;
  beforeEach(() => {
    db = createMemoryDb();
    seedDatabase(db);
    seedHistory(db);
  });

  it("reflects a realistic week", () => {
    const m = computeDashboard(db);
    expect(m.total).toBe(56); // 42 answered + 14 escalated
    expect(m.answered).toBe(42);
    expect(m.escalated).toBe(14);
    expect(m.containmentRate).toBeCloseTo(42 / 56);
    expect(m.hoursSaved).toBeCloseTo((42 * 6) / 60);
    expect(m.capturedPolicies).toBe(1);
    expect(m.waiting).toBe(2);
    expect(m.topGaps[0].question).toMatch(/part-time/i);
    expect(m.topGaps[0].count).toBe(5);
    expect(m.topGaps.every((g) => !g.reason.startsWith("sensitive:"))).toBe(true);
  });
});
