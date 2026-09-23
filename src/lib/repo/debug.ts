import type { Database } from "better-sqlite3";
import type { GroundedResult, Msg } from "../model/types";

/**
 * The per-turn troubleshooting envelope (analysis/05 §2) — "what we sent the
 * model and what it proposed", stored in `interaction_debug`, isolated from the
 * hot `interaction_audit` table so retention is a cheap row delete.
 *
 * Captured on every turn unless audit is Off; kept or pruned at session close by
 * `applyRetention` (see ../retention), and purgeable on demand by the operator.
 */

export interface DebugEnvelopeInput {
  interaction_id: string;
  system_prompt: string;
  messages: Msg[];
  raw_proposal: GroundedResult;
}

export interface DebugEnvelope {
  interaction_id: string;
  system_prompt: string | null;
  messages: Msg[];
  raw_proposal: GroundedResult | null;
  created_at: string;
}

export function insertDebugEnvelope(db: Database, input: DebugEnvelopeInput): void {
  db.prepare(
    `INSERT INTO interaction_debug
       (interaction_id, system_prompt, messages, raw_proposal, created_at)
     VALUES (@interaction_id, @system_prompt, @messages, @raw_proposal, @created_at)
     ON CONFLICT(interaction_id) DO NOTHING`,
  ).run({
    interaction_id: input.interaction_id,
    system_prompt: input.system_prompt,
    messages: JSON.stringify(input.messages),
    raw_proposal: JSON.stringify(input.raw_proposal),
    created_at: new Date().toISOString(),
  });
}

export function getDebugEnvelope(
  db: Database,
  interactionId: string,
): DebugEnvelope | null {
  const row = db
    .prepare(`SELECT * FROM interaction_debug WHERE interaction_id = ?`)
    .get(interactionId) as
    | {
        interaction_id: string;
        system_prompt: string | null;
        messages: string | null;
        raw_proposal: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    interaction_id: row.interaction_id,
    system_prompt: row.system_prompt,
    messages: row.messages ? (JSON.parse(row.messages) as Msg[]) : [],
    raw_proposal: row.raw_proposal
      ? (JSON.parse(row.raw_proposal) as GroundedResult)
      : null,
    created_at: row.created_at,
  };
}

/** Delete every retained envelope for one session's interactions. */
export function pruneDebugForSession(db: Database, sessionId: string): number {
  const res = db
    .prepare(
      `DELETE FROM interaction_debug
        WHERE interaction_id IN
          (SELECT id FROM interaction_audit WHERE session_id = ?)`,
    )
    .run(sessionId);
  return res.changes;
}

/**
 * Operator-driven purge (analysis/05 §5) to reclaim space, independent of the
 * per-session retention rule.
 *   all      — delete every retained envelope.
 *   rated_up — delete only envelopes for sessions the parent rated 👍 (the ones
 *              least worth keeping), leaving 👎/unrated sessions to review.
 */
export type PurgeScope = "all" | "rated_up";

export function purgeDebugEnvelopes(db: Database, scope: PurgeScope): number {
  if (scope === "all") {
    return db.prepare(`DELETE FROM interaction_debug`).run().changes;
  }
  return db
    .prepare(
      `DELETE FROM interaction_debug
        WHERE interaction_id IN (
          SELECT ia.id FROM interaction_audit ia
            JOIN parent_sessions ps ON ps.id = ia.session_id
          WHERE ps.rating = 'up'
        )`,
    )
    .run().changes;
}

/** How many envelopes are currently retained — shown before/after a purge. */
export function countRetainedEnvelopes(db: Database): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM interaction_debug`)
    .get() as { n: number };
  return row.n;
}
