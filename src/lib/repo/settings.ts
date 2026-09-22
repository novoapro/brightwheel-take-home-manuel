import type { Database } from "better-sqlite3";
import type { Settings } from "../types";

/**
 * Repository for the single-row Settings (analysis/01 §2.6).
 *
 * The row is lazily created with defaults on first read, so callers never have
 * to worry about whether it exists. HARD_SENSITIVE floor-lock is intentionally
 * NOT here — it is code-fixed and cannot be tuned down (analysis/01 §2.6).
 */

const DEFAULTS: Settings = {
  caution_level: "balanced",
  active_provider: "claude",
};

/** Read settings, creating the single row with defaults if absent. */
export function getSettings(db: Database): Settings {
  const row = db
    .prepare(
      `SELECT caution_level, active_provider FROM settings WHERE id = 1`,
    )
    .get() as Settings | undefined;
  if (row) return row;

  db.prepare(
    `INSERT INTO settings (id, caution_level, active_provider)
     VALUES (1, @caution_level, @active_provider)`,
  ).run(DEFAULTS);
  return { ...DEFAULTS };
}

/** Patch one or more settings fields; returns the updated settings. */
export function updateSettings(
  db: Database,
  patch: Partial<Settings>,
): Settings {
  const current = getSettings(db);
  const next: Settings = { ...current, ...patch };
  db.prepare(
    `UPDATE settings
        SET caution_level = @caution_level,
            active_provider = @active_provider
      WHERE id = 1`,
  ).run(next);
  return next;
}
