import type { Database } from "better-sqlite3";
import { upsertCenter } from "../repo/center";
import { upsertPolicy } from "../repo/policies";
import { getSettings } from "../repo/settings";
import { CENTER, POLICIES } from "./data";

export interface SeedResult {
  center: string;
  policies: number;
}

/**
 * Seed the source of truth: the Little Acorns center, its policy set, and the
 * default settings row. Idempotent — re-running upserts by primary key rather
 * than duplicating, so `npm run db:seed` is safe to run repeatedly.
 *
 * Historical interactions / escalations (for the operator dashboard) are seeded
 * later, in M5 — this is the policy source of truth only (M1).
 */
export function seedDatabase(db: Database): SeedResult {
  const run = db.transaction(() => {
    upsertCenter(db, CENTER);
    for (const policy of POLICIES) {
      upsertPolicy(db, policy);
    }
    // Ensure the single settings row exists with defaults.
    getSettings(db);
  });
  run();

  return { center: CENTER.id, policies: POLICIES.length };
}
