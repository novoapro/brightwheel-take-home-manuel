import type { Database } from "better-sqlite3";
import type { Center } from "../types";
import { getCenter, upsertCenter } from "../repo/center";
import { getSettings } from "../repo/settings";

/**
 * Production bootstrap seed — the minimum a fresh install needs to boot cleanly:
 * a single (abstract, placeholder) center identity and the default settings row.
 *
 * It deliberately ships **no knowledge entries** — those are imported later from
 * a JSON file through the admin Knowledge Base (see the import route), so the
 * source of truth stays operator-owned. The center values here are generic
 * placeholders meant to be edited in the Branding tab (name, greeting, accent)
 * or by changing this file; nothing here is center-specific.
 *
 * This module imports only the center/settings repos — never the demo dataset —
 * so the app runtime that calls it on first boot stays lean.
 */
export const DEFAULT_CENTER: Center = {
  id: "center",
  name: "Your Center",
  city: "",
  state: "",
  phone: "",
  timezone: "America/Denver",
  hours_general: "Monday–Friday",
  age_groups: [
    { group: "Infant", range: "" },
    { group: "Toddler", range: "" },
    { group: "Preschool", range: "" },
    { group: "Pre-K", range: "" },
  ],
  persona_notes:
    "Warm, plain-spoken, and reassuring — a caring front-desk lead. Never a cold IVR or a scripted chatbot.",
  display_name: "",
  brand_color: "#6c4ee8",
  welcome_message: "",
};

/**
 * Seed the bootstrap data only when the database is empty (no center row yet).
 * Idempotent and cheap: a single existence check, then a no-op once a center is
 * present, so it's safe to call on every connection open. Returns whether it
 * actually seeded.
 */
export function seedIfEmpty(db: Database): boolean {
  if (getCenter(db)) return false;
  db.transaction(() => {
    upsertCenter(db, DEFAULT_CENTER);
    getSettings(db); // materialize the single settings row with defaults
  })();
  return true;
}
