import type { GroundedResult, JudgeInput, JudgeResult } from "../model/types";
import type {
  CautionLevel,
  DetectedIntent,
  KnowledgeEntry,
  SensitiveCategory,
} from "../types";
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
  | "model_escalate"
  | "out_of_scope"
  | "sensitive:case_specific"
  /** The answer's category is configured always-escalate (operator-owned tier). */
  | "sensitive:always_escalate"
  /** Judge disabled (cost): a sensitive answer we couldn't verify → escalate (3e). */
  | "sensitive:unverified"
  /**
   * A bare acknowledgment ("okay", "thanks") on a thread a human is already
   * relaying into — kept in-thread, not re-run through the model, not
   * re-escalated. Set outside the wrapper by handleTurn (see conversation.ts).
   */
  | "continuation";

export type CheckState = "pass" | "fail" | "skipped";

export interface FinalDecision {
  decision: Decision;
  reason: DecisionReason;
  /** What the parent sees — the grounded answer, or a warm relay holding message. */
  parent_message: string;
  /**
   * On relay: the model's suppressed draft answer (`model.parent_message` before
   * the templated holding message replaced it). Kept so the operator can accept,
   * edit, or discard it in the live relay (analysis/03 §4.2) — the parent never
   * sees this until a staff member forwards it. Undefined on an answered turn.
   */
  suggested_answer?: string;
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
  /**
   * Category names at the sensitive-or-stricter tier (the `categories` table).
   * An answer classified under one gets the higher τ + groundedness floor.
   */
  sensitiveCategories: ReadonlySet<string>;
  /**
   * Category names configured always-escalate — answers under them are never
   * shown; the wrapper hard-relays them (the old HARD_SENSITIVE behavior, now
   * operator-owned). A subset of `sensitiveCategories`.
   */
  alwaysEscalateCategories: ReadonlySet<string>;
  caution: CautionLevel;
  /**
   * The groundedness judge (analysis/04 §3e). Injected so the wrapper is testable.
   * Optional: when the operator disables the judge for cost (`judge_enabled=false`,
   * analysis/11), the caller omits it and the wrapper skips the inline gate —
   * safe-degrading sensitive answers to escalation (see `groundednessGate`).
   */
  judge?: (input: JudgeInput) => Promise<JudgeResult>;
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
 * decision. See analysis/04 §3 for the check order. Category sensitivity is
 * operator-owned (analysis/09 §4.3): an always-escalate category hard-relays;
 * a sensitive category raises the bar; the model's cross-cutting sensitive_category
 * still escalates any case-specific question.
 *
 * The stack is one `Guardrails` instance whose `run()` walks the stages in order;
 * each stage below is a small method returning `FinalDecision | null` — a decision
 * short-circuits the stack, `null` means "passed, keep going".
 */
export async function decide(
  model: GroundedResult,
  ctx: DecideContext,
): Promise<FinalDecision> {
  return new Guardrails(model, ctx).run();
}

/**
 * One run of the guardrail stack over a single proposal. Holds the state every
 * stage shares — the mutable `checks` record, the two operator-owned sensitivity
 * flags, τ, and the cited policies — so each stage stays a small, readable method.
 */
class Guardrails {
  private readonly checks = { ...CHECKS_INIT };
  /** Category is at the sensitive-or-stricter tier → higher τ + groundedness floor. */
  private readonly sensitiveIntent: boolean;
  /** Category is configured always-escalate → hard-relay, never answer. */
  private readonly alwaysEscalate: boolean;
  /** The confidence bar to answer (caution level + sensitivity). */
  private readonly tau: number;
  /** The published policies the proposal actually cites (for 3c + 3e). */
  private readonly citedPolicies: KnowledgeEntry[];

