/**
 * `npm run db:seed` — seed Little Acorns policies + center + default settings.
 * Idempotent: safe to re-run.
 */
import { getDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";

const db = getDb();
const result = seedDatabase(db);

console.log(
  `✓ Seeded center "${result.center}" and ${result.policies} policies.`,
);
