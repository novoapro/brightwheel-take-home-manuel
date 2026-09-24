import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import {
  alwaysEscalateCategorySet,
  deleteCategory,
  ensureCategory,
  getCategory,
  listCategories,
  sensitiveCategorySet,
  upsertCategory,
} from "./categories";
import { deleteEntry, upsertEntry } from "./knowledge";
import type { KnowledgeEntryInput } from "../types";

let db: Database;

const entry = (over: Partial<KnowledgeEntryInput> = {}): KnowledgeEntryInput => ({
  id: "hours.regular",
  intent: "hours",
  title: "Hours",
  body_md: "Open 7–6.",
  structured: {},
  keywords: [],
  ...over,
});

beforeEach(() => {
  db = createMemoryDb();
});

describe("categories repo", () => {
  it("seeds core categories with health sensitive by default", () => {
    const cats = listCategories(db);
    expect(cats.map((c) => c.name)).toEqual(["hours", "tuition", "health", "meals", "tours"]);
    expect(sensitiveCategorySet(db)).toEqual(new Set(["health"]));
    expect(getCategory(db, "health")!.sensitivity).toBe("sensitive");
    expect(getCategory(db, "hours")!.sensitivity).toBe("normal");
    // No core intent ships always-escalate.
    expect(alwaysEscalateCategorySet(db).size).toBe(0);
  });

  it("upsert sets a category's tier and is idempotent by name", () => {
    upsertCategory(db, { name: "transportation", sensitivity: "sensitive" });
    expect(sensitiveCategorySet(db).has("transportation")).toBe(true);
    // Re-upsert changes the tier without duplicating.
    upsertCategory(db, { name: "transportation", sensitivity: "always_escalate" });
    expect(getCategory(db, "transportation")!.sensitivity).toBe("always_escalate");
    expect(listCategories(db).filter((c) => c.name === "transportation")).toHaveLength(1);
  });

  it("always_escalate is a subset of the sensitive (higher-bar) set", () => {
    upsertCategory(db, { name: "safety", sensitivity: "always_escalate" });
    expect(alwaysEscalateCategorySet(db).has("safety")).toBe(true);
    expect(sensitiveCategorySet(db).has("safety")).toBe(true); // stricter ⇒ also sensitive
  });

  it("lists core categories first, then operator additions alphabetically", () => {
    upsertCategory(db, { name: "transportation", sensitivity: "normal" });
    upsertCategory(db, { name: "greetings", sensitivity: "normal" });
    const names = listCategories(db).map((c) => c.name);
    expect(names.slice(0, 5)).toEqual(["hours", "tuition", "health", "meals", "tours"]);
    expect(names.slice(5)).toEqual(["greetings", "transportation"]);
  });

  it("auto-creates a category at its default tier when a new intent appears", () => {
    upsertEntry(db, entry({ id: "transportation.bus", intent: "transportation" }));
    expect(getCategory(db, "transportation")!.sensitivity).toBe("normal");
    // A known-risky category name defaults to always-escalate.
    upsertEntry(db, entry({ id: "safety.lockdown", intent: "safety" }));
    expect(getCategory(db, "safety")!.sensitivity).toBe("always_escalate");
  });

  it("ensureCategory never overwrites an operator's tier", () => {
    upsertCategory(db, { name: "meds", sensitivity: "always_escalate" });
    ensureCategory(db, "meds");
    expect(getCategory(db, "meds")!.sensitivity).toBe("always_escalate");
  });

  it("refuses to delete a category still used by an entry, reporting the count", () => {
    upsertEntry(db, entry({ id: "transportation.bus", intent: "transportation" }));
    const res = deleteCategory(db, "transportation");
    expect(res).toEqual({ deleted: false, inUse: 1 });
    expect(getCategory(db, "transportation")).not.toBeNull();
  });

  it("deletes an unused category", () => {
    upsertEntry(db, entry({ id: "transportation.bus", intent: "transportation" }));
    deleteEntry(db, "transportation.bus");
    const res = deleteCategory(db, "transportation");
    expect(res.deleted).toBe(true);
    expect(getCategory(db, "transportation")).toBeNull();
  });
});
