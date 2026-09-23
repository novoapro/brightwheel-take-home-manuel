import type { GroundedResult, JudgeInput, JudgeResult } from "../model/types";
import type {
  CautionLevel,
  DetectedIntent,
  KnowledgeEntry,
  SensitiveCategory,
} from "../types";
import { HARD_SENSITIVE, SENSITIVE_INTENTS } from "../types";
import { verifyFacts, type Fact } from "./facts";
import { groundednessFloor, tau } from "./thresholds";

/**
 * The deterministic wrapper (analysis/04 §3, analysis/07 §4): the model
 * proposes, code disposes — before the parent sees anything. Every check runs
 * inline; ANY failure routes to the live staff relay (the same warm holding
 * path an unknown question takes). A wrong number can never reach a parent.
 */

export type Decision = "answered" | "relayed";

/** Canonical decision_reason set — analysis/09 §4.4. */
export type DecisionReason =
  | "grounded"
  | "social"
  | "no_citation"
  | "invalid_citation"
  | "fact_mismatch"
  | "below_threshold"
  | "low_groundedness"
  | "out_of_scope"
  | "sensitive:case_specific"
  | `sensitive:${SensitiveCategory}`;

export type CheckState = "pass" | "fail" | "skipped";

export interface FinalDecision {
  decision: Decision;
  reason: DecisionReason;
  /** What the parent sees — the grounded answer, or a warm relay holding message. */
  parent_message: string;
  citations: string[];
  intent: DetectedIntent;
  sensitive_category: SensitiveCategory | null;
  is_case_specific: boolean;
  grounding_confidence: number;
  /** Inline guardrail results, for the audit + debug surface (analysis/05 §2). */
  checks: {
    citation_valid: CheckState;
    fact_match: CheckState;
    groundedness_gate: CheckState;
  };
  /** Set only when the groundedness gate (3e) actually ran. */
  groundedness?: number;
  /** Facts that failed verification (when reason === "fact_mismatch"). */
  unsupported_facts?: Fact[];
}

export interface DecideContext {
  /** The parent's question — passed to the groundedness judge (3e). */
  question: string;
  /** All published policies — used for citation validity + fact sourcing. */
  publishedPolicies: KnowledgeEntry[];
  caution: CautionLevel;
  /** The groundedness judge (Haiku). Injected so the wrapper is testable. */
  judge: (input: JudgeInput) => Promise<JudgeResult>;
  /** Builds the warm holding message shown on relay. */
  relayMessage: (category: SensitiveCategory | null) => string;
}

const CHECKS_INIT = {
  citation_valid: "skipped" as CheckState,
  fact_match: "skipped" as CheckState,
  groundedness_gate: "skipped" as CheckState,
};

/**
 * Apply the guardrail stack to a model proposal. Returns the final, safe
 * decision. See analysis/04 §3 for the check order; the case-specific rule is
 * broadened per analysis/09 §4.2 (any detected sensitive category that is
 * case-specific escalates, not only the health intent).
 */
