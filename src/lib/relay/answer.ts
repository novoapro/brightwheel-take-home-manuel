import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { EscalationDelivery, Intent } from "../types";
import { getAuditContext } from "../repo/audit";
import { answerEscalation, getEscalation } from "../repo/escalations";
import { hasParentLeft } from "../repo/sessions";
import { appendMessage } from "../repo/messages";
import { upsertPolicy } from "../repo/policies";
import { buildCapturedPolicy } from "./capture";
import { getRelayBus } from "./bus";
import { publishQueueCount } from "./queue";

/**
 * The operator answers a waiting escalation (analysis/03 §4.2 — the money shot).
 * In one transaction we optionally capture the answer as a citable PolicyRecord,
 * mark the escalation answered, and append a `staff` message into the parent's
 * thread. After commit we publish it to the relay bus so it streams live into
 * the parent's open SSE connection, marked "✓ From our team".
 */
export interface AnswerInput {
  escalationId: string;
  answer: string;
  answeredBy: string;
  /** Promote this answer to a citable policy (deflection compounds). */
  capture?: boolean;
  captureIntent?: Intent;
  captureTitle?: string;
}

export interface AnswerResult {
  conversationId: string;
  messageId: string;
  answeredBy: string;
  promotedPolicyId: string | null;
  /** How this answer reaches the parent — the route sends the email for "email". */
  delivery: EscalationDelivery;
  contactName: string | null;
  contactEmail: string | null;
  /** True when the reply streamed to a live parent (false if they'd left). */
  posted: boolean;
  /** True when the parent had left and the answer was saved as knowledge instead. */
  collectedKnowledge: boolean;
}

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

export function answerRelay(db: Database, input: AnswerInput): AnswerResult {
  const answer = input.answer.trim();
  if (!answer) throw new Error("Answer text is required.");

  const esc = getEscalation(db, input.escalationId);
  if (!esc) throw new Error("Escalation not found.");
  if (esc.status !== "waiting") {
    throw new Error("This escalation has already been handled.");
  }
  if (!esc.interaction_id) throw new Error("Escalation has no interaction.");

  const ctx = getAuditContext(db, esc.interaction_id);
  if (!ctx) throw new Error("Could not find the conversation for this escalation.");

  // If the parent has left a live relay there's no chat to post into — the
  // answer's remaining value is knowledge, so we skip the live message and
  // collect it instead (except a specific case, which never becomes general
  // knowledge). An email follow-up is never "posted live" regardless.
  const parentGone = esc.delivery === "live" && hasParentLeft(db, ctx.session_id);
  const postLive = esc.delivery === "live" && !parentGone;
  const isCaseSpecific = esc.reason.startsWith("sensitive:");
  const doCapture = !!input.capture || (parentGone && !isCaseSpecific);

  const answeredBy = input.answeredBy.trim() || "Front Desk Team";
  const messageId = randomUUID();

  const commit = db.transaction(() => {
    let promotedPolicyId: string | null = null;
    if (doCapture) {
      const intent: Intent = input.captureIntent ?? "tours";
      const policy = buildCapturedPolicy({
        intent,
        question: esc.question,
        answer,
        title: input.captureTitle,
        answeredBy,
        idSuffix: messageId.slice(0, 8),
      });
      upsertPolicy(db, policy);
      promotedPolicyId = policy.id;
    }

    answerEscalation(db, {
      id: esc.id,
      answer,
      answeredBy,
      promotedPolicyId,
    });

    // Only append a chat message when there's a live parent to receive it.
    let createdAt: string | null = null;
    if (postLive) {
      const message = appendMessage(db, {
        id: messageId,
        conversation_id: ctx.conversation_id,
        role: "frontdesk",
        provenance: "staff",
        text: answer,
        escalation_id: esc.id,
      });
      createdAt = message.created_at;
    }

    return { promotedPolicyId, createdAt };
  });

  const { promotedPolicyId, createdAt } = commit();

  // The escalation left the waiting queue — push the fresh count to operators.
  publishQueueCount(db);

  // Live relay streams into the parent's open SSE connection; an email
  // follow-up is delivered by the route via the EmailSender instead, never the
  // bus (analysis/11 §4.4). We publish AFTER commit so subscribers never see
  // uncommitted state.
  if (postLive && createdAt) {
    getRelayBus().publish({
      type: "staff_message",
      conversationId: ctx.conversation_id,
      message: {
        id: messageId,
        escalationId: esc.id,
        text: answer,
        answeredBy,
        createdAt,
      },
    });
  }

  return {
    conversationId: ctx.conversation_id,
    messageId,
    answeredBy,
    promotedPolicyId,
    delivery: esc.delivery,
    contactName: esc.contact_name,
    contactEmail: esc.contact_email,
    /** True when the reply streamed to a live parent. */
    posted: postLive,
    /** True when the parent had left and the answer was saved as knowledge. */
    collectedKnowledge: parentGone && promotedPolicyId != null,
  };
}
