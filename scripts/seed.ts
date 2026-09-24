/**
 * `npm run db:seed` — the minimal production seed: a placeholder center + the
 * default settings row, only if the database is empty. This is the same seed the
 * app applies automatically on first boot; running it explicitly is handy for
 * provisioning a volume ahead of time. It ships no knowledge entries — import
 * those as JSON through the admin Knowledge Base.
 *
 * For a fully-populated demo (sample center, policies, and a week of history so
 * the dashboard renders live), use `npm run db:seed:demo` instead.
 */
import { getDb } from "../src/lib/db";
import { getCenter } from "../src/lib/repo/center";
import { countEntries } from "../src/lib/repo/knowledge";

// Opening the connection applies the schema and seeds the minimal placeholder
// (center + default settings) if the DB is empty — so this is idempotent.
const db = getDb();
const center = getCenter(db);

console.log(
  `✓ Database initialized: center "${center?.id}", ${countEntries(db)} knowledge entries ` +
    `(import policies as JSON in the admin Knowledge Base; or run \`npm run db:seed:demo\` for the sample dataset).`,
);
