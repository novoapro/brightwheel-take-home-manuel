import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { ask } from "./frontdesk";
import type { FrontDeskModel, Msg } from "./model/types";
import { insertAudit } from "./repo/audit";
import {
  createConversation,
  getConversation,
} from "./repo/conversations";
import { createEscalation } from "./repo/escalations";
import { appendMessage, listMessages } from "./repo/messages";
import { getPolicy } from "./repo/policies";
import { getSettings } from "./repo/settings";

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
    const p = getPolicy(db, id);
    return p ? [{ id: p.id, title: p.title, source: p.source }] : [];
  });
}

export async function handleTurn(
  db: Database,
  input: HandleTurnInput,
): Promise<TurnResult> {
  const settings = getSettings(db);
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

    if (decision.decision === "relayed") {
      escalationId = randomUUID();
      // FK order: audit (above) → escalation → the holding message referencing it.
      createEscalation(db, {
        id: escalationId,
        interaction_id: interactionId,
        question: input.question,
        detected_intent: decision.intent,
        reason: decision.reason,
      });
    }

    appendMessage(db, {
      id: randomUUID(),
      conversation_id: conversationId,
      role: "frontdesk",
      // Holding messages carry no provenance until a staff member answers (M4).
      provenance: decision.decision === "answered" ? "grounded" : null,
      text: decision.parent_message,
      citations: decision.decision === "answered" ? decision.citations : [],
      escalation_id: escalationId,
    });
  });
  commit();

  return {
    conversationId,
    sessionId,
    interactionId,
    decision: decision.decision,
    reason: decision.reason,
    message: {
      text: decision.parent_message,
      provenance: decision.decision === "answered" ? "grounded" : null,
      citations:
        decision.decision === "answered"
          ? citationsOf(db, decision.citations)
          : [],
      escalationId,
    },
  };
}
