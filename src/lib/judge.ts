import type { Database } from "better-sqlite3";
import { getModel } from "./model";
import type { FrontDeskModel } from "./model/types";
import { setJudgeScores } from "./repo/audit";
import { getEntry } from "./repo/knowledge";
import { getSettings } from "./repo/settings";

/**
 * Async groundedness judge (analysis/04 §7, build M6). Runs the Haiku judge OFF
 * the parent's critical path after an answered turn and records the score on the
 * InteractionAudit, so the dashboard can report groundedness (the RAG-triad
 * number). Best-effort: any failure is swallowed by the caller's fire-and-forget.
 */
export async function judgeInteraction(
  db: Database,
  input: {
    interactionId: string;
    question: string;
    answer: string;
    citationIds: string[];
  },
  model?: FrontDeskModel,
): Promise<{ groundedness: number; answer_relevancy: number } | null> {
  const citedPolicies = input.citationIds.flatMap((id) => {
    const p = getEntry(db, id);
    return p ? [p] : [];
  });
  if (citedPolicies.length === 0) return null; // nothing grounded to judge

  // Judge on the configured provider, with its decrypted key (analysis/11 §3.4).
  const judge = model ?? getModel(getSettings(db).active_provider, db);
  const scores = await judge.judgeGroundedness({
    question: input.question,
    answer: input.answer,
    citedPolicies,
  });
  setJudgeScores(db, input.interactionId, scores);
  return scores;
}
