import type { Database } from "better-sqlite3";
import { DEFAULT_CACHE_TTL, type AuditMode, type Settings } from "../types";

/**
 * Repository for the single-row Settings (analysis/01 §2.6).
 *
 * The row is lazily created with defaults on first read, so callers never have
 * to worry about whether it exists. Category sensitivity is intentionally NOT
 * here — it's a per-category tier on the `categories` table, owned in the
 * Knowledge Base (analysis/09 §4.3), not a global setting.
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
  judge_enabled: true,
  cache_ttl: DEFAULT_CACHE_TTL,
};

/** SQLite stores booleans as 0/1; the DB row shape before coercion. */
type SettingsRow = Omit<Settings, "developer_mode" | "judge_enabled"> & {
  developer_mode: number;
  judge_enabled: number;
};

/** Bind params for the settings row (booleans as integers). */
function toRow(s: Settings) {
  return {
    ...s,
    developer_mode: s.developer_mode ? 1 : 0,
    judge_enabled: s.judge_enabled ? 1 : 0,
  };
}

/** The effective audit mode — "off" whenever developer mode is disabled. */
export function effectiveAuditMode(s: Settings): AuditMode {
  return s.developer_mode ? s.audit_mode : "off";
}

/** Read settings, creating the single row with defaults if absent. */
export function getSettings(db: Database): Settings {
  const row = db
    .prepare(
      `SELECT caution_level, active_provider, availability, operator_name, away_message, offline_at, developer_mode, audit_mode, judge_enabled, cache_ttl
         FROM settings WHERE id = 1`,
    )
    .get() as SettingsRow | undefined;
  if (row) {
    return { ...row, developer_mode: !!row.developer_mode, judge_enabled: !!row.judge_enabled };
  }

  db.prepare(
    `INSERT INTO settings (id, caution_level, active_provider, availability, operator_name, away_message, offline_at, developer_mode, audit_mode, judge_enabled, cache_ttl)
     VALUES (1, @caution_level, @active_provider, @availability, @operator_name, @away_message, @offline_at, @developer_mode, @audit_mode, @judge_enabled, @cache_ttl)`,
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
            audit_mode = @audit_mode,
            judge_enabled = @judge_enabled,
            cache_ttl = @cache_ttl
      WHERE id = 1`,
  ).run(toRow(next));
  return next;
}
