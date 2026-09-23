import type { Database } from "better-sqlite3";
import { getAudit, getAuditContext } from "../repo/audit";
import { listWaitingEscalations } from "../repo/escalations";
import { getEntry } from "../repo/knowledge";
import { hasParentLeft } from "../repo/sessions";
import type { DetectedIntent, EscalationDelivery } from "../types";
import { captureDefaultFor } from "./capture";
import { getRelayBus } from "./bus";

/**
 * The live-relay queue an operator sees (analysis/03 §4.2): each waiting parent,
 * with the reason, whether it's case-specific, what the AI already referenced,
 * and a context-aware capture default (off for case-specific, on for gaps).
 */
export interface QueueItem {
  escalationId: string;
  question: string;
  intent: DetectedIntent | null;
  reason: string;
  isCaseSpecific: boolean;
  /** Titles of policies the AI grounded in before relaying — "AI already shared". */
  aiReferenced: string[];
  waitingSince: string;
  captureDefault: boolean;
  /** live = parent waiting on SSE; email = Away async follow-up (analysis/11 §4.5). */
  delivery: EscalationDelivery;
  contactName: string | null;
  contactEmail: string | null;
  /** False once the parent has left a live relay — replies collect as knowledge. */
  parentPresent: boolean;
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

export function buildRelayQueue(db: Database): QueueItem[] {
  return listWaitingEscalations(db).map((esc) => {
    const audit = esc.interaction_id ? getAudit(db, esc.interaction_id) : null;
    const aiReferenced = (audit?.cited_sources ?? []).flatMap((id) => {
      const p = getEntry(db, id);
      return p ? [p.title] : [];
    });
    const ctx = esc.interaction_id ? getAuditContext(db, esc.interaction_id) : null;
    return {
      escalationId: esc.id,
      question: esc.question,
      intent: esc.detected_intent,
      reason: esc.reason,
      isCaseSpecific: esc.reason.startsWith("sensitive:"),
      aiReferenced,
      waitingSince: esc.created_at,
      captureDefault: captureDefaultFor(esc.reason),
      delivery: esc.delivery,
      contactName: esc.contact_name,
      contactEmail: esc.contact_email,
      parentPresent: esc.delivery === "live" && ctx ? !hasParentLeft(db, ctx.session_id) : false,
    };
  });
}
