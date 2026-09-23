import type { Database } from "better-sqlite3";
import { getAudit } from "../repo/audit";
import { getConversation } from "../repo/conversations";
import { getEscalation } from "../repo/escalations";
import { listMessages } from "../repo/messages";
import { getPolicy } from "../repo/policies";
import { getParentSession, hasParentLeft } from "../repo/sessions";
import type { DetectedIntent } from "../types";

/**
 * The full conversation behind a live relay, from the operator's side. The
 * operator opens this to read everything the parent said (and what the AI
 * already answered) before replying — because the one question that triggered
 * the relay often isn't the whole story. Read-only context; sending happens
 * through sendRelayMessage / answerRelay.
 */

/** One turn in the transcript, shaped for the operator chat view. */
export interface ThreadMessage {
  id: string;
  /** "parent" = the family; "frontdesk" = an AI or staff reply. */
  role: "parent" | "frontdesk";
  /** grounded = AI answer, staff = a human reply, null = a holding/hand-off line. */
  provenance: "grounded" | "staff" | null;
  text: string;
  /** Cited handbook titles, for the trust cue on grounded answers. */
  citations: { id: string; title: string }[];
  answeredBy: string | null;
  createdAt: string;
}

export interface RelayThread {
  escalationId: string;
  status: "waiting" | "answered" | "dismissed";
  question: string;
  intent: DetectedIntent | null;
  reason: string;
  isCaseSpecific: boolean;
  waitingSince: string;
  delivery: "live" | "email";
  /** Titles of policies the AI grounded in before relaying. */
  aiReferenced: string[];
  parentName: string | null;
  parentEmail: string | null;
  /** False once the parent has left — replies are collected as knowledge, not sent. */
  parentPresent: boolean;
  messages: ThreadMessage[];
}

export function buildRelayThread(db: Database, escalationId: string): RelayThread | null {
  const esc = getEscalation(db, escalationId);
  if (!esc || !esc.interaction_id) return null;

  const audit = getAudit(db, esc.interaction_id);
  const aiReferenced = (audit?.cited_sources ?? []).flatMap((id) => {
    const p = getPolicy(db, id);
    return p ? [p.title] : [];
  });

  // The escalation points at an interaction (audit row); that row names the
  // conversation we transcribe.
  const conversationId = resolveConversationId(db, esc.interaction_id);
  const messages: ThreadMessage[] = conversationId
    ? listMessages(db, conversationId).map((m) => ({
        id: m.id,
        role: m.role,
        provenance: m.provenance,
        text: m.text,
        citations: m.citations.flatMap((id) => {
          const p = getPolicy(db, id);
          return p ? [{ id: p.id, title: p.title }] : [];
        }),
        answeredBy: m.escalation_id
          ? getEscalation(db, m.escalation_id)?.answered_by ?? null
          : null,
        createdAt: m.created_at,
      }))
    : [];

  const conv = conversationId ? getConversation(db, conversationId) : null;
  const session = conv ? getParentSession(db, conv.session_id) : null;

  return {
    escalationId: esc.id,
    status: esc.status,
    question: esc.question,
    intent: esc.detected_intent,
    reason: esc.reason,
    isCaseSpecific: esc.reason.startsWith("sensitive:"),
    waitingSince: esc.created_at,
    delivery: esc.delivery,
    aiReferenced,
    parentName: session?.name ?? esc.contact_name ?? null,
    parentEmail: session?.email ?? esc.contact_email ?? null,
    // Live delivery only: an email follow-up has no live parent to be "present".
    parentPresent: esc.delivery === "live" && conv ? !hasParentLeft(db, conv.session_id) : false,
    messages,
  };
}

/** The conversation that an interaction (audit row) belongs to. */
function resolveConversationId(db: Database, interactionId: string): string | null {
  const row = db
    .prepare(`SELECT conversation_id FROM interaction_audit WHERE id = ?`)
    .get(interactionId) as { conversation_id: string } | undefined;
  return row?.conversation_id ?? null;
}
