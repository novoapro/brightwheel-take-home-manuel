import type { DecisionReason } from "../guardrails/decide";
import type { Intent, PolicyInput } from "../types";

/**
 * Capture is context-aware (analysis/03 §4.2): a general knowledge gap should
 * become a citable policy so the front desk answers it next time, but a
 * case-specific/sensitive reply (a fever answer for one child) must never
 * become an auto-answer. Only true out-of-scope gaps default the toggle ON.
 */
export function captureDefaultFor(reason: DecisionReason | string): boolean {
  return reason === "out_of_scope";
}

const SHORT_WORDS = new Set([
  "the", "and", "for", "you", "your", "our", "are", "can", "does", "with",
  "what", "when", "how", "why", "who", "this", "that", "have", "has",
]);

/** Derive up to 8 keyword terms from the parent's question. */
export function keywordsFromQuestion(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !SHORT_WORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

/** Build a captured PolicyRecord from a staff answer to a knowledge-gap question. */
export function buildCapturedPolicy(input: {
  intent: Intent;
  question: string;
  answer: string;
  title?: string;
  answeredBy: string;
  idSuffix: string;
}): PolicyInput {
  const title =
    input.title?.trim() ||
    (input.question.length > 60
      ? `${input.question.slice(0, 57)}…`
      : input.question);
  return {
    id: `captured.${input.intent}.${input.idSuffix}`,
    intent: input.intent,
    title,
    body_md: input.answer,
    structured: {},
    keywords: keywordsFromQuestion(input.question),
    sensitivity: "none",
    status: "published",
    origin: "captured",
    source: "Added from a family question",
    updated_by: input.answeredBy,
  };
}
