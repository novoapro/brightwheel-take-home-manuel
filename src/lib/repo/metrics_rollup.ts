import type { Database } from "better-sqlite3";

/**
 * The durable Dashboard rollup (analysis/05). The Dashboard reads these bounded
 * daily buckets instead of scanning `interaction_audit`, so the raw per-turn rows
 * exist only for auditing and can be deleted when audit isn't collecting — the
 * metrics still stand.
 *
 * Kept current by incremental folds (`foldTurn` per turn, `foldGroundedness` when
 * the async judge scores, `foldCsat` on a rating) and rebuildable from whatever
 * raw rows remain via `recomputeMetrics` (used at seed + a one-time backfill).
 */

const dayOf = (iso: string) => iso.slice(0, 10); // YYYY-MM-DD (UTC)

/** Fold one answered/escalated turn into today's bucket. Always called — the
 *  rollup is independent of the audit-retention setting. */
export function foldTurn(
  db: Database,
  turn: {
    timestamp: string;
    intent: string | null;
    provider: string | null;
    decision: "answered" | "escalated";
    decision_reason: string;
    cited_count: number;
  },
): void {
  const answered = turn.decision === "answered" ? 1 : 0;
  db.prepare(
    `INSERT INTO metrics_daily
       (day, intent, provider, answered, escalated, out_of_scope, answered_with_source)
     VALUES (@day, @intent, @provider, @answered, @escalated, @out_of_scope, @answered_with_source)
     ON CONFLICT(day, intent, provider) DO UPDATE SET
       answered = answered + excluded.answered,
       escalated = escalated + excluded.escalated,
       out_of_scope = out_of_scope + excluded.out_of_scope,
       answered_with_source = answered_with_source + excluded.answered_with_source`,
  ).run({
    day: dayOf(turn.timestamp),
    intent: turn.intent ?? "out_of_scope",
    provider: turn.provider ?? "unknown",
    answered,
    escalated: answered ? 0 : 1,
    out_of_scope: turn.decision_reason === "out_of_scope" ? 1 : 0,
    answered_with_source: answered && turn.cited_count > 0 ? 1 : 0,
  });
}

/** Fold an async judge groundedness score into its turn's bucket. */
export function foldGroundedness(
  db: Database,
  bucket: { timestamp: string; intent: string | null; provider: string | null },
  groundedness: number,
): void {
  db.prepare(
    `INSERT INTO metrics_daily (day, intent, provider, groundedness_sum, groundedness_n)
     VALUES (@day, @intent, @provider, @g, 1)
     ON CONFLICT(day, intent, provider) DO UPDATE SET
       groundedness_sum = groundedness_sum + excluded.groundedness_sum,
       groundedness_n = groundedness_n + 1`,
  ).run({
    day: dayOf(bucket.timestamp),
    intent: bucket.intent ?? "out_of_scope",
    provider: bucket.provider ?? "unknown",
    g: groundedness,
  });
}

/** Fold a session-level rating into the CSAT rollup. */
export function foldCsat(db: Database, ratedAt: string, rating: "up" | "down"): void {
  db.prepare(
    `INSERT INTO metrics_csat_daily (day, up, down)
     VALUES (@day, @up, @down)
     ON CONFLICT(day) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`,
  ).run({ day: dayOf(ratedAt), up: rating === "up" ? 1 : 0, down: rating === "down" ? 1 : 0 });
}

/**
 * Rebuild both rollups from whatever raw rows still exist. Idempotent. Used at
 * seed and as a one-time backfill for DBs created before the rollup existed —
 * NOT in steady state (raw rows may have been pruned once folded).
 */
