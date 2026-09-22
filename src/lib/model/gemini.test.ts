import { describe, it, expect } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { GeminiFrontDeskModel } from "./gemini";
import { ClaudeFrontDeskModel } from "./claude";
import { getModel } from "./index";

/** A fake GoogleGenAI whose generateContent returns canned JSON text. */
function fakeAi(text: string, capture?: (args: unknown) => void): GoogleGenAI {
  return {
    models: {
      generateContent: async (args: unknown) => {
        capture?.(args);
        return { text };
      },
    },
  } as unknown as GoogleGenAI;
}

describe("getModel factory", () => {
  it("returns the right implementation per provider", () => {
    expect(getModel("gemini")).toBeInstanceOf(GeminiFrontDeskModel);
    expect(getModel("claude")).toBeInstanceOf(ClaudeFrontDeskModel);
    expect(getModel()).toBeInstanceOf(ClaudeFrontDeskModel);
  });
});

describe("GeminiFrontDeskModel adapter", () => {
  it("maps structured output to a GroundedResult, sentinel 'none' → null", async () => {
    const json = JSON.stringify({
      intent: "hours",
      is_case_specific: false,
      sensitive_category: "none",
      grounding_confidence: 0.92,
      citations: ["hours.regular"],
      answer_intent: "answer",
      parent_message: "We're open 7 to 6.",
    });
    const model = new GeminiFrontDeskModel(fakeAi(json));
    const r = await model.groundedAnswer({ system: "sys", messages: [{ role: "user", content: "hours?" }] });
    expect(r.sensitive_category).toBeNull();
    expect(r.intent).toBe("hours");
    expect(r.grounding_confidence).toBe(0.92);
    expect(r.citations).toEqual(["hours.regular"]);
    expect(model.provider).toBe("gemini");
  });

  it("preserves a real sensitive category", async () => {
    const json = JSON.stringify({
      intent: "health", is_case_specific: true, sensitive_category: "health",
      grounding_confidence: 0.9, citations: [], answer_intent: "escalate", parent_message: "Checking with our team.",
    });
    const r = await new GeminiFrontDeskModel(fakeAi(json)).groundedAnswer({ system: "s", messages: [] });
    expect(r.sensitive_category).toBe("health");
    expect(r.answer_intent).toBe("escalate");
  });

  it("sends system instruction + JSON mime config and maps chat roles", async () => {
    let sent: { config?: { responseMimeType?: string; systemInstruction?: string }; contents?: unknown } = {};
    const json = JSON.stringify({
      intent: "hours", is_case_specific: false, sensitive_category: "none",
      grounding_confidence: 1, citations: ["hours.regular"], answer_intent: "answer", parent_message: "ok",
    });
    const model = new GeminiFrontDeskModel(fakeAi(json, (a) => (sent = a as typeof sent)));
    await model.groundedAnswer({
      system: "SYSTEM PREFIX",
      messages: [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }],
    });
    expect(sent.config?.responseMimeType).toBe("application/json");
    expect(sent.config?.systemInstruction).toBe("SYSTEM PREFIX");
    expect(sent.contents).toEqual([
      { role: "user", parts: [{ text: "q1" }] },
      { role: "model", parts: [{ text: "a1" }] }, // assistant → model
    ]);
  });

  it("throws on empty or non-JSON output", async () => {
    await expect(
      new GeminiFrontDeskModel(fakeAi("")).groundedAnswer({ system: "s", messages: [] }),
    ).rejects.toThrow(/empty/i);
    await expect(
      new GeminiFrontDeskModel(fakeAi("not json")).groundedAnswer({ system: "s", messages: [] }),
    ).rejects.toThrow(/non-JSON/i);
  });

  it("parses judge scores", async () => {
    const json = JSON.stringify({ groundedness: 0.88, answer_relevancy: 0.91 });
    const r = await new GeminiFrontDeskModel(fakeAi(json)).judgeGroundedness({
      question: "q", answer: "a", citedPolicies: [],
    });
    expect(r).toEqual({ groundedness: 0.88, answer_relevancy: 0.91 });
  });
});
