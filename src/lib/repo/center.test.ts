import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { getCenter, upsertCenter } from "./center";
import type { Center } from "../types";

const center: Center = {
  id: "little-acorns",
  name: "Little Acorns",
  city: "Albuquerque",
  state: "NM",
  phone: "(505) 555-0182",
  timezone: "America/Denver",
  hours_general: "Mon–Fri 7–6",
  age_groups: [{ group: "Infant", range: "6 wks–12 mo" }],
  persona_notes: "Warm.",
};

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

describe("center repo", () => {
  it("returns null when no center is seeded", () => {
    expect(getCenter(db)).toBeNull();
  });

  it("round-trips age_groups as a parsed array", () => {
    upsertCenter(db, center);
    const c = getCenter(db)!;
    expect(c.age_groups).toEqual([{ group: "Infant", range: "6 wks–12 mo" }]);
    expect(Array.isArray(c.age_groups)).toBe(true);
    expect(c.name).toBe("Little Acorns");
  });

  it("upserts in place (single instance)", () => {
    upsertCenter(db, center);
    upsertCenter(db, { ...center, phone: "(505) 555-9999" });
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM center`).get() as { n: number }).n,
    ).toBe(1);
    expect(getCenter(db)!.phone).toBe("(505) 555-9999");
  });
});
