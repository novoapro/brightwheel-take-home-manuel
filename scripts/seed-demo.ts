/**
 * `npm run db:seed:demo` — the fully-populated demo: the sample Little Acorns
 * center + its knowledge base + a realistic week of history so the operator
 * dashboard renders live. Idempotent: safe to re-run.
 *
 * This uses the test/demo fixture (src/lib/seed/data.ts) and is meant for the
 * hosted proof-of-concept and local exploration — NOT the default production
 * seed (see scripts/seed.ts, which ships no knowledge entries).
 */
import { getDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";
import { seedHistory } from "../src/lib/seed/history";

const db = getDb();
const result = seedDatabase(db);
const history = seedHistory(db);

console.log(
  `✓ Seeded demo center "${result.center}", ${result.entries} knowledge entries, ` +
    `${history.audits} historical interactions, ${history.escalations} escalations, ` +
    `${history.capturedEntries} captured entry.`,
);
