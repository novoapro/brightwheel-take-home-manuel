import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { getSettings, updateSettings } from "./settings";

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
    expect(s).toEqual({ caution_level: "balanced", active_provider: "claude" });
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
    expect(s.active_provider).toBe("claude"); // untouched
  });

  it("patches multiple fields", () => {
    const s = updateSettings(db, {
      caution_level: "lean",
      active_provider: "gemini",
    });
    expect(s).toEqual({ caution_level: "lean", active_provider: "gemini" });
    expect(getSettings(db)).toEqual(s);
  });

  it("rejects an invalid caution level via CHECK", () => {
    expect(() =>
      // @ts-expect-error — invalid on purpose
      updateSettings(db, { caution_level: "reckless" }),
    ).toThrow();
  });
});
