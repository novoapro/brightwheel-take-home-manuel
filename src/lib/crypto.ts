import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Secret encryption for provider API keys (analysis/11 §3.3). AES-256-GCM via
 * Node's built-in crypto — no new dependency. Plaintext lives only in memory at
 * call time; the DB stores `base64(iv‖authTag‖ciphertext)`. GCM's auth tag
 * detects tampering (decrypt throws on any modification).
 *
 * The 32-byte master key is resolved by the caller (see `keyring.ts`) and passed
 * in — this module is pure crypto with no key-source knowledge.
 */
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

/** Encrypt a secret → `base64(iv‖authTag‖ciphertext)`. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a payload from {@link encryptSecret}. Throws on tamper or wrong key. */
export function decryptSecret(payload: string, key: Buffer): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** A safe display hint for a stored key — the last 4 chars only ("…7f3a"). */
export function maskSecret(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `…${tail}`;
}
