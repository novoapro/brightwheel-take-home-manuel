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
import { createEscalation, getActiveLiveRelay } from "./repo/escalations";
import { appendMessage, listMessages } from "./repo/messages";
import { getEntry } from "./repo/knowledge";
import { isAcknowledgment } from "./relay/acknowledgment";
import { publishQueueCount } from "./relay/queue";
import { effectiveAuditMode, resolveAvailability } from "./repo/settings";
import type { DetectedIntent, EscalationDelivery } from "./types";

/** Holding text when we relay while Away — pairs with the parent contact form. */
const AWAY_RELAY_TEXT =
  "I want to get this exactly right, so I'll pass it to our team. We're away right now.";

/**
 * Warm reassurance for a bare acknowledgment ("okay", "thanks") sent while a
 * staff member is already relaying into the thread (analysis/03 §3.4). We keep the
 * turn in-thread — no model call, no new escalation — so the front desk stays one
 * continuous voice and the parent isn't told "checking with our team" a second
 * time or answered over the person who's already on it.
 */
const CONTINUATION_TEXT =
  "Thanks for your patience! We're still checking with our team, and I'll have your answer for you right here in just a moment.";

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

  // Continuation (analysis/03 §3.4): a bare "okay"/"thanks" on a thread a human is
  // already relaying into stays in-thread — no model call, no re-escalation. Only
  // when there's an active live relay AND the message adds no new question; a real
  // follow-up question falls through and is answered (or escalated) as usual.
  if (existing) {
    const activeRelay = getActiveLiveRelay(db, conversationId);
    if (activeRelay && isAcknowledgment(input.question)) {
      return continuationTurn(db, {
        conversationId,
        sessionId,
        question: input.question,
        intent: activeRelay.detected_intent,
        provider: settings.active_provider,
      });
    }
  }

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
        // Keep the model's suppressed draft + its cited policies so the operator
        // can accept/edit it in the relay (analysis/03 §4.2). Away/email relays
        // keep it too — it's still a useful starting point for the reply.
        ai_draft_answer: decision.suggested_answer ?? null,
        ai_draft_citations: decision.citations,
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

/**
 * A continuation turn (analysis/03 §3.4): the parent acknowledged ("okay",
 * "thanks") while a human is already relaying. We record the turn — parent
 * message, a warm reassurance, an audit row, a metrics fold — but do NOT call the
 * model and do NOT create a new escalation. It logs as a *contained* answered turn
 * (reason "continuation"), so the front desk stays one voice and the operator's
 * open relay simply shows the acknowledgment on its next poll.
 */
function continuationTurn(
  db: Database,
  args: {
    conversationId: string;
    sessionId: string;
    question: string;
    intent: DetectedIntent | null;
    provider: string;
  },
): TurnResult {
  const { conversationId, sessionId, question, provider } = args;
  const intent = args.intent ?? "social";
  const interactionId = randomUUID();

  const commit = db.transaction(() => {
    appendMessage(db, {
      id: randomUUID(),
      conversation_id: conversationId,
      role: "parent",
      text: question,
    });

    insertAudit(db, {
      id: interactionId,
      session_id: sessionId,
      conversation_id: conversationId,
      parent_question: question,
      detected_intent: intent,
      decision: "answered",
      decision_reason: "continuation",
      confidence: null,
      provider,
      model: null,
      response_text: CONTINUATION_TEXT,
      cited_sources: [],
      checks: null,
      latency_first_response_ms: 0,
    });

    foldTurn(db, {
      timestamp: new Date().toISOString(),
      intent,
      provider,
      decision: "answered",
      decision_reason: "continuation",
      cited_count: 0,
    });

    appendMessage(db, {
      id: randomUUID(),
      conversation_id: conversationId,
      role: "frontdesk",
      provenance: null, // front-desk voice, not a new AI answer or a staff reply
      text: CONTINUATION_TEXT,
      citations: [],
      escalation_id: null,
    });
  });
  commit();

  return {
    conversationId,
    sessionId,
    interactionId,
    decision: "answered",
    reason: "continuation",
    message: {
      text: CONTINUATION_TEXT,
      provenance: null,
      citations: [],
      escalationId: null,
      delivery: null,
    },
  };
}