export async function decide(
  model: GroundedResult,
  ctx: DecideContext,
): Promise<FinalDecision> {
  const intent = model.intent;
  const sensitiveIntent = (SENSITIVE_INTENTS as readonly string[]).includes(
    intent,
  );
  const checks = { ...CHECKS_INIT };

  const relay = (
    reason: DecisionReason,
    extra: Partial<FinalDecision> = {},
  ): FinalDecision => ({
    decision: "relayed",
    reason,
    parent_message: ctx.relayMessage(model.sensitive_category),
    citations: model.citations,
    intent,
    sensitive_category: model.sensitive_category,
    is_case_specific: model.is_case_specific,
    grounding_confidence: model.grounding_confidence,
    checks,
    ...extra,
  });

  // Greetings & small talk (analysis/04 §3.1): a pure pleasantry has no handbook
  // entry, so the citation gate would relay "hello" to staff — a cold, wasteful
  // hand-off. Instead we let the model answer warmly WITHOUT a citation, but keep
  // it airtight: a social reply must carry no citations and no checkable facts,
  // and any sensitive/case-specific signal still escalates first. The model can't
  // smuggle an ungrounded policy answer ("we open at 7:00") under this label —
  // the fact-check blocks it and it relays like any other unsupported claim.
  if (intent === "social") {
    if (
      model.sensitive_category &&
      (HARD_SENSITIVE as readonly string[]).includes(model.sensitive_category)
    ) {
      return relay(`sensitive:${model.sensitive_category}`);
    }
    if (
      model.is_case_specific &&
      (model.sensitive_category !== null || sensitiveIntent)
    ) {
      return relay("sensitive:case_specific");
    }
    // A genuine pleasantry cites nothing; a citation means it's not small talk.
    if (model.citations.length > 0) return relay("out_of_scope");
    const socialFacts = verifyFacts(model.parent_message, []);
    if (!socialFacts.ok) {
      checks.fact_match = "fail";
      return relay("fact_mismatch", { unsupported_facts: socialFacts.unsupported });
    }
    checks.fact_match = "pass";
    return {
      decision: "answered",
      reason: "social",
      parent_message: model.parent_message,
      citations: [],
      intent,
      sensitive_category: model.sensitive_category,
      is_case_specific: model.is_case_specific,
      grounding_confidence: model.grounding_confidence,
      checks,
    };
  }

  // Out-of-scope: nothing in the handbook covers it → relay (analysis/09 §4.4).
  if (intent === "out_of_scope") return relay("out_of_scope");

  // 3a — hard routes (independent of model confidence)
  if (
    model.sensitive_category &&
    (HARD_SENSITIVE as readonly string[]).includes(model.sensitive_category)
  ) {
    return relay(`sensitive:${model.sensitive_category}`);
  }
  // policy = answer, case = escalate: any sensitivity signal + case-specific.
  if (
    model.is_case_specific &&
    (model.sensitive_category !== null || sensitiveIntent)
  ) {
    return relay("sensitive:case_specific");
  }

  // 3b — citation validity (fast, code)
  if (model.citations.length === 0) {
    checks.citation_valid = "fail";
    return relay("no_citation");
  }
  const publishedIds = new Set(ctx.publishedPolicies.map((p) => p.id));
  if (!model.citations.every((id) => publishedIds.has(id))) {
    checks.citation_valid = "fail";
    return relay("invalid_citation");
  }
  checks.citation_valid = "pass";

  // 3c — deterministic fact verification (fast, code) — the differentiator
  const citedPolicies = ctx.publishedPolicies.filter((p) =>
    model.citations.includes(p.id),
  );
  const factCheck = verifyFacts(model.parent_message, citedPolicies);
  if (!factCheck.ok) {
    checks.fact_match = "fail";
    return relay("fact_mismatch", { unsupported_facts: factCheck.unsupported });
  }
  checks.fact_match = "pass";

  // 3d — self-reported confidence gate
  const t = tau(ctx.caution, sensitiveIntent);
  if (model.grounding_confidence < t) {
    return relay("below_threshold");
  }

  // 3e — inline groundedness gate (Haiku judge): always for sensitive, plus the
  // borderline band. Non-sensitive well-grounded relies on 3c + the async judge.
  if (sensitiveIntent || model.grounding_confidence < t + 0.1) {
    const { groundedness } = await ctx.judge({
      question: ctx.question,
      answer: model.parent_message,
      citedPolicies,
    });
    if (groundedness < groundednessFloor(sensitiveIntent)) {
      checks.groundedness_gate = "fail";
      return relay("low_groundedness", { groundedness });
    }
    checks.groundedness_gate = "pass";
    return answer(groundedness);
  }

  return answer();

  function answer(groundedness?: number): FinalDecision {
    return {
      decision: "answered",
      reason: "grounded",
      parent_message: model.parent_message,
      citations: model.citations,
      intent,
      sensitive_category: model.sensitive_category,
      is_case_specific: model.is_case_specific,
      grounding_confidence: model.grounding_confidence,
      checks,
      ...(groundedness !== undefined ? { groundedness } : {}),
    };
  }
}
