import type { Database } from "better-sqlite3";
import type { DecisionReason } from "../guardrails/decide";
import type { DetectedIntent } from "../types";

/**
 * InteractionAudit — one immutable record per parent turn (analysis/05 §2).
 * The atomic unit every metric is computed over. Note the audit `decision`
 * vocabulary is answered|escalated (our runtime decision "relayed" maps to
 * "escalated" here).
 */
export interface AuditInput {
  id: string;
  session_id: string;
  conversation_id: string;
  parent_question: string;
  detected_intent: DetectedIntent;
  decision: "answered" | "escalated";
  decision_reason: DecisionReason;
  confidence?: number | null;
  provider?: string | null;
  model?: string | null;
  response_text?: string | null;
  cited_sources?: string[];
  checks?: unknown;
  latency_first_response_ms?: number | null;
}

export function insertAudit(db: Database, input: AuditInput): string {
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO interaction_audit
       (id, session_id, conversation_id, timestamp, parent_question,
        detected_intent, decision, decision_reason, confidence, provider, model,
        response_text, cited_sources, checks, latency_first_response_ms)
     VALUES
       (@id, @session_id, @conversation_id, @timestamp, @parent_question,
        @detected_intent, @decision, @decision_reason, @confidence, @provider, @model,
        @response_text, @cited_sources, @checks, @latency_first_response_ms)`,
  ).run({
    id: input.id,
    session_id: input.session_id,
    conversation_id: input.conversation_id,
    timestamp,
    parent_question: input.parent_question,
    detected_intent: input.detected_intent,
    decision: input.decision,
    decision_reason: input.decision_reason,
    confidence: input.confidence ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    response_text: input.response_text ?? null,
    cited_sources: JSON.stringify(input.cited_sources ?? []),
    checks: input.checks != null ? JSON.stringify(input.checks) : null,
    latency_first_response_ms: input.latency_first_response_ms ?? null,
  });
  return input.id;
}

/** A slim audit projection for metrics aggregation (analysis/05 §3). */
export interface AuditMetricRow {
  decision: "answered" | "escalated";
  decision_reason: string;
  detected_intent: string | null;
  parent_feedback: "up" | "down" | null;
  cited_count: number;
  /** Async Haiku judge groundedness (analysis/04 §7), null until scored. */
  groundedness: number | null;
  /** Which provider handled it — enables the Claude vs. Gemini A/B slice. */
  provider: string | null;
  timestamp: string;
}

export function listAuditMetrics(db: Database): AuditMetricRow[] {
  const rows = db
    .prepare(
      `SELECT decision, decision_reason, detected_intent, parent_feedback,
              cited_sources, judge_scores, provider, timestamp
         FROM interaction_audit`,
    )
    .all() as Array<{
    decision: "answered" | "escalated";
    decision_reason: string;
    detected_intent: string | null;
    parent_feedback: "up" | "down" | null;
    cited_sources: string;
    judge_scores: string | null;
    provider: string | null;
    timestamp: string;
  }>;
  return rows.map((r) => ({
    decision: r.decision,
    decision_reason: r.decision_reason,
    detected_intent: r.detected_intent,
    parent_feedback: r.parent_feedback,
    cited_count: (JSON.parse(r.cited_sources) as string[]).length,
    groundedness: r.judge_scores
      ? ((JSON.parse(r.judge_scores) as { groundedness?: number }).groundedness ?? null)
      : null,
    provider: r.provider,
    timestamp: r.timestamp,
  }));
}

/** Write the async judge's scores onto an interaction (analysis/04 §7). */
export function setJudgeScores(
  db: Database,
  interactionId: string,
  scores: { groundedness: number; answer_relevancy: number },
): boolean {
  const res = db
    .prepare(`UPDATE interaction_audit SET judge_scores = ? WHERE id = ?`)
    .run(JSON.stringify(scores), interactionId);
  return res.changes > 0;
}

export interface AuditRecord {
  id: string;
  decision: "answered" | "escalated";
  decision_reason: string;
  parent_feedback: "up" | "down" | null;
  cited_sources: string[];
}

export function getAudit(db: Database, id: string): AuditRecord | null {
  const row = db
    .prepare(
      `SELECT id, decision, decision_reason, parent_feedback, cited_sources
         FROM interaction_audit WHERE id = ?`,
    )
    .get(id) as
    | (Omit<AuditRecord, "cited_sources"> & { cited_sources: string })
    | undefined;
  if (!row) return null;
  return { ...row, cited_sources: JSON.parse(row.cited_sources) as string[] };
}

/** The conversation an interaction belongs to — for routing a staff relay. */
export function getAuditContext(
  db: Database,
  interactionId: string,
): { conversation_id: string; session_id: string } | null {
  const row = db
    .prepare(
      `SELECT conversation_id, session_id FROM interaction_audit WHERE id = ?`,
    )
    .get(interactionId) as
    | { conversation_id: string; session_id: string }
    | undefined;
  return row ?? null;
}

/** Record a parent 👍/👎 on the answer for this interaction (analysis/05 Tier 4). */
export function setParentFeedback(
  db: Database,
  interactionId: string,
  feedback: "up" | "down",
): boolean {
  const res = db
    .prepare(`UPDATE interaction_audit SET parent_feedback = ? WHERE id = ?`)
    .run(feedback, interactionId);
  return res.changes > 0;
}
