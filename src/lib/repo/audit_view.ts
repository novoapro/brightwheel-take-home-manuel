import type { Database } from "better-sqlite3";
import { getDebugEnvelope, type DebugEnvelope } from "./debug";
import { listMessages, type Message } from "./messages";
import { getParentSession, type ParentSession } from "./sessions";

/**
 * Read models for the operator Audit surface (analysis/05 §5). The session list
 * powers the two viewing modes (all vs. "needs review"), and the detail joins a
 * session's transcript with each turn's audit decision and, when retained, the
 * troubleshooting envelope.
 *
 * "Needs review" is defined once — `rating !== 'up'` (👎 or unrated) — so the
 * sessions surfaced by the filter are exactly the ones whose detail was retained
 * under `flagged` audit mode.
 */

/** Which sessions the Audit list shows. */
export type AuditFilter = "all" | "flagged";

export interface AuditSessionRow {
  session_id: string;
  name: string;
  email: string;
  status: "open" | "closed";
  closed_reason: string | null;
  created_at: string;
  last_active_at: string;
  rating: "up" | "down" | null;
  review: string | null;
  rated_at: string | null;
  interactions: number;
  answered: number;
  escalated: number;
  /** How many of this session's turns still have a retained envelope. */
  retained: number;
}

/**
 * Sessions that still have retained troubleshooting detail, newest activity
 * first. A session with no retained envelope has nothing to audit, so it isn't
 * shown — removing a session's detail drops it out of this view. In `flagged`
 * mode only sessions that did not receive a 👍 are returned. Within the list,
 * 👎 sorts ahead of unrated, ahead of 👍, so the most concerning are on top.
 */
export function listSessionsForAudit(
  db: Database,
  filter: AuditFilter,
): AuditSessionRow[] {
  const where = filter === "flagged" ? `WHERE ps.rating IS NULL OR ps.rating = 'down'` : "";
  const rows = db
    .prepare(
      `SELECT ps.id AS session_id, ps.name, ps.email, ps.status, ps.closed_reason,
              ps.created_at, ps.last_active_at, ps.rating, ps.review, ps.rated_at,
              COUNT(ia.id) AS interactions,
              SUM(CASE WHEN ia.decision = 'answered' THEN 1 ELSE 0 END) AS answered,
              SUM(CASE WHEN ia.decision = 'escalated' THEN 1 ELSE 0 END) AS escalated,
              COUNT(idg.interaction_id) AS retained
         FROM parent_sessions ps
         JOIN interaction_audit ia ON ia.session_id = ps.id
         LEFT JOIN interaction_debug idg ON idg.interaction_id = ia.id
         ${where}
        GROUP BY ps.id
        HAVING retained > 0
        ORDER BY (CASE WHEN ps.rating = 'down' THEN 0 WHEN ps.rating IS NULL THEN 1 ELSE 2 END),
                 ps.last_active_at DESC`,
    )
    .all() as AuditSessionRow[];
  return rows;
}

export interface AuditInteraction {
  id: string;
  timestamp: string;
  parent_question: string;
  detected_intent: string | null;
  decision: "answered" | "escalated";
  decision_reason: string;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  response_text: string | null;
  cited_sources: string[];
  checks: unknown;
  judge_scores: { groundedness?: number; answer_relevancy?: number } | null;
  /** The troubleshooting envelope, or null when never captured / pruned. */
  envelope: DebugEnvelope | null;
}

export interface SessionAuditDetail {
  session: ParentSession;
  messages: Message[];
  interactions: AuditInteraction[];
}

/** Full audit for one session: transcript + per-turn decision + envelope. */
export function getSessionAuditDetail(
  db: Database,
  sessionId: string,
): SessionAuditDetail | null {
  const session = getParentSession(db, sessionId);
  if (!session) return null;

  const messages = session.conversation_id
    ? listMessages(db, session.conversation_id)
    : [];

  const rows = db
    .prepare(
      `SELECT id, timestamp, parent_question, detected_intent, decision,
              decision_reason, confidence, provider, model, response_text,
              cited_sources, checks, judge_scores
         FROM interaction_audit
        WHERE session_id = ?
        ORDER BY timestamp, rowid`,
    )
    .all(sessionId) as Array<{
    id: string;
    timestamp: string;
    parent_question: string;
    detected_intent: string | null;
    decision: "answered" | "escalated";
    decision_reason: string;
    confidence: number | null;
    provider: string | null;
    model: string | null;
    response_text: string | null;
    cited_sources: string;
    checks: string | null;
    judge_scores: string | null;
  }>;

  const interactions: AuditInteraction[] = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    parent_question: r.parent_question,
    detected_intent: r.detected_intent,
    decision: r.decision,
    decision_reason: r.decision_reason,
    confidence: r.confidence,
    provider: r.provider,
    model: r.model,
    response_text: r.response_text,
    cited_sources: JSON.parse(r.cited_sources) as string[],
    checks: r.checks ? JSON.parse(r.checks) : null,
    judge_scores: r.judge_scores ? JSON.parse(r.judge_scores) : null,
    envelope: getDebugEnvelope(db, r.id),
  }));

  return { session, messages, interactions };
}
