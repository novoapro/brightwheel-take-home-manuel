/**
 * `npm run eval` — run the golden regression set through the full pipeline and
 * gate on the safety-first thresholds (analysis/07 §3, build M2.5).
 *
 * This exercises the real answerer + judge, so it needs ANTHROPIC_API_KEY and
 * spends money — run it on prompt/model/provider changes and to tune τ / compare
 * providers. Uses a fresh in-memory DB so results aren't polluted by dev data.
 * Exits non-zero if the gate fails (CI-friendly).
 */
import { createMemoryDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";
import { ask } from "../src/lib/frontdesk";
import { getModel } from "../src/lib/model";
import { GOLDEN_CASES } from "../src/eval/golden";
import { scoreCase, summarize, gate, type ActualResult, type CaseScore } from "../src/eval/score";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "✗ ANTHROPIC_API_KEY is not set. The golden eval runs the real model and " +
        "needs a key. Set it and re-run `npm run eval`.",
    );
    process.exit(1);
  }

  const provider = (process.env.EVAL_PROVIDER as "claude" | "gemini") || "claude";
  const db = createMemoryDb();
  seedDatabase(db);
  const model = getModel(provider);

  console.log(`Running ${GOLDEN_CASES.length} golden cases through ${provider}…\n`);
  const scores: CaseScore[] = [];

  for (const gc of GOLDEN_CASES) {
    try {
      const d = await ask(db, { question: gc.question, model });
      const actual: ActualResult = {
        decision: d.decision,
        intent: d.intent,
        citations: d.citations,
        parent_message: d.parent_message,
      };
      const score = scoreCase(gc, actual);
      scores.push(score);
      const mark = score.pass ? "✓" : "✗";
      console.log(
        `${mark} ${gc.id.padEnd(20)} expect=${gc.expect.decision.padEnd(8)} got=${d.decision}${score.pass ? "" : `  [${score.klass}]`}`,
      );
    } catch (err) {
      console.log(`! ${gc.id.padEnd(20)} ERROR: ${(err as Error).message}`);
      scores.push({
        id: gc.id, category: gc.category, decisionCorrect: false, intentCorrect: false,
        citationCorrect: false, factsCorrect: false, pass: false,
        klass: gc.expect.decision === "relayed" ? "FN" : "FP",
      });
    }
  }

  const summary = summarize(GOLDEN_CASES, scores);
  const g = gate(summary);

  console.log("\n── Summary ─────────────────────────────");
  console.log(`Pass rate:          ${(summary.passRate * 100).toFixed(1)}% (${summary.passed}/${summary.total})`);
  console.log(`Decision accuracy:  ${(summary.decisionAccuracy * 100).toFixed(1)}%`);
  console.log(`Escalation recall:  ${(summary.escalationRecall * 100).toFixed(1)}%  (under-escalations: ${summary.underEscalations.join(", ") || "none"})`);
  console.log(`Escalation prec.:   ${(summary.escalationPrecision * 100).toFixed(1)}%`);
  console.log(`Fact accuracy:      ${(summary.factAccuracy * 100).toFixed(1)}%`);
  console.log(`Confusion (relay=+): TP=${summary.confusion.tp} FP=${summary.confusion.fp} FN=${summary.confusion.fn} TN=${summary.confusion.tn}`);
  console.log("─────────────────────────────────────────");
  console.log(g.ok ? "✓ GATE PASSED" : `✗ GATE FAILED:\n  - ${g.reasons.join("\n  - ")}`);

  process.exit(g.ok ? 0 : 1);
}

main();
