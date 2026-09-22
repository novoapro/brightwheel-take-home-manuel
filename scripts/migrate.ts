/**
 * `npm run db:migrate` — apply the schema to the configured database.
 * getDb() runs migrations on connect, so opening the connection is the migration.
 */
import { getDb } from "../src/lib/db";

const db = getDb();
const version = (
  db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
)?.value;

console.log(`✓ Schema applied (version ${version}) at ${process.env.DATABASE_PATH ?? "./data/app.db"}`);
