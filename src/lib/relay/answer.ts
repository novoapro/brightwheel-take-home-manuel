import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { EscalationDelivery, Intent } from "../types";
import { getAuditContext } from "../repo/audit";
import {
  answerEscalation,
  dismissEscalation,
  getEscalation,
} from "../repo/escalations";
import { hasParentLeft } from "../repo/sessions";
import { appendMessage } from "../repo/messages";
import { upsertEntry } from "../repo/knowledge";
import { buildCapturedPolicy } from "./capture";
import { getRelayBus } from "./bus";
import { publishQueueCount } from "./queue";
import { sessionWaiting } from "./pending";

/**
 * Send a mid-relay message to the parent WITHOUT resolving the escalation — the
 * operator gathering context before they can give a valuable answer (e.g. "Which
 * classroom is she in?"). It appends a staff message and streams it live, but
 * leaves the escalation waiting so it stays in the queue until a real answer or
 * a dismissal. Live relays only — an Away/email thread has no open stream.
 */
export interface SendMessageInput {
  escalationId: string;
  text: string;
  answeredBy: string;
}

export interface SentMessage {
  conversationId: string;
  messageId: string;
  answeredBy: string;
  createdAt: string;
}

export function sendRelayMessage(db: Database, input: SendMessageInput): SentMessage {
  const text = input.text.trim();
  if (!text) throw new Error("Message text is required.");

  const esc = getEscalation(db, input.escalationId);
  if (!esc) throw new Error("Escalation not found.");
  if (esc.status !== "waiting") {
    throw new Error("This escalation has already been handled.");
  }
  if (esc.delivery !== "live") {
    throw new Error("Only a live relay can be messaged in real time.");
  }
  if (!esc.interaction_id) throw new Error("Escalation has no interaction.");

  const ctx = getAuditContext(db, esc.interaction_id);
  if (!ctx) throw new Error("Could not find the conversation for this escalation.");

  // A clarifying message only makes sense if the parent is still here. If they've
  // left, there's no live thread — resolve to collect the answer as knowledge.
  if (hasParentLeft(db, ctx.session_id)) {
    throw new Error(
      "The parent has left this session. Resolve to save your answer to the knowledge base instead.",
    );
  }

  const answeredBy = input.answeredBy.trim() || "Front Desk Team";
  const messageId = randomUUID();

  const message = appendMessage(db, {
    id: messageId,
    conversation_id: ctx.conversation_id,
    role: "frontdesk",
    provenance: "staff",
    text,
    escalation_id: esc.id,
  });

  // Publish after the write commits so the parent never sees uncommitted state.
  getRelayBus().publish({
    type: "staff_message",
    conversationId: ctx.conversation_id,
    message: { id: messageId, escalationId: esc.id, text, answeredBy, createdAt: message.created_at },
  });

  return {
    conversationId: ctx.conversation_id,
    messageId,
    answeredBy,
    createdAt: message.created_at,
  };
}

/**
 * Resolve a whole session's relay in ONE message (analysis/03 §4.2, refined). The
 * operator reads the thread and sends a single reply that closes *every* waiting
 * question for that family — they don't answer them one by one. Saving to the
 * knowledge base is opt-in and tied to a specific question the operator marked
 * (`captureEscalationId`): a plain reply collects no knowledge; a marked,
 * non-case-specific question becomes a citable KnowledgeEntry so the front desk
 * handles it next time.
 */
export interface AnswerSessionInput {
  /** Any escalation in the target session (typically the one the operator opened). */
  escalationId: string;
  answer: string;
  answeredBy: string;
  /** The pending question to promote to knowledge, or null/undefined for none. */
  captureEscalationId?: string | null;
  captureIntent?: Intent;
  captureTitle?: string;
  /**
   * Operator-reworded question to store instead of the parent's raw wording —
   * drives the captured entry's title and keywords. Falls back to the original.
   */
  captureQuestion?: string;
}

export interface AnswerSessionResult {
  conversationId: string;
  sessionId: string;
  /** How many waiting questions this one reply closed. */
  resolvedCount: number;
  promotedEntryId: string | null;
  delivery: EscalationDelivery;
  contactName: string | null;
  contactEmail: string | null;
  /** True when the reply streamed to a live parent. */
  posted: boolean;
  /** True when a marked question was saved to the knowledge base. */
  collectedKnowledge: boolean;
}

