import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto";

const KEY = randomBytes(32);

describe("crypto — provider-key encryption (analysis/11 §3.3)", () => {
  it("round-trips a secret", () => {
    const secret = "sk-ant-super-secret-key-7f3a";
    const enc = encryptSecret(secret, KEY);
    expect(enc).not.toContain(secret); // ciphertext, not plaintext
    expect(decryptSecret(enc, KEY)).toBe(secret);
  });

  it("produces a fresh IV each time (ciphertext differs, plaintext same)", () => {
    const a = encryptSecret("same-secret", KEY);
    const b = encryptSecret("same-secret", KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it("detects tampering via the GCM auth tag", () => {
    const enc = encryptSecret("tamper-me", KEY);
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptSecret(raw.toString("base64"), KEY)).toThrow();
  });

  it("fails to decrypt with the wrong key", () => {
    const enc = encryptSecret("secret", KEY);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
  });

  it("masks to the last 4 characters", () => {
    expect(maskSecret("sk-ant-abcd1234")).toBe("…1234");
  });
});
