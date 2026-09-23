/**
 * `npm run db:seed` — seed the Little Acorns knowledge base + center + default settings,
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
  `✓ Seeded center "${result.center}", ${result.entries} knowledge entries, ` +
    `${history.audits} historical interactions, ${history.escalations} escalations, ` +
    `${history.capturedEntries} captured entry.`,
);
