import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import {
  countPolicies,
  getPolicy,
  listPolicies,
  listPublishedPolicies,
  upsertPolicy,
} from "./policies";
import type { PolicyInput } from "../types";

const base: PolicyInput = {
  id: "hours.regular",
  intent: "hours",
  title: "Hours",
  body_md: "Open 7–6.",
  structured: { days: { mon: "07:00-18:00" }, closed: ["sat", "sun"] },
  keywords: ["hours", "open"],
};

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

describe("policies repo", () => {
  it("round-trips structured + keywords as parsed objects, not JSON strings", () => {
    const saved = upsertPolicy(db, base);
    expect(saved.structured).toEqual(base.structured);
    expect(saved.keywords).toEqual(base.keywords);

    const fetched = getPolicy(db, "hours.regular")!;
    expect(fetched.structured).toEqual(base.structured);
    expect(fetched.keywords).toEqual(["hours", "open"]);
    // Confirm it is a live object, not a string.
    expect(typeof fetched.structured).toBe("object");
  });

  it("applies defaults for optional fields", () => {
    const p = upsertPolicy(db, base);
    expect(p.sensitivity).toBe("none");
    expect(p.status).toBe("published");
    expect(p.origin).toBe("seed");
    expect(p.version).toBe(1);
    expect(p.effective_from).toBeNull();
    expect(p.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves explicitly-set optional fields", () => {
    const p = upsertPolicy(db, {
      ...base,
      id: "health.x",
      intent: "health",
      sensitivity: "sensitive",
      status: "draft",
      origin: "captured",
      source: "Handbook p.12",
      effective_from: "2026-01-01",
    });
    expect(p.sensitivity).toBe("sensitive");
    expect(p.status).toBe("draft");
    expect(p.origin).toBe("captured");
    expect(p.source).toBe("Handbook p.12");
    expect(p.effective_from).toBe("2026-01-01");
  });

  it("bumps version on upsert of an existing id and updates content", () => {
    upsertPolicy(db, base);
    const v2 = upsertPolicy(db, { ...base, title: "New Hours" });
    expect(v2.version).toBe(2);
    expect(v2.title).toBe("New Hours");
    expect(countPolicies(db)).toBe(1); // upsert, not duplicate
  });

  it("returns null for a missing policy", () => {
    expect(getPolicy(db, "nope")).toBeNull();
  });

  it("filters listPolicies by intent and status", () => {
    upsertPolicy(db, base);
    upsertPolicy(db, { ...base, id: "tuition.rates", intent: "tuition" });
    upsertPolicy(db, {
      ...base,
      id: "hours.draft",
      intent: "hours",
      status: "draft",
    });

    expect(listPolicies(db, { intent: "hours" }).map((p) => p.id)).toEqual([
      "hours.draft",
      "hours.regular",
    ]);
    expect(listPolicies(db, { status: "published" }).length).toBe(2);
    expect(
      listPolicies(db, { intent: "hours", status: "published" }).map(
        (p) => p.id,
      ),
    ).toEqual(["hours.regular"]);
  });

  it("listPublishedPolicies excludes drafts", () => {
    upsertPolicy(db, base);
    upsertPolicy(db, { ...base, id: "d", status: "draft" });
    const published = listPublishedPolicies(db);
    expect(published.map((p) => p.id)).toEqual(["hours.regular"]);
  });

  it("rejects an invalid intent at the DB boundary", () => {
    expect(() =>
      // @ts-expect-error — intentionally invalid to prove the CHECK guards it
      upsertPolicy(db, { ...base, intent: "bogus" }),
    ).toThrow();
  });
});
