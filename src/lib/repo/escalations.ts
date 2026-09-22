import type { Database } from "better-sqlite3";
import type { DecisionReason } from "../guardrails/decide";
import type { DetectedIntent } from "../types";

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
  promoted_policy_id: string | null;
  created_at: string;
}

export interface EscalationInput {
  id: string;
  interaction_id: string;
  question: string;
  detected_intent: DetectedIntent;
  reason: DecisionReason;
}

/** Create a waiting escalation for the live-relay queue (M4 answers it). */
export function createEscalation(
  db: Database,
  input: EscalationInput,
): Escalation {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO escalations
       (id, interaction_id, question, detected_intent, reason, status, created_at)
     VALUES
       (@id, @interaction_id, @question, @detected_intent, @reason, 'waiting', @created_at)`,
  ).run({ ...input, created_at });
  return getEscalation(db, input.id)!;
}

export function getEscalation(db: Database, id: string): Escalation | null {
  const row = db
    .prepare(`SELECT * FROM escalations WHERE id = ?`)
    .get(id) as Escalation | undefined;
  return row ?? null;
}

/** Waiting escalations, oldest first — the live-relay queue (analysis/03 §4.2). */
export function listWaitingEscalations(db: Database): Escalation[] {
  return db
    .prepare(
      `SELECT * FROM escalations WHERE status = 'waiting' ORDER BY created_at, id`,
    )
    .all() as Escalation[];
}

/** Every escalation (any status) — used for gap analysis on the dashboard. */
export function listAllEscalations(db: Database): Escalation[] {
  return db
    .prepare(`SELECT * FROM escalations ORDER BY created_at, id`)
    .all() as Escalation[];
}

/** Mark an escalation answered (and, on capture, link the promoted policy). */
export function answerEscalation(
  db: Database,
  input: {
    id: string;
    answer: string;
    answeredBy: string;
    promotedPolicyId?: string | null;
  },
): void {
  db.prepare(
    `UPDATE escalations
        SET status = 'answered',
            operator_answer = @answer,
            answered_by = @answeredBy,
            answered_at = @answered_at,
            promoted_policy_id = @promotedPolicyId
      WHERE id = @id`,
  ).run({
    id: input.id,
    answer: input.answer,
    answeredBy: input.answeredBy,
    answered_at: new Date().toISOString(),
    promotedPolicyId: input.promotedPolicyId ?? null,
  });
}
