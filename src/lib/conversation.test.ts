import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "./db";
import { seedDatabase } from "./seed";
import { handleTurn } from "./conversation";
import { getAudit, setParentFeedback } from "./repo/audit";
import { getDebugEnvelope } from "./repo/debug";
import { updateSettings } from "./repo/settings";
import { listWaitingEscalations } from "./repo/escalations";
import { listMessages } from "./repo/messages";
import type {
  FrontDeskModel,
  GroundedAnswerInput,
  GroundedResult,
  JudgeResult,
  Msg,
} from "./model/types";

class FakeModel implements FrontDeskModel {
  readonly provider = "anthropic" as const;
  readonly answererModel = "fake-answerer";
  lastHistory: Msg[] = [];
  constructor(private result: GroundedResult) {}
  async groundedAnswer(input: GroundedAnswerInput): Promise<GroundedResult> {
    this.lastHistory = input.messages;
    return this.result;
  }
  async judgeGroundedness(): Promise<JudgeResult> {
    return { groundedness: 0.95, answer_relevancy: 1 };
  }
}

const answered = (): GroundedResult => ({
  intent: "hours",
  is_case_specific: false,
  sensitive_category: null,
  grounding_confidence: 0.95,
  citations: ["hours.late_pickup"],
  answer_intent: "answer",
  parent_message: "Late pickup is $15 per occurrence.",
});

const relayedCase = (): GroundedResult => ({
  intent: "health",
  is_case_specific: true,
  sensitive_category: "health",
  grounding_confidence: 0.9,
  citations: ["health.illness_exclusion"],
  answer_intent: "escalate",
  parent_message: "Let me check with our team on your child's situation.",
});

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
  seedDatabase(db);
});

describe("handleTurn — answered", () => {
  it("persists parent + grounded messages, an audit, and no escalation", async () => {
    const r = await handleTurn(db, {
      question: "What if I'm late?",
      model: new FakeModel(answered()),
    });

    expect(r.decision).toBe("answered");
    expect(r.reason).toBe("grounded");
    expect(r.message.provenance).toBe("grounded");
    expect(r.message.citations.map((c) => c.id)).toEqual(["hours.late_pickup"]);
    expect(r.message.citations[0].title).toBeTruthy(); // resolved for the chip
    expect(r.message.escalationId).toBeNull();

    const msgs = listMessages(db, r.conversationId);
    expect(msgs.map((m) => m.role)).toEqual(["parent", "frontdesk"]);
    expect(msgs[0].text).toBe("What if I'm late?");
    expect(msgs[1].provenance).toBe("grounded");
    expect(msgs[1].citations).toEqual(["hours.late_pickup"]);

    const audit = getAudit(db, r.interactionId)!;
    expect(audit.decision).toBe("answered");
    expect(audit.decision_reason).toBe("grounded");
    expect(audit.cited_sources).toEqual(["hours.late_pickup"]);

    expect(listWaitingEscalations(db)).toHaveLength(0);
  });
});

describe("handleTurn — relayed", () => {
  it("creates a holding message + waiting escalation + escalated audit", async () => {
    const r = await handleTurn(db, {
      question: "My son had a fever — can he come in?",
      model: new FakeModel(relayedCase()),
    });

    expect(r.decision).toBe("relayed");
    expect(r.reason).toBe("sensitive:case_specific");
    expect(r.message.provenance).toBeNull();
    expect(r.message.citations).toEqual([]); // holding message shows no chip
    expect(r.message.escalationId).toBeTruthy();

    const msgs = listMessages(db, r.conversationId);
    expect(msgs).toHaveLength(2);
    expect(msgs[1].escalation_id).toBe(r.message.escalationId);
    expect(msgs[1].provenance).toBeNull();

    const audit = getAudit(db, r.interactionId)!;
    expect(audit.decision).toBe("escalated");

    const waiting = listWaitingEscalations(db);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].interaction_id).toBe(r.interactionId);
    expect(waiting[0].reason).toBe("sensitive:case_specific");
    expect(waiting[0].status).toBe("waiting");
  });
});

describe("handleTurn — multi-turn", () => {
  it("appends to the same conversation and forwards prior turns as history", async () => {
    const first = await handleTurn(db, {
      question: "When are you open?",
      model: new FakeModel(answered()),
    });

    const model2 = new FakeModel(answered());
    const second = await handleTurn(db, {
      question: "And on weekends?",
      conversationId: first.conversationId,
      model: model2,
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.sessionId).toBe(first.sessionId);

    const convoCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM conversations`).get() as { n: number }
    ).n;
    expect(convoCount).toBe(1);

    expect(listMessages(db, first.conversationId)).toHaveLength(4);
    // The 2 prior messages were forwarded to the model as history.
    expect(model2.lastHistory.length).toBe(3); // 2 prior + the new question
    expect(model2.lastHistory.at(-1)?.content).toBe("And on weekends?");
    expect(model2.lastHistory[0].role).toBe("user");
  });
});

describe("handleTurn — audit envelope capture (analysis/05 §2)", () => {
  it("captures the prompt + raw model proposal when audit is on", async () => {
    updateSettings(db, { developer_mode: true, audit_mode: "flagged" });
    const r = await handleTurn(db, {
      question: "What if I'm late?",
      model: new FakeModel(answered()),
    });
    const env = getDebugEnvelope(db, r.interactionId)!;
    expect(env).not.toBeNull();
    expect((env.system_prompt ?? "").length).toBeGreaterThan(0); // the cached prefix we sent
    expect(env.messages.at(-1)?.content).toBe("What if I'm late?");
    expect(env.raw_proposal).toMatchObject({ citations: ["hours.late_pickup"] });
  });

  it("collects nothing when audit_mode is off", async () => {
    updateSettings(db, { developer_mode: true, audit_mode: "off" });
    const r = await handleTurn(db, {
      question: "What if I'm late?",
      model: new FakeModel(answered()),
    });
    expect(getDebugEnvelope(db, r.interactionId)).toBeNull();
  });

  it("collects nothing when developer mode is off (even if audit_mode = all)", async () => {
    updateSettings(db, { developer_mode: false, audit_mode: "all" });
    const r = await handleTurn(db, {
      question: "What if I'm late?",
      model: new FakeModel(answered()),
    });
    expect(getDebugEnvelope(db, r.interactionId)).toBeNull();
  });
});

describe("feedback", () => {
  it("records 👍/👎 against the interaction", async () => {
    const r = await handleTurn(db, {
      question: "What if I'm late?",
      model: new FakeModel(answered()),
    });
    expect(getAudit(db, r.interactionId)!.parent_feedback).toBeNull();

    expect(setParentFeedback(db, r.interactionId, "up")).toBe(true);
    expect(getAudit(db, r.interactionId)!.parent_feedback).toBe("up");

    expect(setParentFeedback(db, "nope", "down")).toBe(false);
  });
});
