/**
 * `npm run db:seed` — seed Little Acorns policies + center + default settings,
 * then a realistic week of history so the operator dashboard renders live.
 * Idempotent: safe to re-run.
 */
import { getDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";
import { seedHistory } from "../src/lib/seed/history";

const db = getDb();
const result = seedDatabase(db);
const history = seedHistory(db);

console.log(
  `✓ Seeded center "${result.center}", ${result.policies} policies, ` +
    `${history.audits} historical interactions, ${history.escalations} escalations, ` +
    `${history.capturedPolicies} captured policy.`,
);
