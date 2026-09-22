import type { Database } from "better-sqlite3";
import type { Center } from "../types";

/**
 * Repository for the single-row Center identity (analysis/01 §2.1).
 * age_groups is JSON-shaped and (de)serialized here.
 */

type CenterRow = Omit<Center, "age_groups"> & { age_groups: string };

function rowToCenter(row: CenterRow): Center {
  return {
    ...row,
    age_groups: JSON.parse(row.age_groups) as Center["age_groups"],
  };
}

export function upsertCenter(db: Database, center: Center): Center {
  db.prepare(
    `INSERT INTO center
       (id, name, city, state, phone, timezone, hours_general, age_groups, persona_notes)
     VALUES
       (@id, @name, @city, @state, @phone, @timezone, @hours_general, @age_groups, @persona_notes)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       city = excluded.city,
       state = excluded.state,
       phone = excluded.phone,
       timezone = excluded.timezone,
       hours_general = excluded.hours_general,
       age_groups = excluded.age_groups,
       persona_notes = excluded.persona_notes`,
  ).run({ ...center, age_groups: JSON.stringify(center.age_groups) });
  return getCenter(db)!;
}

/** The center is single-instance; returns the first (only) row. */
export function getCenter(db: Database): Center | null {
  const row = db.prepare(`SELECT * FROM center LIMIT 1`).get() as
    | CenterRow
    | undefined;
  return row ? rowToCenter(row) : null;
}
