import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import {
  clearCredentialsExcept,
  getStoredCredential,
  maskedCredential,
  resolveApiKey,
  setCredentialValidity,
  upsertCredential,
} from "./credentials";

// No env key needed — the master key auto-provisions per install (keyring.ts).
let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

describe("credentials repo (analysis/11 §3.3/§3.6)", () => {
  it("stores a key as ciphertext, never plaintext; masked read hides it", () => {
    upsertCredential(db, {
      provider: "openai",
      apiKey: "sk-openai-secret-9xyz",
      answerer_model: "gpt-5",
      judge_model: "gpt-5-mini",
    });
    const row = getStoredCredential(db, "openai")!;
    expect(row.key_ciphertext).toBeTruthy();
    expect(row.key_ciphertext).not.toContain("sk-openai-secret");

    const masked = maskedCredential(db, "openai");
    expect(masked.configured).toBe(true);
    expect(masked.hint).toBe("…9xyz");
    expect(JSON.stringify(masked)).not.toContain("secret");
  });

  it("decrypts the key only via resolveApiKey (in-process)", () => {
    upsertCredential(db, {
      provider: "anthropic",
      apiKey: "sk-ant-abc123",
      answerer_model: "claude-sonnet-5",
      judge_model: "claude-haiku-4-5",
    });
    expect(resolveApiKey(db, "anthropic")).toBe("sk-ant-abc123");
  });

  it("treats an undefined apiKey as 'leave unchanged'", () => {
    upsertCredential(db, {
      provider: "anthropic",
      apiKey: "sk-keepme",
      answerer_model: "claude-sonnet-5",
      judge_model: "claude-haiku-4-5",
    });
    upsertCredential(db, {
      provider: "anthropic",
      answerer_model: "claude-opus-5", // model change only
      judge_model: "claude-haiku-4-5",
    });
    expect(resolveApiKey(db, "anthropic")).toBe("sk-keepme");
    expect(maskedCredential(db, "anthropic").answerer_model).toBe("claude-opus-5");
  });

  it("clears the key on empty string (Remove key)", () => {
    upsertCredential(db, {
      provider: "google",
      apiKey: "g-key",
      answerer_model: "gemini-flash-latest",
      judge_model: "gemini-flash-lite-latest",
    });
    upsertCredential(db, {
      provider: "google",
      apiKey: "",
      answerer_model: "gemini-flash-latest",
      judge_model: "gemini-flash-lite-latest",
    });
    expect(maskedCredential(db, "google").configured).toBe(false);
    expect(resolveApiKey(db, "google")).toBeNull();
  });

  it("resets validity when the key changes, and records liveness results", () => {
    upsertCredential(db, {
      provider: "openai",
      apiKey: "sk-1",
      answerer_model: "gpt-5",
      judge_model: "gpt-5-mini",
    });
    setCredentialValidity(db, "openai", true);
    expect(maskedCredential(db, "openai").valid).toBe(true);

    upsertCredential(db, {
      provider: "openai",
      apiKey: "sk-2",
      answerer_model: "gpt-5",
      judge_model: "gpt-5-mini",
    });
    expect(maskedCredential(db, "openai").valid).toBeNull(); // must re-check
  });

  it("defaults models from the registry when unset", () => {
    const masked = maskedCredential(db, "anthropic");
    expect(masked.configured).toBe(false);
    expect(masked.answerer_model).toBe("claude-sonnet-5");
    expect(masked.judge_model).toBe("claude-haiku-4-5");
  });

  it("clears every other provider's config on switch (one active at a time)", () => {
    upsertCredential(db, {
      provider: "anthropic",
      apiKey: "sk-ant",
      answerer_model: "claude-sonnet-5",
      judge_model: "claude-haiku-4-5",
    });
    upsertCredential(db, {
      provider: "openai",
      apiKey: "sk-oai",
      answerer_model: "gpt-5",
      judge_model: "gpt-5-mini",
    });

    clearCredentialsExcept(db, "openai");

    expect(getStoredCredential(db, "openai")).not.toBeNull();
    expect(getStoredCredential(db, "anthropic")).toBeNull();
    expect(maskedCredential(db, "anthropic").configured).toBe(false);
  });
});