export function recomputeMetrics(db: Database): void {
  db.prepare(`DELETE FROM metrics_daily`).run();
  db.prepare(`DELETE FROM metrics_csat_daily`).run();
  db.exec(`
    INSERT INTO metrics_daily
      (day, intent, provider, answered, escalated, out_of_scope,
       answered_with_source, groundedness_sum, groundedness_n)
    SELECT substr(timestamp, 1, 10) AS day,
           COALESCE(detected_intent, 'out_of_scope') AS intent,
           COALESCE(provider, 'unknown') AS provider,
           SUM(decision = 'answered'),
           SUM(decision = 'escalated'),
           SUM(decision_reason = 'out_of_scope'),
           SUM(decision = 'answered' AND json_array_length(cited_sources) > 0),
           COALESCE(SUM(json_extract(judge_scores, '$.groundedness')), 0),
           SUM(judge_scores IS NOT NULL AND json_extract(judge_scores, '$.groundedness') IS NOT NULL)
      FROM interaction_audit
     GROUP BY day, intent, provider;

    INSERT INTO metrics_csat_daily (day, up, down)
    SELECT substr(rated_at, 1, 10), SUM(rating = 'up'), SUM(rating = 'down')
      FROM parent_sessions
     WHERE rating IS NOT NULL AND rated_at IS NOT NULL
     GROUP BY substr(rated_at, 1, 10);
  `);
}

/** True when the rollup has never been populated but raw rows exist — the
 *  one-time backfill trigger for a pre-rollup database. */
export function metricsNeedBackfill(db: Database): boolean {
  const m = db.prepare(`SELECT COUNT(*) AS n FROM metrics_daily`).get() as { n: number };
  if (m.n > 0) return false;
  const a = db.prepare(`SELECT COUNT(*) AS n FROM interaction_audit`).get() as { n: number };
  return a.n > 0;
}

export interface RollupIntent {
  intent: string;
  answered: number;
  escalated: number;
}
export interface RollupProvider {
  provider: string;
  total: number;
  answered: number;
  groundednessSum: number;
  groundednessN: number;
}
export interface DashboardRollup {
  answered: number;
  escalated: number;
  outOfScope: number;
  answeredWithSource: number;
  groundednessSum: number;
  groundednessN: number;
  thumbsUp: number;
  thumbsDown: number;
  byIntent: RollupIntent[];
  byProvider: RollupProvider[];
}

/** Read the rollup, summed over the window [start, now] (null start = all-time). */
export function readRollup(db: Database, start: Date | null): DashboardRollup {
  const day = start ? start.toISOString().slice(0, 10) : null;
  const where = day ? `WHERE day >= @day` : "";

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(answered),0) AS answered,
              COALESCE(SUM(escalated),0) AS escalated,
              COALESCE(SUM(out_of_scope),0) AS outOfScope,
              COALESCE(SUM(answered_with_source),0) AS answeredWithSource,
              COALESCE(SUM(groundedness_sum),0) AS groundednessSum,
              COALESCE(SUM(groundedness_n),0) AS groundednessN
         FROM metrics_daily ${where}`,
    )
    .get({ day }) as Omit<DashboardRollup, "thumbsUp" | "thumbsDown" | "byIntent" | "byProvider">;

  const byIntent = db
    .prepare(
      `SELECT intent, SUM(answered) AS answered, SUM(escalated) AS escalated
         FROM metrics_daily ${where}
        GROUP BY intent ORDER BY intent`,
    )
    .all({ day }) as RollupIntent[];

  const byProvider = db
    .prepare(
      `SELECT provider,
              SUM(answered + escalated) AS total,
              SUM(answered) AS answered,
              SUM(groundedness_sum) AS groundednessSum,
              SUM(groundedness_n) AS groundednessN
         FROM metrics_daily ${where}
        GROUP BY provider ORDER BY provider`,
    )
    .all({ day }) as RollupProvider[];

  const csat = db
    .prepare(
      `SELECT COALESCE(SUM(up),0) AS up, COALESCE(SUM(down),0) AS down
         FROM metrics_csat_daily ${day ? `WHERE day >= @day` : ""}`,
    )
    .get({ day }) as { up: number; down: number };

  return { ...totals, thumbsUp: csat.up, thumbsDown: csat.down, byIntent, byProvider };
}
