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
  active_provider: "anthropic",
  availability: "online",
  operator_name: "",
  away_message: "",
  offline_at: null,
};

/** Read settings, creating the single row with defaults if absent. */
export function getSettings(db: Database): Settings {
  const row = db
    .prepare(
      `SELECT caution_level, active_provider, availability, operator_name, away_message, offline_at
         FROM settings WHERE id = 1`,
    )
    .get() as Settings | undefined;
  if (row) return row;

  db.prepare(
    `INSERT INTO settings (id, caution_level, active_provider, availability, operator_name, away_message, offline_at)
     VALUES (1, @caution_level, @active_provider, @availability, @operator_name, @away_message, @offline_at)`,
  ).run(DEFAULTS);
  return { ...DEFAULTS };
}

/**
 * Settings with the auto-offline schedule applied (analysis/11 §4.1). If the
 * desk is Online and its `offline_at` time has passed, flip it to Away and clear
 * the schedule — resolved lazily on read, so no background scheduler is needed
 * on the single container. Every availability consumer reads through this.
 */
export function resolveAvailability(db: Database): Settings {
  const s = getSettings(db);
  if (s.availability === "online" && s.offline_at && Date.now() >= Date.parse(s.offline_at)) {
    return updateSettings(db, { availability: "away", offline_at: null });
  }
  return s;
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
            active_provider = @active_provider,
            availability = @availability,
            operator_name = @operator_name,
            away_message = @away_message,
            offline_at = @offline_at
      WHERE id = 1`,
  ).run(next);
  return next;
}
