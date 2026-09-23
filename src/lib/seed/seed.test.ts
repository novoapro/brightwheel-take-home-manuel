import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { getCenter } from "../repo/center";
import { countPolicies, getPolicy, listPolicies } from "../repo/policies";
import { getSettings } from "../repo/settings";
import { INTENTS, SENSITIVE_INTENTS } from "../types";
import { seedDatabase } from "./index";
import { POLICIES } from "./data";

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

describe("seedDatabase", () => {
  it("seeds the center, the policy set, and default settings", () => {
    const result = seedDatabase(db);
    expect(result.policies).toBe(POLICIES.length);
    expect(getCenter(db)?.name).toMatch(/Little Acorns/);
    expect(getSettings(db)).toEqual({
      caution_level: "balanced",
      active_provider: "anthropic",
      availability: "online",
      operator_name: "",
      away_message: "",
      offline_at: null,
    });
    expect(countPolicies(db)).toBe(POLICIES.length);
  });

  it("seeds 15–25 policies (analysis/01 §6 sizing)", () => {
    seedDatabase(db);
    const n = countPolicies(db);
    expect(n).toBeGreaterThanOrEqual(15);
    expect(n).toBeLessThanOrEqual(25);
  });

  it("is idempotent — re-seeding does not duplicate", () => {
    seedDatabase(db);
    seedDatabase(db);
    expect(countPolicies(db)).toBe(POLICIES.length);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM center`).get() as { n: number }).n,
    ).toBe(1);
  });

  it("covers all five intents", () => {
    seedDatabase(db);
    for (const intent of INTENTS) {
      expect(listPolicies(db, { intent }).length).toBeGreaterThan(0);
    }
  });

  it("flags exactly the health policies as sensitive, and nothing else", () => {
    seedDatabase(db);
    const sensitive = listPolicies(db, {}).filter(
      (p) => p.sensitivity === "sensitive",
    );
    expect(sensitive.length).toBeGreaterThan(0);
    for (const p of sensitive) {
      expect(SENSITIVE_INTENTS).toContain(p.intent);
    }
    // and every health policy is marked sensitive
    for (const p of listPolicies(db, { intent: "health" })) {
      expect(p.sensitivity).toBe("sensitive");
    }
  });

  it("every policy has a source, keywords, and a non-empty structured payload", () => {
    seedDatabase(db);
    for (const p of listPolicies(db, {})) {
      expect(p.source, `${p.id} source`).toBeTruthy();
      expect(p.keywords.length, `${p.id} keywords`).toBeGreaterThan(0);
      expect(
        Object.keys(p.structured).length,
        `${p.id} structured`,
      ).toBeGreaterThan(0);
    }
  });

  it("all seeded policies are published (parent-visible source of truth)", () => {
    seedDatabase(db);
    for (const p of listPolicies(db, {})) expect(p.status).toBe("published");
  });

  // ── The deterministic showcases (analysis/02 §4) must be answerable from data ──
  describe("deterministic showcases have the exact facts", () => {
    beforeEach(() => seedDatabase(db));

    it("Veterans Day 2026-11-11 is in the closure calendar", () => {
      const holidays = getPolicy(db, "hours.holidays.2026")!;
      const closures = (
        holidays.structured.closures as { date: string; name: string }[]
      );
      const veterans = closures.find((c) => c.date === "2026-11-11");
      expect(veterans?.name).toMatch(/Veterans Day/);
    });

    it("snow policy encodes the delay → 10:00 open, no breakfast cascade", () => {
      const snow = getPolicy(db, "hours.snow_weather")!;
      const s = snow.structured as {
        delay: { open: string; breakfast_served: boolean };
        early_dismissal: { action: string };
        closure: { action: string };
      };
      expect(s.delay.open).toBe("10:00");
      expect(s.delay.breakfast_served).toBe(false);
      expect(s.early_dismissal.action).toBe("center_closes");
      expect(s.closure.action).toBe("center_closed");
    });

    it("fever threshold is exactly 100.4°F", () => {
      const illness = getPolicy(db, "health.illness_exclusion")!;
      expect((illness.structured as { fever_f: number }).fever_f).toBe(100.4);
    });

    it("return-to-care requires 24 fever-free hours", () => {
      const ret = getPolicy(db, "health.return_to_care")!;
      expect((ret.structured as { fever_free_hours: number }).fever_free_hours).toBe(
        24,
      );
    });

    it("late pickup is $15/occurrence with a 3-strike conference rule", () => {
      const late = getPolicy(db, "hours.late_pickup")!;
      const s = late.structured as {
        late_fee_usd: number;
        late_strikes_before_conference: number;
      };
      expect(s.late_fee_usd).toBe(15);
      expect(s.late_strikes_before_conference).toBe(3);
    });

    it("lunch is served at 11:30 and meals are provided", () => {
      const meals = getPolicy(db, "meals.provided")!;
      const s = meals.structured as {
        included: boolean;
        times: { lunch: string };
      };
      expect(s.included).toBe(true);
      expect(s.times.lunch).toBe("11:30");
    });

    it("tuition has a rate for every age band", () => {
      const tuition = getPolicy(db, "tuition.rates")!;
      const rates = (tuition.structured as { rates: { group: string }[] })
        .rates;
      expect(rates.map((r) => r.group).sort()).toEqual([
        "infant",
        "prek",
        "preschool",
        "toddler",
      ]);
    });
  });

  it("policy ids are unique in the seed source", () => {
    const ids = POLICIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
