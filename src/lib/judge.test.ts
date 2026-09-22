import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "./db";
import { seedDatabase } from "./seed";
import { judgeInteraction } from "./judge";
import { insertAudit, listAuditMetrics } from "./repo/audit";
import { createConversation } from "./repo/conversations";
import type {
  FrontDeskModel,
  GroundedResult,
  JudgeResult,
} from "./model/types";

class JudgeFake implements FrontDeskModel {
  readonly provider = "claude" as const;
  readonly answererModel = "fake";
  calls = 0;
  constructor(private scores: JudgeResult) {}
  async groundedAnswer(): Promise<GroundedResult> {
    throw new Error("not used");
  }
  async judgeGroundedness(): Promise<JudgeResult> {
    this.calls++;
    return this.scores;
  }
}

let db: Database;
let interactionId: string;

beforeEach(() => {
  db = createMemoryDb();
  seedDatabase(db);
  const conversationId = randomUUID();
  createConversation(db, { id: conversationId, session_id: "s", active_provider: "claude" });
  interactionId = randomUUID();
  insertAudit(db, {
    id: interactionId,
    session_id: "s",
    conversation_id: conversationId,
    parent_question: "How much is tuition?",
    detected_intent: "tuition",
    decision: "answered",
    decision_reason: "grounded",
    cited_sources: ["tuition.rates"],
  });
});

describe("judgeInteraction (async groundedness)", () => {
  it("scores an answered interaction and records it on the audit", async () => {
    const model = new JudgeFake({ groundedness: 0.93, answer_relevancy: 0.9 });
    const scores = await judgeInteraction(
      db,
      { interactionId, question: "How much is tuition?", answer: "$1,650/mo.", citationIds: ["tuition.rates"] },
      model,
    );
    expect(scores?.groundedness).toBe(0.93);
    const row = listAuditMetrics(db).find(() => true);
    // the audit we inserted now carries a groundedness score
    const scored = listAuditMetrics(db).filter((r) => r.groundedness != null);
    expect(scored).toHaveLength(1);
    expect(scored[0].groundedness).toBe(0.93);
    expect(model.calls).toBe(1);
    void row;
  });

  it("does nothing (and skips the model) when there are no citations", async () => {
    const model = new JudgeFake({ groundedness: 1, answer_relevancy: 1 });
    const scores = await judgeInteraction(
      db,
      { interactionId, question: "q", answer: "a", citationIds: [] },
      model,
    );
    expect(scores).toBeNull();
    expect(model.calls).toBe(0);
    expect(listAuditMetrics(db).filter((r) => r.groundedness != null)).toHaveLength(0);
  });
});
