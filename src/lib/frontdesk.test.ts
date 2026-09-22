import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "./db";
import { seedDatabase } from "./seed";
import { ask } from "./frontdesk";
import type {
  FrontDeskModel,
  GroundedAnswerInput,
  GroundedResult,
  JudgeResult,
} from "./model/types";

/** A fake model so orchestration is tested with zero network / API cost. */
class FakeModel implements FrontDeskModel {
  readonly provider = "claude" as const;
  readonly answererModel = "fake-answerer";
  lastSystem = "";
  constructor(
    private result: GroundedResult,
    private groundedness = 0.95,
  ) {}
  async groundedAnswer(input: GroundedAnswerInput): Promise<GroundedResult> {
    this.lastSystem = input.system;
    return this.result;
  }
  async judgeGroundedness(): Promise<JudgeResult> {
    return { groundedness: this.groundedness, answer_relevancy: 1 };
  }
}

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
  seedDatabase(db);
});

describe("ask (orchestration)", () => {
  it("returns a grounded, answered decision for a valid answer", async () => {
    const model = new FakeModel({
      intent: "hours",
      is_case_specific: false,
      sensitive_category: null,
      grounding_confidence: 0.95,
      citations: ["hours.late_pickup"],
      answer_intent: "answer",
      parent_message: "Late pickup is $15 per occurrence.",
    });
    const r = await ask(db, { question: "What if I'm late?", model });
    expect(r.decision).toBe("answered");
    expect(r.reason).toBe("grounded");
    expect(r.citations).toEqual(["hours.late_pickup"]);
    expect(r.provider).toBe("claude");
    expect(r.model).toBe("fake-answerer");
  });

  it("relays (never shows) a fact-wrong answer end-to-end", async () => {
    const model = new FakeModel({
      intent: "hours",
      is_case_specific: false,
      sensitive_category: null,
      grounding_confidence: 0.95,
      citations: ["hours.late_pickup"],
      answer_intent: "answer",
      parent_message: "Late pickup is $25 per occurrence.",
    });
    const r = await ask(db, { question: "What if I'm late?", model });
    expect(r.decision).toBe("relayed");
    expect(r.reason).toBe("fact_mismatch");
    expect(r.parent_message).not.toContain("$25");
  });

  it("passes the full policy-grounded system prefix to the model", async () => {
    const model = new FakeModel({
      intent: "hours",
      is_case_specific: false,
      sensitive_category: null,
      grounding_confidence: 0.95,
      citations: ["hours.regular"],
      answer_intent: "answer",
      parent_message: "We're open Monday through Friday.",
    });
    await ask(db, { question: "When are you open?", model });
    expect(model.lastSystem).toContain("[hours.regular]");
    expect(model.lastSystem).toContain("Little Acorns");
  });

  it("throws a clear error if the center isn't seeded", async () => {
    const empty = createMemoryDb();
    const model = new FakeModel({
      intent: "hours",
      is_case_specific: false,
      sensitive_category: null,
      grounding_confidence: 0.95,
      citations: ["hours.regular"],
      answer_intent: "answer",
      parent_message: "Open.",
    });
    await expect(ask(empty, { question: "hi", model })).rejects.toThrow(/seed/i);
  });
});