  constructor(
    private readonly model: GroundedResult,
    private readonly ctx: DecideContext,
  ) {
    // Sensitivity is operator-configured (the `categories` table), read from ctx —
    // no hard-coded lists here (analysis/09 §4.3).
    this.sensitiveIntent = ctx.sensitiveCategories.has(model.intent);
    this.alwaysEscalate = ctx.alwaysEscalateCategories.has(model.intent);
    this.tau = tau(ctx.caution, this.sensitiveIntent);
    this.citedPolicies = ctx.publishedPolicies.filter((p) =>
      model.citations.includes(p.id),
    );
  }

  /** Walk the stages in analysis/04 §3 order; first non-null result wins. */
  async run(): Promise<FinalDecision> {
    const intent = this.model.intent;
    if (intent === "social") return this.social();
    // Out-of-scope: nothing in the handbook covers it → relay (analysis/09 §4.4).
    if (intent === "out_of_scope") return this.relay("out_of_scope");

    return (
      this.hardRoutes() ??
      this.modelEscalate() ??
      this.citationValidity() ??
      this.factCheck() ??
      this.confidenceGate() ??
      (await this.groundednessGate()) ??
      this.answered("grounded", this.model.citations)
    );
  }

  /**
   * Greetings & small talk (analysis/04 §3.1): a pure pleasantry has no handbook
   * entry, so the citation gate would relay "hello" to staff — a cold, wasteful
   * hand-off. Instead we let the model answer warmly WITHOUT a citation, but keep
   * it airtight — a social reply must carry no citations and no checkable facts,
   * and any sensitive/case-specific signal still escalates first. The model can't
   * smuggle an ungrounded policy answer ("we open at 7:00") under this label — the
   * fact-check blocks it and it relays like any other unsupported claim.
   */
  private social(): FinalDecision {
    const { model } = this;
    // A "social" message can't smuggle sensitivity past us: if the operator marks
    // the social category always-escalate, or the model detects ANY sensitive
    // category on it (a cry for help mislabeled as small talk), we escalate rather
    // than chirp a greeting back.
    if (this.alwaysEscalate) return this.relay("sensitive:always_escalate");
    if (model.sensitive_category !== null || (model.is_case_specific && this.sensitiveIntent)) {
      return this.relay("sensitive:case_specific");
    }
    // A genuine pleasantry cites nothing; a citation means it's not small talk.
    if (model.citations.length > 0) return this.relay("out_of_scope");
    const socialFacts = verifyFacts(model.parent_message, []);
    if (!socialFacts.ok) {
      this.checks.fact_match = "fail";
      return this.relay("fact_mismatch", { unsupported_facts: socialFacts.unsupported });
    }
    this.checks.fact_match = "pass";
    return this.answered("social", []);
  }

  /**
   * 3a — hard routes (independent of model confidence). An always-escalate
   * category never answers, even a general policy question. Otherwise, policy =
   * answer / case = escalate: any sensitivity signal on a case-specific question
   * relays. `sensitive_category` is the model's cross-cutting read (e.g. an
   * incident raised under a non-sensitive category), kept precisely for this rule.
   */
  private hardRoutes(): FinalDecision | null {
    const { model } = this;
    if (this.alwaysEscalate) return this.relay("sensitive:always_escalate");
    if (model.is_case_specific && (model.sensitive_category !== null || this.sensitiveIntent)) {
      return this.relay("sensitive:case_specific");
    }
    return null;
  }

  /**
   * Honor the model's own request to escalate. `answer_intent` is advisory and the
   * wrapper makes the real call (§3) — but the wrapper is a safety net that only
   * ever overrides *toward* escalation, never away from it. The model sees nuance
   * the deterministic checks can't (e.g. "is it open *tomorrow*?" — general hours
   * are grounded, but the specific closure calendar isn't published), so when it
   * asks to hand off we relay with the templated holding message and create a real
   * escalation. Skipping this let the model's "…checking with our team!" holding
   * text ship as a grounded answer with no relay behind it — a promised human who
   * never arrives.
   */
  private modelEscalate(): FinalDecision | null {
    return this.model.answer_intent === "escalate" ? this.relay("model_escalate") : null;
  }

