import type { Database } from "better-sqlite3";
import type { DecisionReason } from "../guardrails/decide";
import type { DetectedIntent, EscalationDelivery } from "../types";

/** Escalation — an unknown/sensitive question relayed to staff (analysis/01 §2.3). */
export interface Escalation {
  id: string;
  interaction_id: string | null;
  question: string;
  detected_intent: DetectedIntent | null;
  reason: string;
  status: "waiting" | "answered" | "dismissed";
  operator_answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  /** How the reply was produced (analysis/03 §4.2): forwarded AI draft vs. written. */
  answer_source: "ai_suggested" | "staff" | null;
  /** The model's suppressed draft answer, kept for the operator to accept/edit. */
  ai_draft_answer: string | null;
  /** Policy ids the draft cited — for clickable sources + a grounded send. */
  ai_draft_citations: string[];
  promoted_entry_id: string | null;
  /** live = SSE relay into an open thread; email = async follow-up (analysis/11 §4.3). */
  delivery: EscalationDelivery;
  contact_name: string | null;
  contact_email: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface EscalationInput {
  id: string;
  interaction_id: string;
  question: string;
  detected_intent: DetectedIntent;
  reason: DecisionReason;
  /** Defaults to "live"; "email" when the desk is Away (analysis/11 §4.3). */
  delivery?: EscalationDelivery;
  /** The model's suppressed draft answer, for the operator to accept/edit. */
  ai_draft_answer?: string | null;
  /** Policy ids the draft cited (for clickable sources + a grounded send). */
  ai_draft_citations?: string[];
}

/** The stored row — ai_draft_citations is TEXT JSON, parsed at this boundary. */
type EscalationRow = Omit<Escalation, "ai_draft_citations"> & {
  ai_draft_citations: string | null;
};

function rowToEscalation(row: EscalationRow): Escalation {
  return {
    ...row,
    ai_draft_citations: row.ai_draft_citations
      ? (JSON.parse(row.ai_draft_citations) as string[])
      : [],
  };
}

/** Create a waiting escalation for the live-relay queue (M4 answers it). */
export function createEscalation(
  db: Database,
  input: EscalationInput,
): Escalation {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO escalations
       (id, interaction_id, question, detected_intent, reason, status,
        ai_draft_answer, ai_draft_citations, delivery, created_at)
     VALUES
       (@id, @interaction_id, @question, @detected_intent, @reason, 'waiting',
        @ai_draft_answer, @ai_draft_citations, @delivery, @created_at)`,
  ).run({
    ...input,
    ai_draft_answer: input.ai_draft_answer ?? null,
    ai_draft_citations: JSON.stringify(input.ai_draft_citations ?? []),
    delivery: input.delivery ?? "live",
    created_at,
  });
  return getEscalation(db, input.id)!;
}

/** Store the parent's contact for an Away email follow-up (analysis/11 §4.3). */
export function setEscalationContact(
  db: Database,
  input: { id: string; contact_name: string; contact_email: string },
): void {
  db.prepare(
    `UPDATE escalations
        SET contact_name = @contact_name, contact_email = @contact_email
      WHERE id = @id`,
  ).run(input);
}

/** Mark an email follow-up delivered (simulated send succeeded) — analysis/11 §4.4. */
export function markEscalationDelivered(db: Database, id: string): void {
  db.prepare(`UPDATE escalations SET delivered_at = @delivered_at WHERE id = @id`).run({
    id,
    delivered_at: new Date().toISOString(),
  });
}

export function getEscalation(db: Database, id: string): Escalation | null {
  const row = db
    .prepare(`SELECT * FROM escalations WHERE id = ?`)
    .get(id) as EscalationRow | undefined;
  return row ? rowToEscalation(row) : null;
}

/**
 * The escalation actively being relayed into a conversation, if any: the oldest
 * still-waiting, live-delivery escalation on that conversation's thread. Used by
 * handleTurn to keep a follow-up ("okay", "thanks") in the existing relay instead
 * of re-running it through the model and re-escalating (analysis/03 §3.4).
 */
export function getActiveLiveRelay(
  db: Database,
  conversationId: string,
): Escalation | null {
  const row = db
    .prepare(
      `SELECT e.* FROM escalations e
         JOIN interaction_audit a ON a.id = e.interaction_id
        WHERE a.conversation_id = ?
          AND e.status = 'waiting'
          AND e.delivery = 'live'
        ORDER BY e.created_at, e.rowid
        LIMIT 1`,
    )
    .get(conversationId) as EscalationRow | undefined;
  return row ? rowToEscalation(row) : null;
}

/** Waiting escalations, oldest first — the live-relay queue (analysis/03 §4.2). */
export function listWaitingEscalations(db: Database): Escalation[] {
  // rowid tiebreak keeps insertion order when two escalations from one session
  // share a millisecond timestamp — so "oldest first" is deterministic.
  //
  // `interaction_id IS NOT NULL` excludes a **detached** escalation: one whose
  // interaction/session was removed (its interaction_id nulled). It has no live
  // thread or parent to relay to, so it can't be a live-relay item — dropping it
  // keeps the queue (and the dashboard's waiting count) honest.
  return (
    db
      .prepare(
        `SELECT * FROM escalations
          WHERE status = 'waiting' AND interaction_id IS NOT NULL
          ORDER BY created_at, rowid`,
      )
      .all() as EscalationRow[]
  ).map(rowToEscalation);
}

/** Every escalation (any status) — used for gap analysis on the dashboard. */
export function listAllEscalations(db: Database): Escalation[] {
  return (
    db
      .prepare(`SELECT * FROM escalations ORDER BY created_at, id`)
      .all() as EscalationRow[]
  ).map(rowToEscalation);
}

/**
 * Dismiss a waiting escalation the operator judges no longer actionable — the
 * parent left, the thread went stale, or it's a duplicate. It drops out of the
 * live-relay queue without an answer being relayed. No-op unless still waiting.
 */
export function dismissEscalation(db: Database, id: string): boolean {
  const res = db
    .prepare(
      `UPDATE escalations SET status = 'dismissed' WHERE id = @id AND status = 'waiting'`,
    )
    .run({ id });
  return res.changes > 0;
}

/** Mark an escalation answered (and, on capture, link the promoted policy). */
export function answerEscalation(
  db: Database,
  input: {
    id: string;
    answer: string;
    answeredBy: string;
    promotedEntryId?: string | null;
    /** How the reply was produced — defaults to "staff" (analysis/03 §4.2). */
    source?: "ai_suggested" | "staff";
  },
): void {
  db.prepare(
    `UPDATE escalations
        SET status = 'answered',
            operator_answer = @answer,
            answered_by = @answeredBy,
            answered_at = @answered_at,
            answer_source = @source,
            promoted_entry_id = @promotedEntryId
      WHERE id = @id`,
  ).run({
    id: input.id,
    answer: input.answer,
    answeredBy: input.answeredBy,
    answered_at: new Date().toISOString(),
    source: input.source ?? "staff",
    promotedEntryId: input.promotedEntryId ?? null,
  });
}
