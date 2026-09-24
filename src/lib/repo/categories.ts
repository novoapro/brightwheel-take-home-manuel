import type { Database } from "better-sqlite3";
import {
  defaultSensitivityFor,
  INTENTS,
  type Category,
  type CategorySensitivity,
} from "../types";

/**
 * Repository for Category — the operator-owned KB categories (a.k.a. intents),
 * each with a three-level `sensitivity` tier that drives the guardrail
 * (analysis/09 §4.3): normal · sensitive (higher bar) · always_escalate (never
 * answered). Sensitivity used to be hard-coded constants the decision pipeline
 * read directly (`SENSITIVE_INTENTS`, `HARD_SENSITIVE`); it now lives here, per
 * category, so operators configure it from the Knowledge Base. As with the other
 * repos, every function takes an explicit `Database` so it's trivially testable.
 */

type CategoryRow = { name: string; sensitivity: CategorySensitivity; updated_at: string };

function rowToRecord(row: CategoryRow): Category {
  return { name: row.name, sensitivity: row.sensitivity, updated_at: row.updated_at };
}

/**
 * All categories, ordered: the built-in core intents first (canonical order),
 * then any operator-added categories alphabetically. Powers the editor's
 * category management panel, suggestions, and the grouped list view.
 */
export function listCategories(db: Database): Category[] {
  const rows = db
    .prepare(`SELECT name, sensitivity, updated_at FROM categories`)
    .all() as CategoryRow[];
  const byName = new Map(rows.map((r) => [r.name, rowToRecord(r)]));
  // Fold in any category already present on an entry but missing a row (e.g. data
  // that predates this table): show it at its default tier so the manager is
  // always complete, even before the migrate() backfill has run.
  for (const r of db
    .prepare(`SELECT DISTINCT intent FROM knowledge_entries`)
    .all() as { intent: string }[]) {
    if (!byName.has(r.intent)) {
      byName.set(r.intent, {
        name: r.intent,
        sensitivity: defaultSensitivityFor(r.intent),
        updated_at: "",
      });
    }
  }
  const core = INTENTS.filter((n) => byName.has(n)).map((n) => byName.get(n)!);
  const extras = [...byName.values()]
    .filter((c) => !(INTENTS as readonly string[]).includes(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...core, ...extras];
}

export function getCategory(db: Database, name: string): Category | null {
  const row = db
    .prepare(`SELECT name, sensitivity, updated_at FROM categories WHERE name = ?`)
    .get(name) as CategoryRow | undefined;
  return row ? rowToRecord(row) : null;
}

/** Create a category, or update its sensitivity tier if it already exists. */
export function upsertCategory(
  db: Database,
  input: { name: string; sensitivity: CategorySensitivity },
): Category {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO categories (name, sensitivity, updated_at)
       VALUES (@name, @sensitivity, @now)
       ON CONFLICT(name) DO UPDATE SET
         sensitivity = excluded.sensitivity,
         updated_at = excluded.updated_at`,
  ).run({ name: input.name, sensitivity: input.sensitivity, now });
  return getCategory(db, input.name)!;
}

/**
 * Ensure a category row exists for `name`, creating one at its default tier if
 * not. Called when a new intent first appears on an entry (create/import) so the
 * category table stays the authoritative source. Never touches an existing row's
 * tier — an operator's setting always wins.
 */
export function ensureCategory(db: Database, name: string): void {
  db.prepare(
    `INSERT INTO categories (name, sensitivity, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO NOTHING`,
  ).run(name, defaultSensitivityFor(name), new Date().toISOString());
}

/** How many knowledge entries currently reference a category. */
export function countEntriesInCategory(db: Database, name: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE intent = ?`)
      .get(name) as { n: number }
  ).n;
}

/**
 * Remove a category. Refused while any entry still uses it (the operator must
 * reassign or delete those entries first) so we never orphan the sensitivity a
 * live entry relies on. Returns whether it was deleted, and the in-use count when
 * it wasn't.
 */
export function deleteCategory(
  db: Database,
  name: string,
): { deleted: boolean; inUse: number } {
  const inUse = countEntriesInCategory(db, name);
  if (inUse > 0) return { deleted: false, inUse };
  const res = db.prepare(`DELETE FROM categories WHERE name = ?`).run(name);
  return { deleted: res.changes > 0, inUse: 0 };
}

/**
 * Category names at the *sensitive-or-stricter* tier — the pipeline's higher-bar
 * input (analysis/09 §4.3). `decide()` reads sensitivity from this instead of a
 * hard-coded list, so an operator's change takes effect on the next turn.
 */
export function sensitiveCategorySet(db: Database): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM categories WHERE sensitivity IN ('sensitive','always_escalate')`)
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * Category names at the *always-escalate* tier — answers under them are never
 * shown; the pipeline hard-relays them (the old HARD_SENSITIVE behavior, now
 * operator-owned).
 */
export function alwaysEscalateCategorySet(db: Database): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM categories WHERE sensitivity = 'always_escalate'`)
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}
