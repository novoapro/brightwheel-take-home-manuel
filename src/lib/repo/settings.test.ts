import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { getSettings, resolveAvailability, updateSettings } from "./settings";

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

describe("settings repo", () => {
  it("lazily creates the row with defaults on first read", () => {
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM settings`).get() as { n: number })
        .n,
    ).toBe(0);
    const s = getSettings(db);
    expect(s).toEqual({
      caution_level: "balanced",
      active_provider: "anthropic",
      availability: "online",
      operator_name: "",
      away_message: "",
      offline_at: null,
    });
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM settings`).get() as { n: number })
        .n,
    ).toBe(1);
  });

  it("reading twice does not create a second row", () => {
    getSettings(db);
    getSettings(db);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM settings`).get() as { n: number })
        .n,
    ).toBe(1);
  });

  it("patches a single field and persists it", () => {
    updateSettings(db, { caution_level: "cautious" });
    const s = getSettings(db);
    expect(s.caution_level).toBe("cautious");
    expect(s.active_provider).toBe("anthropic"); // untouched
  });

  it("patches multiple fields", () => {
    const s = updateSettings(db, {
      caution_level: "lean",
      active_provider: "google",
    });
    expect(s).toEqual({
      caution_level: "lean",
      active_provider: "google",
      availability: "online",
      operator_name: "",
      away_message: "",
      offline_at: null,
    });
    expect(getSettings(db)).toEqual(s);
  });

  it("rejects an invalid caution level via CHECK", () => {
    expect(() =>
      // @ts-expect-error — invalid on purpose
      updateSettings(db, { caution_level: "reckless" }),
    ).toThrow();
  });

  it("persists availability + operator name (analysis/11 §4)", () => {
    updateSettings(db, { availability: "away", operator_name: "Maria" });
    const s = getSettings(db);
    expect(s.availability).toBe("away");
    expect(s.operator_name).toBe("Maria");
    expect(s.caution_level).toBe("balanced"); // untouched
  });

  it("rejects an invalid availability via CHECK", () => {
    expect(() =>
      // @ts-expect-error — invalid on purpose
      updateSettings(db, { availability: "vacation" }),
    ).toThrow();
  });

  describe("resolveAvailability — lazy auto-offline (analysis/11 §4.1)", () => {
    it("flips Online → Away once offline_at has passed, and clears it", () => {
      updateSettings(db, {
        availability: "online",
        operator_name: "Maria",
        offline_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
      });
      const s = resolveAvailability(db);
      expect(s.availability).toBe("away");
      expect(s.offline_at).toBeNull();
      // persisted, not just computed
      expect(getSettings(db).availability).toBe("away");
    });

    it("leaves Online untouched before offline_at", () => {
      updateSettings(db, {
        availability: "online",
        operator_name: "Maria",
        offline_at: new Date(Date.now() + 3_600_000).toISOString(), // 1 hr out
      });
      expect(resolveAvailability(db).availability).toBe("online");
    });

    it("is a no-op when no schedule is set", () => {
      updateSettings(db, { availability: "online", operator_name: "Maria" });
      expect(resolveAvailability(db).availability).toBe("online");
    });
  });
});