  /** 3b — citation validity (fast, code): must cite ≥1 published policy. */
  private citationValidity(): FinalDecision | null {
    const { model } = this;
    if (model.citations.length === 0) {
      this.checks.citation_valid = "fail";
      return this.relay("no_citation");
    }
    const publishedIds = new Set(this.ctx.publishedPolicies.map((p) => p.id));
    if (!model.citations.every((id) => publishedIds.has(id))) {
      this.checks.citation_valid = "fail";
      return this.relay("invalid_citation");
    }
    this.checks.citation_valid = "pass";
    return null;
  }

  /** 3c — deterministic fact verification (fast, code) — the differentiator. */
  private factCheck(): FinalDecision | null {
    const result = verifyFacts(this.model.parent_message, this.citedPolicies);
    if (!result.ok) {
      this.checks.fact_match = "fail";
      return this.relay("fact_mismatch", { unsupported_facts: result.unsupported });
    }
    this.checks.fact_match = "pass";
    return null;
  }

  /** 3d — self-reported confidence gate. */
  private confidenceGate(): FinalDecision | null {
    return this.model.grounding_confidence < this.tau ? this.relay("below_threshold") : null;
  }

  /**
   * 3e — inline groundedness gate (Haiku judge): always for sensitive, plus the
   * borderline confidence band. Well-grounded non-sensitive answers skip it (null)
   * and rely on 3c + the async judge backstop.
   *
   * When the judge is disabled for cost (`ctx.judge` absent, analysis/11): we
   * can't verify a turn that needed the gate, so we safe-degrade — a *sensitive*
   * answer escalates ("sensitive:unverified") rather than shipping unverified,
   * while a non-sensitive borderline answer is allowed through on the deterministic
   * checks (3b–3d) that already passed.
   */
  private async groundednessGate(): Promise<FinalDecision | null> {
    const { model } = this;
    if (!(this.sensitiveIntent || model.grounding_confidence < this.tau + 0.1)) {
      return null;
    }
    if (!this.ctx.judge) {
      return this.sensitiveIntent ? this.relay("sensitive:unverified") : null;
    }
    const { groundedness } = await this.ctx.judge({
      question: this.ctx.question,
      answer: model.parent_message,
      citedPolicies: this.citedPolicies,
    });
    if (groundedness < groundednessFloor(this.sensitiveIntent)) {
      this.checks.groundedness_gate = "fail";
      return this.relay("low_groundedness", { groundedness });
    }
    this.checks.groundedness_gate = "pass";
    return this.answered("grounded", model.citations, groundedness);
  }

  /** Route to the live staff relay with the templated (safe) holding message. */
  private relay(reason: DecisionReason, extra: Partial<FinalDecision> = {}): FinalDecision {
    const { model } = this;
    return {
      decision: "relayed",
      reason,
      parent_message: this.ctx.relayMessage(model.sensitive_category),
      // The parent sees the safe holding message; the operator sees this draft.
      suggested_answer: model.parent_message,
      citations: model.citations,
      intent: model.intent,
      sensitive_category: model.sensitive_category,
      is_case_specific: model.is_case_specific,
      grounding_confidence: model.grounding_confidence,
      checks: this.checks,
      ...extra,
    };
  }

  /** Show the model's answer to the parent (grounded, or a clean social reply). */
  private answered(
    reason: DecisionReason,
    citations: string[],
    groundedness?: number,
  ): FinalDecision {
    const { model } = this;
    return {
      decision: "answered",
      reason,
      parent_message: model.parent_message,
      citations,
      intent: model.intent,
      sensitive_category: model.sensitive_category,
      is_case_specific: model.is_case_specific,
      grounding_confidence: model.grounding_confidence,
      checks: this.checks,
      ...(groundedness !== undefined ? { groundedness } : {}),
    };
  }
}
