import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { Intent } from "../types";
import { getAuditContext } from "../repo/audit";
import { answerEscalation, getEscalation } from "../repo/escalations";
import { appendMessage } from "../repo/messages";
import { upsertPolicy } from "../repo/policies";
import { buildCapturedPolicy } from "./capture";
import { getRelayBus } from "./bus";

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

  const answeredBy = input.answeredBy.trim() || "Front Desk Team";
  const messageId = randomUUID();

  const commit = db.transaction(() => {
    let promotedPolicyId: string | null = null;
    if (input.capture) {
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

    const message = appendMessage(db, {
      id: messageId,
      conversation_id: ctx.conversation_id,
      role: "frontdesk",
      provenance: "staff",
      text: answer,
      escalation_id: esc.id,
    });

    return { promotedPolicyId, createdAt: message.created_at };
  });

  const { promotedPolicyId, createdAt } = commit();

  // Publish AFTER the commit so subscribers never see uncommitted state.
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

  return {
    conversationId: ctx.conversation_id,
    messageId,
    answeredBy,
    promotedPolicyId,
  };
}
