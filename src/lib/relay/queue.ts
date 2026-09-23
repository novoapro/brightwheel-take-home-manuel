import type { Database } from "better-sqlite3";
import { getAudit, getAuditContext } from "../repo/audit";
import { listWaitingEscalations } from "../repo/escalations";
import { getEntry } from "../repo/knowledge";
import { getParentSession, hasParentLeft } from "../repo/sessions";
import type { DetectedIntent, EscalationDelivery } from "../types";
import { captureDefaultFor } from "./capture";
import { getRelayBus } from "./bus";

/**
 * The live-relay queue an operator sees (analysis/03 §4.2). We group by *session*,
 * not by message: a family that asked several questions the front desk couldn't
 * answer shows up as ONE entry, with all its pending questions attached. The
 * operator opens the session to read the full thread and answer each question in
 * context (see buildRelayThread) — the queue itself no longer replies inline.
 */

/** One unanswered question within a session — a still-waiting escalation. */
export interface PendingQuestion {
  escalationId: string;
  question: string;
  intent: DetectedIntent | null;
  reason: string;
  isCaseSpecific: boolean;
  /** Titles of policies the AI grounded in before relaying — "AI already shared". */
  aiReferenced: string[];
  captureDefault: boolean;
  waitingSince: string;
}

/** One waiting family — the unit of the relay queue. */
export interface SessionQueueItem {
  sessionId: string;
  /** Oldest waiting escalation — the thread the operator opens into. */
  primaryEscalationId: string;
  parentName: string | null;
  parentEmail: string | null;
  /** live = parent waiting on SSE; email = Away async follow-up (analysis/11 §4.5). */
  delivery: EscalationDelivery;
  contactName: string | null;
  contactEmail: string | null;
  /** False once the parent has left a live relay — replies collect as knowledge. */
  parentPresent: boolean;
  /** When the family's oldest pending question started waiting. */
  waitingSince: string;
  /** Every still-waiting question in this session, oldest first. */
  pending: PendingQuestion[];
}

/**
 * Broadcast the current waiting-relay count to every connected operator shell.
 * Call after any change to the queue (a new relay, an answer, a dismissal) so
 * the nav badge updates live over SSE without polling.
 */
export function publishQueueCount(db: Database): void {
  getRelayBus().publishQueue({
    type: "queue_changed",
    waiting: listWaitingEscalations(db).length,
  });
}

/** Titles of the policies the AI cited on the turn that triggered an escalation. */
function aiReferencedFor(db: Database, interactionId: string | null): string[] {
  const audit = interactionId ? getAudit(db, interactionId) : null;
  return (audit?.cited_sources ?? []).flatMap((id) => {
    const p = getEntry(db, id);
    return p ? [p.title] : [];
  });
}

export function buildRelayQueue(db: Database): SessionQueueItem[] {
  // Waiting escalations are already oldest-first; grouping preserves that so each
  // session's `pending` list — and the group insertion order — stays chronological.
  const groups = new Map<string, SessionQueueItem>();

  for (const esc of listWaitingEscalations(db)) {
    const ctx = esc.interaction_id ? getAuditContext(db, esc.interaction_id) : null;
    // A relay without a resolvable session stands on its own (keyed by its id).
    const sessionId = ctx?.session_id ?? `esc:${esc.id}`;

    const pending: PendingQuestion = {
      escalationId: esc.id,
      question: esc.question,
      intent: esc.detected_intent,
      reason: esc.reason,
      isCaseSpecific: esc.reason.startsWith("sensitive:"),
      aiReferenced: aiReferencedFor(db, esc.interaction_id),
      captureDefault: captureDefaultFor(esc.reason),
      waitingSince: esc.created_at,
    };

    const existing = groups.get(sessionId);
    if (existing) {
      existing.pending.push(pending);
      continue;
    }

    // First (oldest) escalation for this session sets its display + delivery.
    const session = ctx ? getParentSession(db, ctx.session_id) : null;
    groups.set(sessionId, {
      sessionId,
      primaryEscalationId: esc.id,
      parentName: session?.name ?? esc.contact_name ?? null,
      parentEmail: session?.email ?? esc.contact_email ?? null,
      delivery: esc.delivery,
      contactName: esc.contact_name,
      contactEmail: esc.contact_email,
      parentPresent: esc.delivery === "live" && ctx ? !hasParentLeft(db, ctx.session_id) : false,
      waitingSince: esc.created_at,
      pending: [pending],
    });
  }

  return [...groups.values()];
}
