import type { Database } from "better-sqlite3";
import type { Center } from "../types";

/**
 * Repository for the single-row Center identity + brand layer (analysis/01 §2.1,
 * analysis/10 §4). age_groups is JSON-shaped and (de)serialized here; the
 * optional brand fields (logo, welcome_message) round-trip as null when unset.
 */

type CenterRow = Omit<Center, "age_groups" | "logo" | "welcome_message"> & {
  age_groups: string;
  logo: string | null;
  welcome_message: string | null;
};

function rowToCenter(row: CenterRow): Center {
  return {
    ...row,
    age_groups: JSON.parse(row.age_groups) as Center["age_groups"],
    logo: row.logo ?? undefined,
    welcome_message: row.welcome_message ?? undefined,
  };
}

export function upsertCenter(db: Database, center: Center): Center {
  db.prepare(
    `INSERT INTO center
       (id, name, city, state, phone, timezone, hours_general, age_groups, persona_notes,
        display_name, brand_color, logo, welcome_message)
     VALUES
       (@id, @name, @city, @state, @phone, @timezone, @hours_general, @age_groups, @persona_notes,
        @display_name, @brand_color, @logo, @welcome_message)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       city = excluded.city,
       state = excluded.state,
       phone = excluded.phone,
       timezone = excluded.timezone,
       hours_general = excluded.hours_general,
       age_groups = excluded.age_groups,
       persona_notes = excluded.persona_notes,
       display_name = excluded.display_name,
       brand_color = excluded.brand_color,
       logo = excluded.logo,
       welcome_message = excluded.welcome_message`,
  ).run({
    ...center,
    age_groups: JSON.stringify(center.age_groups),
    logo: center.logo ?? null,
    welcome_message: center.welcome_message ?? null,
  });
  return getCenter(db)!;
}

/** The center is single-instance; returns the first (only) row. */
export function getCenter(db: Database): Center | null {
  const row = db.prepare(`SELECT * FROM center LIMIT 1`).get() as
    | CenterRow
    | undefined;
  return row ? rowToCenter(row) : null;
}
