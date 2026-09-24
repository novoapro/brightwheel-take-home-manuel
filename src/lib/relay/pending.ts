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

/** A cited policy, resolved for a clickable "AI already referenced" chip. */
export interface ReferencedPolicy {
  id: string;
  title: string;
}

/** One unanswered question within a session — a still-waiting escalation. */
export interface PendingQuestion {
  escalationId: string;
  question: string;
  intent: DetectedIntent | null;
  reason: string;
  isCaseSpecific: boolean;
  /** Policies the AI grounded in before relaying — the operator's "AI already
   *  shared" cue, now with ids so each chip deep-links to the handbook. */
  aiReferenced: ReferencedPolicy[];
  /** The model's suppressed draft answer, for the operator to accept/edit (or null). */
  aiDraft: string | null;
  captureDefault: boolean;
  waitingSince: string;
}

/** Resolve cited policy ids to {id, title} chips (dropping any that no longer exist). */
export function referencedPolicies(db: Database, ids: string[]): ReferencedPolicy[] {
  return ids.flatMap((id) => {
    const p = getEntry(db, id);
    return p ? [{ id: p.id, title: p.title }] : [];
  });
}

/** Policies the AI cited on the turn that triggered an escalation (from the audit). */
export function aiReferencedFor(
  db: Database,
  interactionId: string | null,
): ReferencedPolicy[] {
  const audit = interactionId ? getAudit(db, interactionId) : null;
  return referencedPolicies(db, audit?.cited_sources ?? []);
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
    // Prefer the draft's own cited ids stored on the escalation; fall back to the
    // audit for older rows that predate the column.
    aiReferenced: esc.ai_draft_citations.length
      ? referencedPolicies(db, esc.ai_draft_citations)
      : aiReferencedFor(db, esc.interaction_id),
    aiDraft: esc.ai_draft_answer,
    captureDefault: captureDefaultFor(esc.reason),
    waitingSince: esc.created_at,
  };
}
