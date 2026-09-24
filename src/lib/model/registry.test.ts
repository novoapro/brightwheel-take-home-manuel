import { describe, expect, it } from "vitest";
import {
  isValidAnswerer,
  PROVIDER_REGISTRY,
  resolveEnvAnswerer,
  resolveEnvProvider,
} from "./registry";

describe("resolveEnvProvider", () => {
  it("accepts the known providers (case/space-insensitive)", () => {
    expect(resolveEnvProvider("anthropic")).toBe("anthropic");
    expect(resolveEnvProvider("OpenAI")).toBe("openai");
    expect(resolveEnvProvider("  google ")).toBe("google");
  });

  it("returns undefined for unset/unknown values (caller defaults)", () => {
    expect(resolveEnvProvider(undefined)).toBeUndefined();
    expect(resolveEnvProvider("")).toBeUndefined();
    expect(resolveEnvProvider("mistral")).toBeUndefined();
  });
});

describe("resolveEnvAnswerer", () => {
  it("accepts a model valid for the active provider", () => {
    expect(resolveEnvAnswerer("anthropic", "claude-opus-5")).toBe("claude-opus-5");
    expect(resolveEnvAnswerer("openai", "gpt-5-mini")).toBe("gpt-5-mini");
  });

  it("ignores a model that belongs to a different provider", () => {
    // gpt-5 is not an Anthropic answerer → not passed through
    expect(resolveEnvAnswerer("anthropic", "gpt-5")).toBeUndefined();
    expect(resolveEnvAnswerer("google", "claude-sonnet-5")).toBeUndefined();
  });

  it("returns undefined when unset or unknown", () => {
    expect(resolveEnvAnswerer("anthropic", undefined)).toBeUndefined();
    expect(resolveEnvAnswerer("anthropic", "not-a-model")).toBeUndefined();
  });

  it("every registry default answerer is itself a valid answerer", () => {
    for (const p of ["anthropic", "openai", "google"] as const) {
      expect(isValidAnswerer(p, PROVIDER_REGISTRY[p].defaultAnswerer)).toBe(true);
    }
  });
});
