import type {
  DetectedIntent,
  KnowledgeEntry,
  Provider,
  SensitiveCategory,
} from "../types";

/**
 * Provider-agnostic model layer (analysis/04 §6). Two logical roles behind one
 * interface: the grounded **answerer** (Sonnet 5 by default) and the async
 * **groundedness judge** (Haiku 4.5). Call sites never change when the provider
 * swaps (Gemini in M7).
 */

/** A single chat turn passed to the model. */
export interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * The model's structured decision (analysis/04 §4.2). This is the model's
 * *proposal* — the deterministic wrapper (guardrails/decide) disposes.
 */
export interface GroundedResult {
  intent: DetectedIntent;
  /** Is this about a specific child / account / incident (not general policy)? */
  is_case_specific: boolean;
  /** A detected sensitive category, or null. Canonical set — analysis/09 §4.1. */
  sensitive_category: SensitiveCategory | null;
  /** Model's self-assessed support from the cited policies, 0..1. */
  grounding_confidence: number;
  /** Policy ids the answer actually relies on. */
  citations: string[];
  /** The model's advisory decision. The wrapper makes the real call. */
  answer_intent: "answer" | "escalate";
  /** Warm text the parent sees — an answer, or a holding/relay message. */
  parent_message: string;
}

/** Groundedness judge output (analysis/04 §7, RAG triad — analysis/05 §3). */
export interface JudgeResult {
  groundedness: number;
  answer_relevancy: number;
}

export interface GroundedAnswerInput {
  /** The prompt-cached system prefix (persona + center + published policies). */
  system: string;
  /** The conversation so far (the latest parent turn is last). */
  messages: Msg[];
}

export interface JudgeInput {
  question: string;
  answer: string;
  citedPolicies: KnowledgeEntry[];
}

/** The seam. Implemented by ClaudeFrontDeskModel (default) and Gemini (M7). */
export interface FrontDeskModel {
  readonly provider: Provider;
  /** Model id used for the answerer role (logged to the audit for A/B). */
  readonly answererModel: string;
  groundedAnswer(input: GroundedAnswerInput): Promise<GroundedResult>;
  judgeGroundedness(input: JudgeInput): Promise<JudgeResult>;
}
