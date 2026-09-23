import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";

/**
 * Resolves the 32-byte master key used to encrypt provider API keys at rest
 * (analysis/11 §3.3). Two sources, in order:
 *
 *   1. env `SECRETS_ENCRYPTION_KEY` (base64) — the recommended production
 *      source: the key lives outside the DB, so a leaked DB file can't be
 *      decrypted on its own.
 *   2. a per-install key auto-generated and persisted in `meta` on first use —
 *      so the UI works out of the box with zero env setup (the PoC default).
 *      Rotating to an env key later just means re-entering provider keys.
 *
 * Because of (2), key configuration is always available — no "disabled" state.
 */
const META_MASTER_KEY = "secrets_master_key";

export function getMasterKey(db: Database): Buffer {
  const env = process.env.SECRETS_ENCRYPTION_KEY?.trim();
  if (env) {
    const key = Buffer.from(env, "base64");
    if (key.length !== 32) {
      throw new Error("SECRETS_ENCRYPTION_KEY must decode to 32 bytes (base64).");
    }
    return key;
  }

  const existing = db
    .prepare(`SELECT value FROM meta WHERE key = ?`)
    .get(META_MASTER_KEY) as { value: string } | undefined;
  if (existing) return Buffer.from(existing.value, "base64");

  const generated = randomBytes(32).toString("base64");
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
  ).run(META_MASTER_KEY, generated);
  // Re-read to win any race — the first writer's value is authoritative.
  const row = db
    .prepare(`SELECT value FROM meta WHERE key = ?`)
    .get(META_MASTER_KEY) as { value: string };
  return Buffer.from(row.value, "base64");
}

/** Whether a master key is available (always true — see (2) above). */
export function secretsAvailable(): boolean {
  return true;
}
