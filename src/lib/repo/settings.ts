import type { Database } from "better-sqlite3";
import type { AuditMode, Settings } from "../types";

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
  developer_mode: false,
  audit_mode: "off",
};

/** SQLite stores `developer_mode` as 0/1; the DB row shape before coercion. */
type SettingsRow = Omit<Settings, "developer_mode"> & { developer_mode: number };

/** Bind params for the settings row (developer_mode as an integer). */
function toRow(s: Settings) {
  return { ...s, developer_mode: s.developer_mode ? 1 : 0 };
}

/** The effective audit mode — "off" whenever developer mode is disabled. */
export function effectiveAuditMode(s: Settings): AuditMode {
  return s.developer_mode ? s.audit_mode : "off";
}

/** Read settings, creating the single row with defaults if absent. */
export function getSettings(db: Database): Settings {
  const row = db
    .prepare(
      `SELECT caution_level, active_provider, availability, operator_name, away_message, offline_at, developer_mode, audit_mode
         FROM settings WHERE id = 1`,
    )
    .get() as SettingsRow | undefined;
  if (row) return { ...row, developer_mode: !!row.developer_mode };

  db.prepare(
    `INSERT INTO settings (id, caution_level, active_provider, availability, operator_name, away_message, offline_at, developer_mode, audit_mode)
     VALUES (1, @caution_level, @active_provider, @availability, @operator_name, @away_message, @offline_at, @developer_mode, @audit_mode)`,
  ).run(toRow(DEFAULTS));
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
            offline_at = @offline_at,
            developer_mode = @developer_mode,
            audit_mode = @audit_mode
      WHERE id = 1`,
  ).run(toRow(next));
  return next;
}
