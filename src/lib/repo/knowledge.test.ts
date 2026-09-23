import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import {
  countEntries,
  deleteEntry,
  getEntry,
  listEntries,
  listIntents,
  listPublishedEntries,
  upsertEntry,
} from "./knowledge";
import type { KnowledgeEntryInput } from "../types";

const base: KnowledgeEntryInput = {
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

describe("knowledge repo", () => {
  it("round-trips structured + keywords as parsed objects, not JSON strings", () => {
    const saved = upsertEntry(db, base);
    expect(saved.structured).toEqual(base.structured);
    expect(saved.keywords).toEqual(base.keywords);

    const fetched = getEntry(db, "hours.regular")!;
    expect(fetched.structured).toEqual(base.structured);
    expect(fetched.keywords).toEqual(["hours", "open"]);
    // Confirm it is a live object, not a string.
    expect(typeof fetched.structured).toBe("object");
  });

  it("applies defaults for optional fields", () => {
    const p = upsertEntry(db, base);
    expect(p.status).toBe("published");
    expect(p.origin).toBe("seed");
    expect(p.version).toBe(1);
    expect(p.effective_from).toBeNull();
    expect(p.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves explicitly-set optional fields", () => {
    const p = upsertEntry(db, {
      ...base,
      id: "health.x",
      intent: "health",
      status: "draft",
      origin: "captured",
      source: "Handbook p.12",
      effective_from: "2026-01-01",
    });
    expect(p.status).toBe("draft");
    expect(p.origin).toBe("captured");
    expect(p.source).toBe("Handbook p.12");
    expect(p.effective_from).toBe("2026-01-01");
  });

  it("bumps version on upsert of an existing id and updates content", () => {
    upsertEntry(db, base);
    const v2 = upsertEntry(db, { ...base, title: "New Hours" });
    expect(v2.version).toBe(2);
    expect(v2.title).toBe("New Hours");
    expect(countEntries(db)).toBe(1); // upsert, not duplicate
  });

  it("returns null for a missing policy", () => {
    expect(getEntry(db, "nope")).toBeNull();
  });

  it("filters listEntries by intent and status", () => {
    upsertEntry(db, base);
    upsertEntry(db, { ...base, id: "tuition.rates", intent: "tuition" });
    upsertEntry(db, {
      ...base,
      id: "hours.draft",
      intent: "hours",
      status: "draft",
    });

    expect(listEntries(db, { intent: "hours" }).map((p) => p.id)).toEqual([
      "hours.draft",
      "hours.regular",
    ]);
    expect(listEntries(db, { status: "published" }).length).toBe(2);
    expect(
      listEntries(db, { intent: "hours", status: "published" }).map(
        (p) => p.id,
      ),
    ).toEqual(["hours.regular"]);
  });

  it("listPublishedEntries serves only published entries (not draft or unpublished)", () => {
    upsertEntry(db, base);
    upsertEntry(db, { ...base, id: "d", status: "draft" });
    upsertEntry(db, { ...base, id: "u", status: "unpublished" });
    const published = listPublishedEntries(db);
    expect(published.map((p) => p.id)).toEqual(["hours.regular"]);
  });

  it("accepts an operator-added custom category (no fixed intent set)", () => {
    const p = upsertEntry(db, {
      ...base,
      id: "transportation.bus",
      intent: "transportation",
      title: "Bus routes",
    });
    expect(p.intent).toBe("transportation");
    expect(getEntry(db, "transportation.bus")!.intent).toBe("transportation");
  });

  it("deleteEntry removes the row and reports whether one was deleted", () => {
    upsertEntry(db, base);
    expect(deleteEntry(db, "hours.regular")).toBe(true);
    expect(getEntry(db, "hours.regular")).toBeNull();
    expect(deleteEntry(db, "hours.regular")).toBe(false); // already gone
  });

  it("listIntents lists core categories first, then custom ones alphabetically", () => {
    upsertEntry(db, base); // hours (core)
    upsertEntry(db, { ...base, id: "z.a", intent: "transportation" });
    upsertEntry(db, { ...base, id: "z.b", intent: "greetings" });
    const intents = listIntents(db);
    // Core intents always present and first, in canonical order.
    expect(intents.slice(0, 5)).toEqual(["hours", "tuition", "health", "meals", "tours"]);
    // Custom categories follow, sorted.
    expect(intents.slice(5)).toEqual(["greetings", "transportation"]);
  });
});
