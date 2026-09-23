import type { Database } from "better-sqlite3";
import { decide, type FinalDecision } from "./guardrails/decide";
import { getModel } from "./model";
import type { FrontDeskModel, GroundedResult, Msg } from "./model/types";
import { buildSystemPrefix, relayMessage } from "./model/prompt";
import { getCenter } from "./repo/center";
import { listPublishedEntries } from "./repo/knowledge";
import { getSettings } from "./repo/settings";

/**
 * Orchestrates one parent turn (analysis/04 §1): build the cached prefix →
 * grounded model call → deterministic guardrail wrapper → final safe decision.
 *
 * This is the trust core. Audit logging (analysis/05) and the live-relay write
 * are wired in M3/M4; M2 proves a wrong number can't reach a parent.
 */
export interface AskInput {
  question: string;
  /** Prior turns (optional); the latest parent question is passed separately. */
  history?: Msg[];
  /** Override the model (tests inject a fake FrontDeskModel). */
  model?: FrontDeskModel;
}

export interface AskResult extends FinalDecision {
  provider: string;
  model: string;
  /**
   * The raw request/response envelope for the audit trail (analysis/05 §2) —
   * "what we sent the model and what it proposed", before the guardrail wrapper.
   * Always populated; persisted (or not) per the operator's audit_mode.
   */
  debug: {
    system: string;
    messages: Msg[];
    proposal: GroundedResult;
  };
}

export async function ask(db: Database, input: AskInput): Promise<AskResult> {
  const center = getCenter(db);
  if (!center) {
    throw new Error("No center configured — run `npm run db:seed` first.");
  }
  const publishedPolicies = listPublishedEntries(db);
  const settings = getSettings(db);
  const model = input.model ?? getModel(settings.active_provider, db);

  const system = buildSystemPrefix(center, publishedPolicies);
  const messages: Msg[] = [
    ...(input.history ?? []),
    { role: "user", content: input.question },
  ];

  const proposal = await model.groundedAnswer({ system, messages });

  const decision = await decide(proposal, {
    question: input.question,
    publishedPolicies,
    caution: settings.caution_level,
    judge: (i) => model.judgeGroundedness(i),
    relayMessage,
  });

  return {
    ...decision,
    provider: model.provider,
    model: model.answererModel,
    debug: { system, messages, proposal },
  };
}
