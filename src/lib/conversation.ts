import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { ask } from "./frontdesk";
import type { FrontDeskModel, Msg } from "./model/types";
import { insertAudit } from "./repo/audit";
import { insertDebugEnvelope } from "./repo/debug";
import { foldTurn } from "./repo/metrics_rollup";
import {
  createConversation,
  getConversation,
} from "./repo/conversations";
import { createEscalation } from "./repo/escalations";
import { appendMessage, listMessages } from "./repo/messages";
import { getEntry } from "./repo/knowledge";
import { publishQueueCount } from "./relay/queue";
import { effectiveAuditMode, resolveAvailability } from "./repo/settings";
import type { EscalationDelivery } from "./types";

/** Holding text when we relay while Away — pairs with the parent contact form. */
const AWAY_RELAY_TEXT =
  "I want to get this exactly right, so I'll pass it to our team. We're away right now.";

/**
 * The parent-turn orchestrator (analysis/03 §3.4, analysis/04 §1): runs the
 * grounded+guardrailed decision (frontdesk.ask), then persists the whole turn —
 * conversation, messages (with provenance), the immutable InteractionAudit, and,
 * on relay, a waiting Escalation for the live-relay queue.
 *
 * The model call is async and runs first; the DB writes then commit atomically
 * in a single synchronous better-sqlite3 transaction.
 */

export interface Citation {
  id: string;
  title: string;
  source: string | null;
}

export interface TurnResult {
  conversationId: string;
  sessionId: string;
  /** InteractionAudit id — the client sends this back with 👍/👎 feedback. */
  interactionId: string;
  decision: "answered" | "relayed";
  reason: string;
  /** The assistant message the parent sees. */
  message: {
    text: string;
    provenance: "grounded" | null;
    citations: Citation[];
    escalationId: string | null;
    /** On relay: "live" = SSE relay, "email" = Away async follow-up (analysis/11 §4.3). */
    delivery: EscalationDelivery | null;
  };
}

export interface HandleTurnInput {
  question: string;
  conversationId?: string;
  sessionId?: string;
  /** Tests inject a fake model to avoid network/API cost. */
  model?: FrontDeskModel;
}

function citationsOf(db: Database, ids: string[]): Citation[] {
  return ids.flatMap((id) => {
    const p = getEntry(db, id);
    return p ? [{ id: p.id, title: p.title, source: p.source }] : [];
  });
}

export async function handleTurn(
  db: Database,
  input: HandleTurnInput,
): Promise<TurnResult> {
  const settings = resolveAvailability(db);
  const existing = input.conversationId
    ? getConversation(db, input.conversationId)
    : null;
  const conversationId = existing?.id ?? randomUUID();
  const sessionId = existing?.session_id ?? input.sessionId ?? randomUUID();

  // Build multi-turn history from prior messages (before this turn) so a thread
  // can start general and turn case-specific — the wrapper re-decides each turn.
  const history: Msg[] = existing
    ? listMessages(db, conversationId).map((m) => ({
        role: m.role === "parent" ? "user" : "assistant",
        content: m.text,
      }))
    : [];

  const startedAt = Date.now();
  const decision = await ask(db, {
    question: input.question,
    history,
    model: input.model,
  });
  const latencyMs = Date.now() - startedAt;

  const interactionId = randomUUID();
  const auditDecision = decision.decision === "answered" ? "answered" : "escalated";
  let escalationId: string | null = null;

  // Availability branches only the escalation path (analysis/11 §4.3): grounded
  // answers are unaffected. Away → email follow-up with an honest holding message.
  const relayedAway =
    decision.decision === "relayed" && settings.availability === "away";
  const delivery: EscalationDelivery | null =
    decision.decision === "relayed" ? (relayedAway ? "email" : "live") : null;
  const parentText = relayedAway ? AWAY_RELAY_TEXT : decision.parent_message;

  const commit = db.transaction(() => {
    if (!existing) {
      createConversation(db, {
        id: conversationId,
        session_id: sessionId,
        active_provider: settings.active_provider,
      });
    }

    appendMessage(db, {
      id: randomUUID(),
      conversation_id: conversationId,
      role: "parent",
      text: input.question,
    });

    insertAudit(db, {
      id: interactionId,
      session_id: sessionId,
      conversation_id: conversationId,
      parent_question: input.question,
      detected_intent: decision.intent,
      decision: auditDecision,
      decision_reason: decision.reason,
      confidence: decision.grounding_confidence,
      provider: decision.provider,
      model: decision.model,
      response_text: decision.parent_message,
      cited_sources: decision.citations,
      checks: decision.checks,
      latency_first_response_ms: latencyMs,
    });

    // Fold this turn into the durable metrics rollup — ALWAYS, independent of the
    // audit setting, so the Dashboard never depends on the raw rows (which get
    // pruned when audit isn't collecting). Groundedness folds later (async judge).
    foldTurn(db, {
      timestamp: new Date().toISOString(),
      intent: decision.intent,
      provider: decision.provider,
      decision: auditDecision,
      decision_reason: decision.reason,
      cited_count: decision.citations.length,
    });

    // Capture the "what we sent / what we expected" envelope every turn (kept or
    // pruned later per audit_mode) — unless audit is Off (or developer mode is
    // off), when we collect nothing.
    if (effectiveAuditMode(settings) !== "off") {
      insertDebugEnvelope(db, {
        interaction_id: interactionId,
        system_prompt: decision.debug.system,
        messages: decision.debug.messages,
        raw_proposal: decision.debug.proposal,
      });
    }

    if (decision.decision === "relayed") {
      escalationId = randomUUID();
      // FK order: audit (above) → escalation → the holding message referencing it.
      createEscalation(db, {
        id: escalationId,
        interaction_id: interactionId,
        question: input.question,
        detected_intent: decision.intent,
        reason: decision.reason,
        delivery: delivery ?? "live",
      });
    }

    appendMessage(db, {
      id: randomUUID(),
      conversation_id: conversationId,
      role: "frontdesk",
      // Holding messages carry no provenance until a staff member answers (M4).
      provenance: decision.decision === "answered" ? "grounded" : null,
      text: parentText,
      citations: decision.decision === "answered" ? decision.citations : [],
      escalation_id: escalationId,
    });
  });
  commit();

  // A new waiting relay changed the queue — push the fresh count to the operator
  // shell so the nav badge lights up live (no polling). After commit only.
  if (decision.decision === "relayed") publishQueueCount(db);

  return {
    conversationId,
    sessionId,
    interactionId,
    decision: decision.decision,
    reason: decision.reason,
    message: {
      text: parentText,
      provenance: decision.decision === "answered" ? "grounded" : null,
      citations:
        decision.decision === "answered"
          ? citationsOf(db, decision.citations)
          : [],
      escalationId,
      delivery,
    },
  };
}
