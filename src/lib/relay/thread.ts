import type { Database } from "better-sqlite3";
import { getAudit, getAuditContext } from "../repo/audit";
import { getEscalation, listWaitingEscalations } from "../repo/escalations";
import { listMessages } from "../repo/messages";
import { getEntry } from "../repo/knowledge";
import { getParentSession, hasParentLeft } from "../repo/sessions";
import type { DetectedIntent, EscalationDelivery } from "../types";
import { captureDefaultFor } from "./capture";

/**
 * The full conversation behind a live relay, from the operator's side. The
 * operator opens this to read everything the family said (and what the AI
 * already answered) before replying — because the one question that triggered
 * the relay often isn't the whole story. A family may have several questions
 * still waiting; each is surfaced in `pending`, and the parent message that
 * triggered each is tagged with `pendingEscalationId` so the operator can spot
 * the open questions at a glance. One reply resolves the whole session (a marked
 * question is also saved to the knowledge base). Read-only context; sending
 * happens through sendRelayMessage / answerSession.
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
  /** Set on a parent question that triggered a still-waiting escalation. */
  pendingEscalationId: string | null;
  createdAt: string;
}

/** One unanswered question in this session — a still-waiting escalation. */
export interface PendingQuestion {
  escalationId: string;
  question: string;
  intent: DetectedIntent | null;
  reason: string;
  isCaseSpecific: boolean;
  aiReferenced: string[];
  captureDefault: boolean;
  waitingSince: string;
}

export interface RelayThread {
  sessionId: string | null;
  /** The escalation the operator opened into (the session's oldest waiting one). */
  escalationId: string;
  status: "waiting" | "answered" | "dismissed";
  question: string;
  intent: DetectedIntent | null;
  reason: string;
  isCaseSpecific: boolean;
  waitingSince: string;
  delivery: EscalationDelivery;
  /** Titles of policies the AI grounded in before relaying. */
  aiReferenced: string[];
  parentName: string | null;
  parentEmail: string | null;
  /** False once the parent has left — replies are collected as knowledge, not sent. */
  parentPresent: boolean;
  /** Every still-waiting question in this session, oldest first. */
  pending: PendingQuestion[];
  messages: ThreadMessage[];
}

function aiReferencedFor(db: Database, interactionId: string | null): string[] {
  const audit = interactionId ? getAudit(db, interactionId) : null;
  return (audit?.cited_sources ?? []).flatMap((id) => {
    const p = getEntry(db, id);
    return p ? [p.title] : [];
  });
}

export function buildRelayThread(db: Database, escalationId: string): RelayThread | null {
  const esc = getEscalation(db, escalationId);
  if (!esc || !esc.interaction_id) return null;

  // The escalation points at an interaction (audit row); that row names the
  // session (grouping key) and the conversation we transcribe.
  const ctx = getAuditContext(db, esc.interaction_id);
  const sessionId = ctx?.session_id ?? null;
  const conversationId = ctx?.conversation_id ?? null;
  const rawMessages = conversationId ? listMessages(db, conversationId) : [];

  // Every still-waiting question from the same family — the session's open work,
  // grouped exactly as the queue groups it. (The opening escalation may itself
  // already be answered when the operator re-opens to clear what's left.)
  const pendingEscalations = listWaitingEscalations(db).filter((e) => {
    if (!e.interaction_id) return e.id === esc.id;
    const s = getAuditContext(db, e.interaction_id)?.session_id ?? null;
    // A resolvable session on both sides groups by it; otherwise only the
    // opened escalation qualifies (no cross-session bleed via null keys).
    return sessionId && s ? s === sessionId : e.id === esc.id;
  });

  // Tag the parent question that triggered each waiting escalation: its holding
  // reply (a frontdesk message carrying the escalation id, before any staff
  // answer) sits right after it in the transcript.
  const waitingIds = new Set(pendingEscalations.map((e) => e.id));
  const messageEscalation = new Map<string, string>(); // parent message id → escalation id
  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i];
    if (m.role !== "frontdesk" || m.provenance !== null || !m.escalation_id) continue;
    if (!waitingIds.has(m.escalation_id)) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (rawMessages[j].role === "parent") {
        messageEscalation.set(rawMessages[j].id, m.escalation_id);
        break;
      }
    }
  }

  const messages: ThreadMessage[] = rawMessages.map((m) => ({
    id: m.id,
    role: m.role,
    provenance: m.provenance,
    text: m.text,
    citations: m.citations.flatMap((id) => {
      const p = getEntry(db, id);
      return p ? [{ id: p.id, title: p.title }] : [];
    }),
    answeredBy: m.escalation_id
      ? getEscalation(db, m.escalation_id)?.answered_by ?? null
      : null,
    pendingEscalationId: messageEscalation.get(m.id) ?? null,
    createdAt: m.created_at,
  }));

  const pending: PendingQuestion[] = pendingEscalations.map((e) => ({
    escalationId: e.id,
    question: e.question,
    intent: e.detected_intent,
    reason: e.reason,
    isCaseSpecific: e.reason.startsWith("sensitive:"),
    aiReferenced: aiReferencedFor(db, e.interaction_id),
    captureDefault: captureDefaultFor(e.reason),
    waitingSince: e.created_at,
  }));

  const session = sessionId ? getParentSession(db, sessionId) : null;

  return {
    sessionId,
    escalationId: esc.id,
    status: esc.status,
    question: esc.question,
    intent: esc.detected_intent,
    reason: esc.reason,
    isCaseSpecific: esc.reason.startsWith("sensitive:"),
    waitingSince: esc.created_at,
    delivery: esc.delivery,
    aiReferenced: aiReferencedFor(db, esc.interaction_id),
    parentName: session?.name ?? esc.contact_name ?? null,
    parentEmail: session?.email ?? esc.contact_email ?? null,
    // Live delivery only: an email follow-up has no live parent to be "present".
    parentPresent: esc.delivery === "live" && sessionId ? !hasParentLeft(db, sessionId) : false,
    pending,
    messages,
  };
}
