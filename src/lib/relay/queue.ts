import type { Database } from "better-sqlite3";
import { getAudit } from "../repo/audit";
import { listWaitingEscalations } from "../repo/escalations";
import { getPolicy } from "../repo/policies";
import type { DetectedIntent, EscalationDelivery } from "../types";
import { captureDefaultFor } from "./capture";

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
}

export function buildRelayQueue(db: Database): QueueItem[] {
  return listWaitingEscalations(db).map((esc) => {
    const audit = esc.interaction_id ? getAudit(db, esc.interaction_id) : null;
    const aiReferenced = (audit?.cited_sources ?? []).flatMap((id) => {
      const p = getPolicy(db, id);
      return p ? [p.title] : [];
    });
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
    };
  });
}
