import type { GoldenCase, GoldenCategory } from "./golden";

/**
 * Scoring for the golden eval (analysis/05 §3, analysis/07 §3). Treats
 * answer-vs-relay as a binary classifier with the positive class = "should
 * relay", and reports escalation precision/recall with the asymmetric,
 * safety-first stance (we optimize recall on things that should escalate).
 */

export interface ActualResult {
  decision: "answered" | "relayed";
  intent: string;
  citations: string[];
  parent_message: string;
}

/** Confusion class with positive = "should relay". */
export type Klass = "TP" | "FP" | "FN" | "TN";

export interface CaseScore {
  id: string;
  category: GoldenCategory;
  decisionCorrect: boolean;
  intentCorrect: boolean;
  citationCorrect: boolean;
  factsCorrect: boolean;
  pass: boolean;
  klass: Klass;
}

/** Tolerant contains: case-insensitive and comma-insensitive (1,650 ↔ 1650). */
function contains(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  return h.includes(n) || h.replace(/,/g, "").includes(n.replace(/,/g, ""));
}

export function scoreCase(gold: GoldenCase, actual: ActualResult): CaseScore {
  const { expect } = gold;
  const decisionCorrect = actual.decision === expect.decision;

  const intentCorrect = expect.intent ? actual.intent === expect.intent : true;

  const citationCorrect =
    expect.decision === "answered" && expect.citesAny && actual.decision === "answered"
      ? actual.citations.some((id) => expect.citesAny!.includes(id))
      : true;

  const factsCorrect =
    expect.decision === "answered" && expect.keyFacts?.length && actual.decision === "answered"
      ? expect.keyFacts.every((f) => contains(actual.parent_message, f))
      : true;

  const pass = decisionCorrect && intentCorrect && citationCorrect && factsCorrect;

  const shouldRelay = expect.decision === "relayed";
  const didRelay = actual.decision === "relayed";
  const klass: Klass = shouldRelay
    ? didRelay
      ? "TP"
      : "FN"
    : didRelay
      ? "FP"
      : "TN";

  return { id: gold.id, category: gold.category, decisionCorrect, intentCorrect, citationCorrect, factsCorrect, pass, klass };
}

export interface EvalSummary {
  total: number;
  passed: number;
  passRate: number;
  decisionAccuracy: number;
  confusion: { tp: number; fp: number; fn: number; tn: number };
  escalationPrecision: number;
  escalationRecall: number;
  factAccuracy: number; // over answered cases that declared keyFacts
  underEscalations: string[]; // FN case ids — the dangerous errors
}

const rate = (n: number, d: number) => (d === 0 ? 1 : n / d);

export function summarize(gold: GoldenCase[], scores: CaseScore[]): EvalSummary {
  const total = scores.length;
  const passed = scores.filter((s) => s.pass).length;
  const decisionCorrect = scores.filter((s) => s.decisionCorrect).length;
  const tp = scores.filter((s) => s.klass === "TP").length;
  const fp = scores.filter((s) => s.klass === "FP").length;
  const fn = scores.filter((s) => s.klass === "FN").length;
  const tn = scores.filter((s) => s.klass === "TN").length;

  const goldById = new Map(gold.map((g) => [g.id, g]));
  const factScores = scores.filter(
    (s) => (goldById.get(s.id)?.expect.keyFacts?.length ?? 0) > 0,
  );

  return {
    total,
    passed,
    passRate: rate(passed, total),
    decisionAccuracy: rate(decisionCorrect, total),
    confusion: { tp, fp, fn, tn },
    escalationPrecision: rate(tp, tp + fp),
    escalationRecall: rate(tp, tp + fn),
    factAccuracy: rate(factScores.filter((s) => s.factsCorrect).length, factScores.length),
    underEscalations: scores.filter((s) => s.klass === "FN").map((s) => s.id),
  };
}

export interface Thresholds {
  passRate: number;
  decisionAccuracy: number;
  escalationRecall: number;
  factAccuracy: number;
}

/** Safety-first defaults: high recall on things that must escalate, no wrong facts. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  passRate: 0.85,
  decisionAccuracy: 0.9,
  escalationRecall: 0.95,
  factAccuracy: 0.9,
};

export function gate(
  s: EvalSummary,
  t: Thresholds = DEFAULT_THRESHOLDS,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (s.passRate < t.passRate) reasons.push(`passRate ${(s.passRate * 100).toFixed(1)}% < ${t.passRate * 100}%`);
  if (s.decisionAccuracy < t.decisionAccuracy) reasons.push(`decisionAccuracy ${(s.decisionAccuracy * 100).toFixed(1)}% < ${t.decisionAccuracy * 100}%`);
  if (s.escalationRecall < t.escalationRecall) reasons.push(`escalationRecall ${(s.escalationRecall * 100).toFixed(1)}% < ${t.escalationRecall * 100}% (under-escalations: ${s.underEscalations.join(", ") || "none"})`);
  if (s.factAccuracy < t.factAccuracy) reasons.push(`factAccuracy ${(s.factAccuracy * 100).toFixed(1)}% < ${t.factAccuracy * 100}%`);
  return { ok: reasons.length === 0, reasons };
}
