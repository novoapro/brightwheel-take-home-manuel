import type { Database } from "better-sqlite3";
import { getAudit, getAuditContext } from "../repo/audit";
import { getEntry } from "../repo/knowledge";
import { listWaitingEscalations, type Escalation } from "../repo/escalations";
import type { DetectedIntent } from "../types";
import { captureDefaultFor } from "./capture";

/**
 * Shared shape + helpers for the operator's view of what's still waiting in a
 * relay. Both the queue (grouped by family) and the thread (one family's open
 * work) surface the same "pending question" and derive it the same way — this is
 * the single source of that logic.
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

/** Titles of the policies the AI cited on the turn that triggered an escalation. */
export function aiReferencedFor(db: Database, interactionId: string | null): string[] {
  const audit = interactionId ? getAudit(db, interactionId) : null;
  return (audit?.cited_sources ?? []).flatMap((id) => {
    const p = getEntry(db, id);
    return p ? [p.title] : [];
  });
}

/** Every still-waiting escalation from the same family as `esc` (queue grouping). */
export function sessionWaiting(
  db: Database,
  esc: Escalation,
  sessionId: string | null,
): Escalation[] {
  return listWaitingEscalations(db).filter((e) => {
    if (!e.interaction_id) return e.id === esc.id;
    const s = getAuditContext(db, e.interaction_id)?.session_id ?? null;
    // A resolvable session on both sides groups by it; otherwise only the
    // opened escalation qualifies (no cross-session bleed via null keys).
    return sessionId && s ? s === sessionId : e.id === esc.id;
  });
}

/** Shape a waiting escalation into the operator-facing pending question. */
export function toPendingQuestion(db: Database, esc: Escalation): PendingQuestion {
  return {
    escalationId: esc.id,
    question: esc.question,
    intent: esc.detected_intent,
    reason: esc.reason,
    isCaseSpecific: esc.reason.startsWith("sensitive:"),
    aiReferenced: aiReferencedFor(db, esc.interaction_id),
    captureDefault: captureDefaultFor(esc.reason),
    waitingSince: esc.created_at,
  };
}
