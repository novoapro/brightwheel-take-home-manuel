import type { Database } from "better-sqlite3";
import {
  listAuditMetrics,
  type AuditMetricRow,
} from "./repo/audit";
import {
  listAllEscalations,
  listWaitingEscalations,
} from "./repo/escalations";
import { countCapturedPolicies } from "./repo/policies";
import type { Escalation } from "./repo/escalations";

/**
 * Dashboard metrics (analysis/05) — the operator's 10-second read. All computed
 * over the immutable audit log + escalations, no analytics infra. The hero is
 * hours saved (the ROI number a busy owner funds).
 */

/**
 * Assumed staff time to handle one routine inquiry by phone/email, used to turn
 * deflected interactions into hours saved. 6 minutes is a defensible midpoint
 * for a front-desk FAQ (pick up, look up the handbook, answer, log). Surfaced in
 * the response so the figure is transparent, not a hidden constant.
 */
export const AVG_HANDLE_MINUTES = 6;

export interface TopGap {
  question: string;
  count: number;
  intent: string | null;
  reason: string;
}

export interface DashboardMetrics {
  total: number;
  answered: number;
  escalated: number;
  containmentRate: number; // answered / total
  escalationRate: number; // escalated / total
  coverageGapRate: number; // out_of_scope / total
  attributionRate: number; // answered w/ ≥1 cited source / answered
  groundedness: number | null; // avg async-judge groundedness, null if none scored
  hoursSaved: number;
  avgHandleMinutes: number;
  thumbsUp: number;
  thumbsDown: number;
  capturedPolicies: number;
  waiting: number;
  topGaps: TopGap[];
  byIntent: { intent: string; answered: number; escalated: number }[];
  /** A/B slice — only present when more than one provider has handled traffic. */
  byProvider: ProviderSlice[];
}

export interface ProviderSlice {
  provider: string;
  total: number;
  containmentRate: number;
  groundedness: number | null;
}

function providerSlices(audits: AuditMetricRow[]): ProviderSlice[] {
  const map = new Map<string, AuditMetricRow[]>();
  for (const a of audits) {
    const key = a.provider ?? "unknown";
    (map.get(key) ?? map.set(key, []).get(key)!).push(a);
  }
  if (map.size < 2) return []; // no A/B to show with a single provider
  return [...map.entries()]
    .map(([provider, rows]) => {
      const answered = rows.filter((r) => r.decision === "answered").length;
      const scored = rows.filter((r) => r.groundedness != null);
      return {
        provider,
        total: rows.length,
        containmentRate: ratio(answered, rows.length),
        groundedness:
          scored.length === 0
            ? null
            : scored.reduce((s, r) => s + (r.groundedness ?? 0), 0) / scored.length,
      };
    })
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

const normalizeQuestion = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");
const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

/**
 * Pure aggregation over audit rows + escalations. Separated from I/O so it's
 * exhaustively testable with synthetic inputs.
 */
export function aggregate(
  audits: AuditMetricRow[],
  escalations: Escalation[],
  capturedPolicies: number,
  waiting: number,
  avgHandleMinutes = AVG_HANDLE_MINUTES,
): DashboardMetrics {
  const total = audits.length;
  const answered = audits.filter((a) => a.decision === "answered").length;
  const escalated = total - answered;
  const outOfScope = audits.filter(
    (a) => a.decision_reason === "out_of_scope",
  ).length;
  const answeredWithSource = audits.filter(
    (a) => a.decision === "answered" && a.cited_count > 0,
  ).length;
  const scored = audits.filter((a) => a.groundedness != null);
  const groundedness =
    scored.length === 0
      ? null
      : scored.reduce((sum, a) => sum + (a.groundedness ?? 0), 0) / scored.length;

  // Top knowledge gaps: recurring questions the handbook doesn't cover. Exclude
  // case-specific/sensitive relays — those are never "add a policy" candidates.
  const gapCounts = new Map<string, TopGap>();
  for (const e of escalations) {
    if (e.reason.startsWith("sensitive:")) continue;
    const key = normalizeQuestion(e.question);
    const existing = gapCounts.get(key);
    if (existing) existing.count += 1;
    else
      gapCounts.set(key, {
        question: e.question,
        count: 1,
        intent: e.detected_intent,
        reason: e.reason,
      });
  }
  const topGaps = [...gapCounts.values()]
    .sort((a, b) => b.count - a.count || a.question.localeCompare(b.question))
    .slice(0, 5);

  const byIntentMap = new Map<string, { answered: number; escalated: number }>();
  for (const a of audits) {
    const intent = a.detected_intent ?? "out_of_scope";
    const row = byIntentMap.get(intent) ?? { answered: 0, escalated: 0 };
    if (a.decision === "answered") row.answered += 1;
    else row.escalated += 1;
    byIntentMap.set(intent, row);
  }
  const byIntent = [...byIntentMap.entries()]
    .map(([intent, v]) => ({ intent, ...v }))
    .sort((a, b) => a.intent.localeCompare(b.intent));

  return {
    total,
    answered,
    escalated,
    containmentRate: ratio(answered, total),
    escalationRate: ratio(escalated, total),
    coverageGapRate: ratio(outOfScope, total),
    attributionRate: ratio(answeredWithSource, answered),
    groundedness,
    hoursSaved: (answered * avgHandleMinutes) / 60,
    avgHandleMinutes,
    thumbsUp: audits.filter((a) => a.parent_feedback === "up").length,
    thumbsDown: audits.filter((a) => a.parent_feedback === "down").length,
    capturedPolicies,
    waiting,
    topGaps,
    byIntent,
    byProvider: providerSlices(audits),
  };
}

export function computeDashboard(
  db: Database,
  avgHandleMinutes = AVG_HANDLE_MINUTES,
): DashboardMetrics {
  return aggregate(
    listAuditMetrics(db),
    listAllEscalations(db),
    countCapturedPolicies(db),
    listWaitingEscalations(db).length,
    avgHandleMinutes,
  );
}
