import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "./db";
import { seedDatabase } from "./seed";
import { seedHistory } from "./seed/history";
import {
  assemble,
  computeDashboard,
  rangeStart,
  isTimeRange,
  type DashboardMetrics,
} from "./metrics";
import type { DashboardRollup } from "./repo/metrics_rollup";
import type { Escalation } from "./repo/escalations";

function rollup(over: Partial<DashboardRollup> = {}): DashboardRollup {
  return {
    answered: 0,
    escalated: 0,
    outOfScope: 0,
    answeredWithSource: 0,
    groundednessSum: 0,
    groundednessN: 0,
    thumbsUp: 0,
    thumbsDown: 0,
    byIntent: [],
    byProvider: [],
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
    promoted_entry_id: null,
    delivery: "live",
    contact_name: null,
    contact_email: null,
    delivered_at: null,
    created_at: "2026-09-20T00:00:00Z",
  };
}

describe("assemble (pure, over the rollup)", () => {
  it("computes containment, attribution, hours saved, and CSAT", () => {
    const m = assemble(
      rollup({
        answered: 8,
        escalated: 2,
        outOfScope: 1,
        answeredWithSource: 7,
        thumbsUp: 2,
        thumbsDown: 1,
      }),
      [],
      0,
      0,
      6,
    );
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
    const m = assemble(rollup(), escs, 0, 0);
    expect(m.topGaps.map((g) => [g.question, g.count])).toEqual([
      ["Do you offer part-time?", 3],
      ["Nut-free classroom?", 1],
    ]);
    expect(m.topGaps.some((g) => g.question.includes("fever"))).toBe(false);
  });

  it("averages judge groundedness from the rollup sum/count", () => {
    expect(assemble(rollup({ groundednessSum: 1.9, groundednessN: 2 }), [], 0, 0).groundedness).toBeCloseTo(0.95);
  });

  it("groundedness is null when nothing has been judged", () => {
    expect(assemble(rollup({ groundednessN: 0 }), [], 0, 0).groundedness).toBeNull();
  });

  it("slices by provider only when more than one has handled traffic", () => {
    const single = assemble(
      rollup({ byProvider: [{ provider: "anthropic", total: 1, answered: 1, groundednessSum: 0, groundednessN: 0 }] }),
      [],
      0,
      0,
    );
    expect(single.byProvider).toEqual([]);

    const both = assemble(
      rollup({
        byProvider: [
          { provider: "anthropic", total: 2, answered: 1, groundednessSum: 0.9, groundednessN: 1 },
          { provider: "google", total: 1, answered: 1, groundednessSum: 0.8, groundednessN: 1 },
        ],
      }),
      [],
      0,
      0,
    );
    expect(both.byProvider.map((p) => p.provider)).toEqual(["anthropic", "google"]);
    const claude = both.byProvider.find((p) => p.provider === "anthropic")!;
    expect(claude.total).toBe(2);
    expect(claude.containmentRate).toBeCloseTo(0.5);
    expect(both.byProvider.find((p) => p.provider === "google")!.groundedness).toBeCloseTo(0.8);
  });

  it("handles an empty rollup without dividing by zero", () => {
    const m = assemble(rollup(), [], 0, 0);
    expect(m).toMatchObject<Partial<DashboardMetrics>>({
      total: 0,
      containmentRate: 0,
      attributionRate: 0,
      hoursSaved: 0,
      groundedness: null,
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
    const m = computeDashboard(db, "all");
    expect(m.total).toBe(56); // 42 answered + 14 escalated
    expect(m.answered).toBe(42);
    expect(m.escalated).toBe(14);
    expect(m.containmentRate).toBeCloseTo(42 / 56);
    expect(m.hoursSaved).toBeCloseTo((42 * 6) / 60);
    expect(m.capturedEntries).toBe(1);
    expect(m.waiting).toBe(2);
    expect(m.topGaps[0].question).toMatch(/part-time/i);
    expect(m.topGaps[0].count).toBe(5);
    expect(m.topGaps.every((g) => !g.reason.startsWith("sensitive:"))).toBe(true);
  });

  it("reports seeded judge groundedness (answered rows are pre-scored)", () => {
    const m = computeDashboard(db);
    expect(m.groundedness).not.toBeNull();
    expect(m.groundedness!).toBeGreaterThan(0.85);
    expect(m.groundedness!).toBeLessThanOrEqual(1);
  });

  it("narrows period metrics as the range tightens, but never the waiting count", () => {
    const all = computeDashboard(db, "all");
    const month = computeDashboard(db, "month");
    const week = computeDashboard(db, "week");
    const today = computeDashboard(db, "today");

    // Tighter windows include no more than wider ones.
    expect(all.total).toBeGreaterThanOrEqual(month.total);
    expect(month.total).toBeGreaterThanOrEqual(week.total);
    expect(week.total).toBeGreaterThanOrEqual(today.total);

    // The full seed is the lifetime total; a rolling window sees a subset.
    expect(all.total).toBe(56);
    expect(week.total).toBeGreaterThan(0);

    // Open escalations are current state — unaffected by the date filter.
    for (const m of [all, month, week, today]) expect(m.waiting).toBe(2);
  });
});

describe("time-range helpers", () => {
  it("validates range identifiers", () => {
    expect(["today", "week", "month", "all"].every(isTimeRange)).toBe(true);
    expect(isTimeRange("year")).toBe(false);
    expect(isTimeRange(undefined)).toBe(false);
  });

  it("computes lower bounds; 'all' is unbounded", () => {
    const now = new Date("2026-09-22T15:30:00Z");
    expect(rangeStart("all", now)).toBeNull();

    const today = rangeStart("today", now)!;
    expect(today.getHours()).toBe(0);
    expect(today.getMinutes()).toBe(0);
    expect(today.getTime()).toBeLessThanOrEqual(now.getTime());

    const week = rangeStart("week", now)!;
    const month = rangeStart("month", now)!;
    // week starts after month; today starts after week.
    expect(month.getTime()).toBeLessThan(week.getTime());
    expect(week.getTime()).toBeLessThan(today.getTime());
  });
});
