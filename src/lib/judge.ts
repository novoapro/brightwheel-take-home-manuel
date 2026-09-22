import type { Database } from "better-sqlite3";
import { getModel } from "./model";
import type { FrontDeskModel } from "./model/types";
import { setJudgeScores } from "./repo/audit";
import { getPolicy } from "./repo/policies";

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
  model: FrontDeskModel = getModel(),
): Promise<{ groundedness: number; answer_relevancy: number } | null> {
  const citedPolicies = input.citationIds.flatMap((id) => {
    const p = getPolicy(db, id);
    return p ? [p] : [];
  });
  if (citedPolicies.length === 0) return null; // nothing grounded to judge

  const scores = await model.judgeGroundedness({
    question: input.question,
    answer: input.answer,
    citedPolicies,
  });
  setJudgeScores(db, input.interactionId, scores);
  return scores;
}