export function answerSession(db: Database, input: AnswerSessionInput): AnswerSessionResult {
  const answer = input.answer.trim();

  const esc = getEscalation(db, input.escalationId);
  if (!esc) throw new Error("Escalation not found.");
  if (!esc.interaction_id) throw new Error("Escalation has no interaction.");

  const ctx = getAuditContext(db, esc.interaction_id);
  if (!ctx) throw new Error("Could not find the conversation for this escalation.");
  const sessionId = ctx.session_id;

  const waiting = sessionWaiting(db, esc, sessionId);
  if (waiting.length === 0) throw new Error("This session has no waiting questions.");

  // Parent gone from a live relay → nothing to post; email is delivered by the
  // route, never streamed. Otherwise the reply streams into the open thread.
  const parentGone = esc.delivery === "live" && hasParentLeft(db, sessionId);
  const postLive = esc.delivery === "live" && !parentGone;

  // Capture is opt-in (a marked question) and never a case-specific one.
  const captureEsc = input.captureEscalationId
    ? waiting.find((e) => e.id === input.captureEscalationId) ?? null
    : null;
  const doCapture = !!captureEsc && !captureEsc.reason.startsWith("sensitive:");

  // A delivered reply (live or email) needs text; a pure parent-gone close-out
  // does not — unless it's saving knowledge, which needs the answer body.
  if ((postLive || esc.delivery === "email" || doCapture) && !answer) {
    throw new Error("Answer text is required.");
  }

  const answeredBy = input.answeredBy.trim() || "Front Desk Team";
  const messageId = randomUUID();
  const routeEscalationId = captureEsc?.id ?? esc.id;

  const commit = db.transaction(() => {
    let promotedEntryId: string | null = null;
    if (doCapture && captureEsc) {
      // Fall back to "tours" when the operator didn't pick a category — it's the
      // most benign general-inquiry bucket for a captured answer to land in.
      const intent: Intent = input.captureIntent ?? "tours";
      // The operator may reword the question for a cleaner title & search terms;
      // fall back to the parent's original wording when they didn't.
      const question = input.captureQuestion?.trim() || captureEsc.question;
      const policy = buildCapturedPolicy({
        intent,
        question,
        answer,
        title: input.captureTitle,
        answeredBy,
        idSuffix: messageId.slice(0, 8),
      });
      upsertEntry(db, policy);
      promotedEntryId = policy.id;
    }

    // One reply closes every waiting question in the session.
    for (const w of waiting) {
      answerEscalation(db, {
        id: w.id,
        answer,
        answeredBy,
        promotedEntryId: w.id === captureEsc?.id ? promotedEntryId : null,
      });
    }

    let createdAt: string | null = null;
    if (postLive && answer) {
      const message = appendMessage(db, {
        id: messageId,
        conversation_id: ctx.conversation_id,
        role: "frontdesk",
        provenance: "staff",
        text: answer,
        escalation_id: routeEscalationId,
      });
      createdAt = message.created_at;
    }

    return { promotedEntryId, createdAt };
  });

  const { promotedEntryId, createdAt } = commit();

  publishQueueCount(db);

  if (postLive && createdAt) {
    getRelayBus().publish({
      type: "staff_message",
      conversationId: ctx.conversation_id,
      message: { id: messageId, escalationId: routeEscalationId, text: answer, answeredBy, createdAt },
    });
  }

  return {
    conversationId: ctx.conversation_id,
    sessionId,
    resolvedCount: waiting.length,
    promotedEntryId,
    delivery: esc.delivery,
    contactName: esc.contact_name,
    contactEmail: esc.contact_email,
    posted: postLive && !!answer,
    collectedKnowledge: promotedEntryId != null,
  };
}

/**
 * Dismiss a whole session's relay — the family left or the thread went stale.
 * Drops every waiting question out of the queue without a reply. Returns how many
 * were dismissed (0 if none were still waiting).
 */
export function dismissSession(db: Database, escalationId: string): number {
  const esc = getEscalation(db, escalationId);
  if (!esc || !esc.interaction_id) return dismissEscalation(db, escalationId) ? 1 : 0;
  const ctx = getAuditContext(db, esc.interaction_id);
  const waiting = sessionWaiting(db, esc, ctx?.session_id ?? null);
  let n = 0;
  for (const w of waiting) if (dismissEscalation(db, w.id)) n++;
  return n;
}
