import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { getPolicy } from "../repo/policies";
import { seedDatabase } from "../seed";
import type { PolicyRecord } from "../types";
import { buildSourceIndex, extractFacts, verifyFacts } from "./facts";

describe("extractFacts", () => {
  const normalsOf = (text: string) =>
    extractFacts(text).flatMap((f) => f.normals);

  it("normalizes currency (N1: $1,650 ↔ 1650)", () => {
    const facts = extractFacts("Infant tuition is $1,650/mo, late pickup $15.");
    const money = facts.filter((f) => f.kind === "money");
    expect(money.map((f) => f.normals[0])).toEqual(["1650", "15"]);
  });

  it("normalizes temperature (N1: 100.4°F ↔ 100.4)", () => {
    expect(normalsOf("a fever is 100.4°F or higher")).toContain("100.4");
    expect(normalsOf("100.4 F")).toContain("100.4");
  });

  it("normalizes month-name and ISO dates (N1: Nov 11 ↔ 2026-11-11)", () => {
    expect(normalsOf("closed on November 11")).toContain("11-11");
    expect(normalsOf("closed on 2026-11-11")).toEqual(
      expect.arrayContaining(["2026-11-11", "11-11"]),
    );
    expect(normalsOf("Nov 11, 2026")).toEqual(
      expect.arrayContaining(["2026-11-11", "11-11"]),
    );
  });

  it("extracts times with zero-padding (7:00 → 07:00)", () => {
    expect(normalsOf("we open at 10:00")).toContain("10:00");
    expect(normalsOf("breakfast at 8:00")).toContain("08:00");
  });

  it("does not double-count $15 as a bare 15 plus money", () => {
    const facts = extractFacts("the fee is $15");
    expect(facts).toHaveLength(1);
    expect(facts[0].kind).toBe("money");
  });

  it("extracts bare numbers for thresholds (24 hours, 3 pickups)", () => {
    expect(normalsOf("fever-free for 24 hours")).toContain("24");
    expect(normalsOf("after 3 late pickups")).toContain("3");
  });

  it("finds no facts in fact-free text", () => {
    expect(extractFacts("Let me check with our team — one moment.")).toEqual([]);
  });
});

describe("verifyFacts against real seeded policies", () => {
  let db: Database;
  const cite = (...ids: string[]): PolicyRecord[] =>
    ids.map((id) => getPolicy(db, id)!);

  beforeEach(() => {
    db = createMemoryDb();
    seedDatabase(db);
  });

  it("passes the correct fever threshold cited from the illness policy", () => {
    const r = verifyFacts(
      "A fever means 100.4°F or higher, or any fever in the last 24 hours.",
      cite("health.illness_exclusion"),
    );
    expect(r.ok).toBe(true);
  });

  it("BLOCKS a wrong fever threshold (101) — right source, wrong number", () => {
    const r = verifyFacts(
      "A fever means 101°F or higher.",
      cite("health.illness_exclusion"),
    );
    expect(r.ok).toBe(false);
    expect(r.unsupported.some((f) => f.normals.includes("101"))).toBe(true);
  });

  it("passes the $15 / 3-strike late-pickup answer", () => {
    const r = verifyFacts(
      "Late pickup is $15 per occurrence, and after 3 late pickups we'll ask for a conference.",
      cite("hours.late_pickup"),
    );
    expect(r.ok).toBe(true);
  });

  it("BLOCKS a wrong late fee ($25)", () => {
    const r = verifyFacts(
      "Late pickup is $25 per occurrence.",
      cite("hours.late_pickup"),
    );
    expect(r.ok).toBe(false);
  });

  it("passes the Veterans Day closure date", () => {
    const r = verifyFacts(
      "Yes — we're closed on Veterans Day, November 11, 2026.",
      cite("hours.holidays.2026"),
    );
    expect(r.ok).toBe(true);
  });

  it("passes the 11:30 family-style lunch answer", () => {
    const r = verifyFacts(
      "We provide lunch — it's served family-style at 11:30, so no need to pack anything.",
      cite("meals.provided"),
    );
    expect(r.ok).toBe(true);
  });

  it("passes correct tuition figures", () => {
    const r = verifyFacts(
      "Infant tuition is $1,650/mo and Pre-K is $1,150/mo.",
      cite("tuition.rates"),
    );
    expect(r.ok).toBe(true);
  });

  it("BLOCKS a fact drawn from a policy that wasn't cited", () => {
    // States the fever threshold but cites the meals policy only.
    const r = verifyFacts(
      "A fever is 100.4°F or higher.",
      cite("meals.provided"),
    );
    expect(r.ok).toBe(false);
  });

  it("buildSourceIndex includes structured values and prose numbers", () => {
    const idx = buildSourceIndex(cite("hours.late_pickup"));
    expect(idx.has("15")).toBe(true); // late_fee_usd
    expect(idx.has("3")).toBe(true); // late_strikes_before_conference
    expect(idx.has("30")).toBe(true); // unreachable_after_minutes
  });
});
