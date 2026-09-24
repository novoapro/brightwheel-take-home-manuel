import type { Database } from "better-sqlite3";
import { upsertCenter } from "../repo/center";
import { upsertEntry } from "../repo/knowledge";
import { getSettings } from "../repo/settings";
import { CENTER, ENTRIES } from "./data";

export interface SeedResult {
  center: string;
  entries: number;
}

/**
 * Seed the full demo dataset — the Little Acorns center, its policy set, and the
 * default settings row. This is a **test/eval fixture**, not the production
 * seed: it's imported only by the unit tests, the golden eval, and the optional
 * demo script (`npm run db:seed:demo`), never by the app runtime. Production
 * boots on the minimal placeholder seed in ./bootstrap.ts instead, and real
 * policies are imported as JSON through the admin Knowledge Base.
 *
 * Idempotent — re-running upserts by primary key rather than duplicating.
 */
export function seedDatabase(db: Database): SeedResult {
  const run = db.transaction(() => {
    upsertCenter(db, CENTER);
    for (const policy of ENTRIES) {
      upsertEntry(db, policy);
    }
    // Ensure the single settings row exists with defaults.
    getSettings(db);
  });
  run();

  return { center: CENTER.id, entries: ENTRIES.length };
}
