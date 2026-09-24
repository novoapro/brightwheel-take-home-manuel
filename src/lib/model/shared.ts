import { z } from "zod";
import { SENSITIVE_CATEGORIES } from "../types";
import type { JudgeInput } from "./types";

/**
 * Pieces of the §4.2 contract shared verbatim across adapters, so a new provider
 * copies less and the answerer/judge contract stays defined in one place.
 *
 * The Zod schemas + judge system prompt are shared by the adapters that speak
 * Zod (Claude, OpenAI). Gemini hand-writes an equivalent JSON schema and its own
 * (deliberately reworded) judge instruction, but still shares the source/user
 * formatting below — keep these byte-stable, they shape prompt-cached input.
 */

/** Structured answerer output (analysis/04 §4.2). */
export const GroundedResultSchema = z.object({
  // Open-ended topic label: any lowercase category the operator has in the KB
  // (`type Intent = string`), plus the two control values the wrapper routes on —
  // `social` (greeting lane) and `out_of_scope` (relay). Kept a free string so an
  // operator-added category isn't forced into a fixed enum. decide() special-cases
  // `social`/`out_of_scope`, and otherwise uses this field to look up the category's
  // operator-set sensitivity (the `categories` table) — alongside the independent,
  // model-detected `sensitive_category` signal.
  intent: z.string(),
  is_case_specific: z.boolean(),
  sensitive_category: z.enum(SENSITIVE_CATEGORIES).nullable(),
  grounding_confidence: z.number().min(0).max(1),
  citations: z.array(z.string()),
  answer_intent: z.enum(["answer", "escalate"]),
  parent_message: z.string(),
});

/** Groundedness judge output (analysis/04 §7). */
export const JudgeSchema = z.object({
  groundedness: z.number().min(0).max(1),
  answer_relevancy: z.number().min(0).max(1),
});

/** The judge's grading instruction (Claude/OpenAI wording). */
export const JUDGE_SYSTEM_PROMPT =
  "You grade whether an assistant's answer is fully supported by the provided policy sources. " +
  "groundedness = the fraction of the answer's factual claims that are directly supported by the SOURCES (0..1); " +
  "an answer that states any fact not in the sources scores low. " +
  "answer_relevancy = how well the answer addresses the QUESTION (0..1).";

/** Render cited policies as the judge's SOURCES block. */
export function formatJudgeSources(citedPolicies: JudgeInput["citedPolicies"]): string {
  return citedPolicies
    .map((p) => `[${p.id}] ${p.title}\n${p.body_md}\ndata: ${JSON.stringify(p.structured)}`)
    .join("\n\n");
}

/** The judge's user turn — the question, the answer, and the sources block. */
export function formatJudgeUser(question: string, answer: string, sources: string): string {
  return `QUESTION:\n${question}\n\nANSWER:\n${answer}\n\nSOURCES:\n${sources}`;
}
