import type { Database } from "better-sqlite3";
import type { Provider } from "../types";
import { PROVIDER_REGISTRY } from "../model/registry";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto";
import { getMasterKey } from "../keyring";

/**
 * Repository for per-provider credentials (analysis/11 §3.3/§3.6). Keys are
 * stored as ciphertext only; plaintext never touches the DB, the client, or logs.
 * Reads are write-only-safe: {@link maskedCredential} never returns the key, and
 * {@link resolveApiKey} decrypts in-process at call time only.
 */
export interface StoredCredential {
  provider: Provider;
  key_ciphertext: string | null;
  key_hint: string | null;
  answerer_model: string | null;
  judge_model: string | null;
  valid: number | null;
  last_checked: string | null;
}

/** What the admin GET returns — the plaintext key is NEVER included. */
export interface MaskedCredential {
  provider: Provider;
  configured: boolean;
  hint: string | null;
  answerer_model: string;
  judge_model: string;
  valid: boolean | null;
  last_checked: string | null;
}

export function getStoredCredential(
  db: Database,
  provider: Provider,
): StoredCredential | null {
  const row = db
    .prepare(`SELECT * FROM provider_credentials WHERE provider = ?`)
    .get(provider) as StoredCredential | undefined;
  return row ?? null;
}

/** Masked view for the API — models default from the registry when unset. */
export function maskedCredential(db: Database, provider: Provider): MaskedCredential {
  const row = getStoredCredential(db, provider);
  const reg = PROVIDER_REGISTRY[provider];
  return {
    provider,
    configured: Boolean(row?.key_ciphertext),
    hint: row?.key_hint ?? null,
    answerer_model: row?.answerer_model ?? reg.defaultAnswerer,
    judge_model: row?.judge_model ?? reg.defaultJudge,
    valid: row?.valid == null ? null : row.valid === 1,
    last_checked: row?.last_checked ?? null,
  };
}

/**
 * Upsert a provider's config. An `apiKey` of `undefined` means "leave the stored
 * key unchanged"; an explicit empty string clears it (the "Remove key" action).
 * Requires a master key to store a new key (fail-safe — §3.3).
 */
export function upsertCredential(
  db: Database,
  input: {
    provider: Provider;
    apiKey?: string; // undefined = unchanged; "" = remove
    answerer_model: string;
    judge_model: string;
  },
): void {
  const existing = getStoredCredential(db, input.provider);

  let cipher = existing?.key_ciphertext ?? null;
  let hint = existing?.key_hint ?? null;
  let resetValidity = false;

  if (input.apiKey !== undefined) {
    if (input.apiKey === "") {
      cipher = null;
      hint = null;
    } else {
      cipher = encryptSecret(input.apiKey, getMasterKey(db));
      hint = maskSecret(input.apiKey);
    }
    resetValidity = true; // a changed/removed key must be re-validated
  }

  db.prepare(
    `INSERT INTO provider_credentials
       (provider, key_ciphertext, key_hint, answerer_model, judge_model, valid, last_checked)
     VALUES (@provider, @key_ciphertext, @key_hint, @answerer_model, @judge_model, @valid, @last_checked)
     ON CONFLICT(provider) DO UPDATE SET
       key_ciphertext = excluded.key_ciphertext,
       key_hint       = excluded.key_hint,
       answerer_model = excluded.answerer_model,
       judge_model    = excluded.judge_model,
       valid          = CASE WHEN @reset_validity = 1 THEN NULL ELSE provider_credentials.valid END,
       last_checked   = CASE WHEN @reset_validity = 1 THEN NULL ELSE provider_credentials.last_checked END`,
  ).run({
    provider: input.provider,
    key_ciphertext: cipher,
    key_hint: hint,
    answerer_model: input.answerer_model,
    judge_model: input.judge_model,
    valid: null,
    last_checked: null,
    reset_validity: resetValidity ? 1 : 0,
  });
}

/** Record the liveness-check result after storing a key (§3.3 point 3). */
export function setCredentialValidity(
  db: Database,
  provider: Provider,
  valid: boolean,
): void {
  db.prepare(
    `UPDATE provider_credentials
        SET valid = @valid, last_checked = @last_checked
      WHERE provider = @provider`,
  ).run({
    provider,
    valid: valid ? 1 : 0,
    last_checked: new Date().toISOString(),
  });
}

/**
 * Decrypt a provider's stored key for in-process use at call time (§3.3 point 4).
 * Returns null when nothing is stored or the master key is unavailable — callers
 * then fall back to the env key.
 */
export function resolveApiKey(db: Database, provider: Provider): string | null {
  const row = getStoredCredential(db, provider);
  if (!row?.key_ciphertext) return null;
  try {
    return decryptSecret(row.key_ciphertext, getMasterKey(db));
  } catch {
    return null; // tampered / rotated master key → fall back to env
  }
}

/**
 * Enforce "exactly one provider configured at a time" (analysis/11 §3.1): when
 * the admin switches provider and saves, drop every other provider's stored key
 * and model so no stale credentials linger.
 */
export function clearCredentialsExcept(db: Database, keep: Provider): void {
  db.prepare(`DELETE FROM provider_credentials WHERE provider != ?`).run(keep);
}
