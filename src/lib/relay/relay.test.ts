import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { seedDatabase } from "../seed";
import { handleTurn } from "../conversation";
import { buildSystemPrefix } from "../model/prompt";
import { getCenter } from "../repo/center";
import {
  dismissEscalation,
  getEscalation,
  setEscalationContact,
} from "../repo/escalations";
import { updateSettings } from "../repo/settings";
import { createConversation } from "../repo/conversations";
import { closeSession, createParentSession } from "../repo/sessions";
import { getEntry, listPublishedEntries } from "../repo/knowledge";
import { listMessages } from "../repo/messages";
import { isAdmin } from "../admin";
import { getRelayBus, type QueueChangedEvent, type StaffMessageEvent } from "./bus";
import { answerRelay, sendRelayMessage } from "./answer";
import { buildRelayQueue } from "./queue";
import { buildRelayThread } from "./thread";
import { buildCapturedPolicy, captureDefaultFor, keywordsFromQuestion } from "./capture";
import type {
  FrontDeskModel,
  GroundedAnswerInput,
  GroundedResult,
  JudgeResult,
} from "../model/types";

class FakeModel implements FrontDeskModel {
  readonly provider = "anthropic" as const;
  readonly answererModel = "fake-answerer";
  constructor(private result: GroundedResult) {}
  async groundedAnswer(_input: GroundedAnswerInput): Promise<GroundedResult> {
    void _input;
    return this.result;
  }
  async judgeGroundedness(): Promise<JudgeResult> {
    return { groundedness: 0.95, answer_relevancy: 1 };
  }
}

const outOfScope = (): GroundedResult => ({
  intent: "out_of_scope",
  is_case_specific: false,
  sensitive_category: null,
  grounding_confidence: 0,
  citations: [],
  answer_intent: "escalate",
  parent_message: "Let me check with our team.",
});

const caseSpecific = (): GroundedResult => ({
  intent: "health",
  is_case_specific: true,
  sensitive_category: "health",
  grounding_confidence: 0.9,
  citations: ["health.illness_exclusion"],
  answer_intent: "escalate",
  parent_message: "Let me check with our team on your child.",
});

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
  seedDatabase(db);
});

/** Create a waiting escalation by running a relayed parent turn. */
async function relayTurn(model: FrontDeskModel) {
  return handleTurn(db, { question: "Do you offer part-time schedules?", model });
}

describe("capture helpers", () => {
  it("defaults capture ON only for out-of-scope gaps", () => {
    expect(captureDefaultFor("out_of_scope")).toBe(true);
    expect(captureDefaultFor("sensitive:case_specific")).toBe(false);
    expect(captureDefaultFor("fact_mismatch")).toBe(false);
  });

  it("derives keywords, dropping stopwords and short tokens", () => {
    const kw = keywordsFromQuestion("Do you offer part-time schedules for toddlers?");
    expect(kw).toContain("offer");
    expect(kw).toContain("part");
    expect(kw).toContain("toddlers");
    expect(kw).not.toContain("you");
    expect(kw).not.toContain("do");
  });

  it("builds a published, captured policy from a staff answer", () => {
    const p = buildCapturedPolicy({
      intent: "hours",
      question: "Do you offer part-time?",
      answer: "Yes — up to 3 half-days a week.",
      answeredBy: "Maria",
      idSuffix: "abc12345",
    });
    expect(p.id).toBe("captured.hours.abc12345");
    expect(p.origin).toBe("captured");
    expect(p.status).toBe("published");
    expect(p.body_md).toContain("half-days");
  });
});

describe("answerRelay — the live relay loop", () => {
  it("appends a staff message, closes the escalation, and publishes live", async () => {
    const turn = await relayTurn(new FakeModel(outOfScope()));
    const escId = turn.message.escalationId!;

    const received: StaffMessageEvent[] = [];
    const off = getRelayBus().subscribe(turn.conversationId, (e) => {
      if (e.type === "staff_message") received.push(e);
    });

    const res = answerRelay(db, {
      escalationId: escId,
      answer: "Yes — we offer up to 3 half-days a week.",
      answeredBy: "Maria",
    });
    off();

    // published to the parent's live stream
    expect(received).toHaveLength(1);
    expect(received[0].message.text).toContain("half-days");
    expect(received[0].message.answeredBy).toBe("Maria");
    expect(received[0].conversationId).toBe(turn.conversationId);

    // persisted as a staff-provenance message in the thread
    const msgs = listMessages(db, turn.conversationId);
    const staff = msgs.find((m) => m.provenance === "staff");
    expect(staff?.text).toContain("half-days");
    expect(staff?.escalation_id).toBe(escId);

    // escalation closed, no capture
    const esc = getEscalation(db, escId)!;
    expect(esc.status).toBe("answered");
    expect(esc.answered_by).toBe("Maria");
    expect(esc.promoted_entry_id).toBeNull();
    expect(res.promotedEntryId).toBeNull();
  });

  it("captures the answer into a citable policy — deflection compounds", async () => {
    const turn = await relayTurn(new FakeModel(outOfScope()));
    const before = listPublishedEntries(db).length;

    const res = answerRelay(db, {
      escalationId: turn.message.escalationId!,
      answer: "Yes — we offer up to 3 half-days a week.",
      answeredBy: "Maria",
      capture: true,
      captureIntent: "hours",
    });

    expect(res.promotedEntryId).toBeTruthy();
    const captured = getEntry(db, res.promotedEntryId!)!;
    expect(captured.origin).toBe("captured");
    expect(captured.intent).toBe("hours");

    // it's now published, in the queue-answer's escalation link, and in the prefix
    expect(listPublishedEntries(db).length).toBe(before + 1);
    expect(getEscalation(db, turn.message.escalationId!)!.promoted_entry_id).toBe(
      res.promotedEntryId,
    );
    const prefix = buildSystemPrefix(getCenter(db)!, listPublishedEntries(db));
    expect(prefix).toContain(res.promotedEntryId!); // front desk can cite it next time
  });

  it("rejects answering an unknown or already-answered escalation", async () => {
    const turn = await relayTurn(new FakeModel(outOfScope()));
    expect(() => answerRelay(db, { escalationId: "ghost", answer: "hi", answeredBy: "M" })).toThrow(
      /not found/i,
    );
    answerRelay(db, { escalationId: turn.message.escalationId!, answer: "done", answeredBy: "M" });
    expect(() =>
      answerRelay(db, { escalationId: turn.message.escalationId!, answer: "again", answeredBy: "M" }),
    ).toThrow(/already/i);
  });
});

describe("sendRelayMessage — mid-relay context gathering", () => {
  it("appends a staff message and streams live WITHOUT resolving the escalation", async () => {
    const turn = await relayTurn(new FakeModel(outOfScope()));
    const escId = turn.message.escalationId!;

    const received: StaffMessageEvent[] = [];
    const off = getRelayBus().subscribe(turn.conversationId, (e) => {
      if (e.type === "staff_message") received.push(e);
    });

    sendRelayMessage(db, {
      escalationId: escId,
      text: "Happy to help — which classroom is your child in?",
      answeredBy: "Maria",
    });
    off();

    // streamed to the parent
    expect(received).toHaveLength(1);
    expect(received[0].message.text).toMatch(/which classroom/i);

    // persisted as staff provenance, but the escalation is STILL waiting
    const staff = listMessages(db, turn.conversationId).filter((m) => m.provenance === "staff");
    expect(staff).toHaveLength(1);
    expect(getEscalation(db, escId)!.status).toBe("waiting");
    expect(buildRelayQueue(db).some((q) => q.escalationId === escId)).toBe(true);
  });

  it("rejects an unknown or already-handled escalation", async () => {
    const turn = await relayTurn(new FakeModel(outOfScope()));
    expect(() =>
      sendRelayMessage(db, { escalationId: "ghost", text: "hi", answeredBy: "M" }),
    ).toThrow(/not found/i);
    answerRelay(db, { escalationId: turn.message.escalationId!, answer: "done", answeredBy: "M" });
    expect(() =>
      sendRelayMessage(db, { escalationId: turn.message.escalationId!, text: "more", answeredBy: "M" }),
    ).toThrow(/already/i);
  });
});

describe("queue_changed broadcast — the live nav badge (SSE, no polling)", () => {
  it("pushes the fresh waiting count on relay, answer, and dismiss", async () => {
    const counts: number[] = [];
    const off = getRelayBus().subscribeQueue((e: QueueChangedEvent) => counts.push(e.waiting));

    const a = await relayTurn(new FakeModel(outOfScope())); // → 1 waiting
    const b = await relayTurn(new FakeModel(outOfScope())); // → 2 waiting
    answerRelay(db, { escalationId: a.message.escalationId!, answer: "done", answeredBy: "M" }); // → 1
    dismissEscalation(db, b.message.escalationId!);
    // dismissEscalation is a pure repo write; the route publishes. Mirror that:
    const { publishQueueCount } = await import("./queue");
    publishQueueCount(db); // → 0
    off();

    expect(counts).toEqual([1, 2, 1, 0]);
  });

  it("stops delivering after unsubscribe", async () => {
    const counts: number[] = [];
    const off = getRelayBus().subscribeQueue((e) => counts.push(e.waiting));
    await relayTurn(new FakeModel(outOfScope()));
    expect(counts).toEqual([1]);
    off();
    await relayTurn(new FakeModel(outOfScope()));
    expect(counts).toEqual([1]); // no further delivery
  });
});

describe("dismissEscalation — 'session no longer active'", () => {
  it("drops a waiting escalation from the queue without an answer", async () => {
    const turn = await relayTurn(new FakeModel(outOfScope()));
    const escId = turn.message.escalationId!;

    expect(dismissEscalation(db, escId)).toBe(true);
    expect(getEscalation(db, escId)!.status).toBe("dismissed");
    expect(buildRelayQueue(db).some((q) => q.escalationId === escId)).toBe(false);

    // idempotent — a non-waiting escalation is a no-op
    expect(dismissEscalation(db, escId)).toBe(false);
  });
});

describe("buildRelayThread — the operator's context view", () => {
  it("transcribes the whole conversation and surfaces AI references", async () => {
    const turn = await relayTurn(new FakeModel(caseSpecific()));
    const thread = buildRelayThread(db, turn.message.escalationId!)!;

    expect(thread.status).toBe("waiting");
    expect(thread.isCaseSpecific).toBe(true);
    expect(thread.aiReferenced).toContain("When to Keep Your Child Home");

    // the parent's question and the AI hand-off are both in the transcript
    const parent = thread.messages.find((m) => m.role === "parent");
    expect(parent?.text).toMatch(/part-time/i);
    expect(thread.messages.some((m) => m.role === "frontdesk")).toBe(true);
  });

  it("shows staff replies added during the relay", async () => {
    const turn = await relayTurn(new FakeModel(outOfScope()));
    sendRelayMessage(db, {
      escalationId: turn.message.escalationId!,
      text: "Which days were you thinking?",
      answeredBy: "Maria",
    });
    const thread = buildRelayThread(db, turn.message.escalationId!)!;
    const staff = thread.messages.find((m) => m.provenance === "staff");
    expect(staff?.text).toMatch(/which days/i);
    expect(staff?.answeredBy).toBeNull(); // not resolved yet, so no answered_by
  });

  it("returns null for an unknown escalation", () => {
    expect(buildRelayThread(db, "ghost")).toBeNull();
  });
});

describe("parent left the session — collect knowledge instead of posting", () => {
  /** Run a relayed turn under a real, persisted parent session we can close. */
  async function relayWithSession(sessionId: string, conversationId: string) {
    createConversation(db, { id: conversationId, session_id: sessionId, active_provider: "anthropic" });
    createParentSession(db, { id: sessionId, name: "Sam", email: "sam@example.com", conversation_id: conversationId });
    return handleTurn(db, {
      question: "Do you offer part-time schedules?",
      model: new FakeModel(outOfScope()),
      sessionId,
      conversationId,
    });
  }

  it("answers → saves to knowledge, streams nothing, still resolves", async () => {
    const turn = await relayWithSession("s1", "c1");
    const escId = turn.message.escalationId!;
    closeSession(db, "s1", "parent"); // the parent leaves

    const received: StaffMessageEvent[] = [];
    const off = getRelayBus().subscribe(turn.conversationId, (e) => {
      if (e.type === "staff_message") received.push(e);
    });
    const res = answerRelay(db, {
      escalationId: escId,
      answer: "Yes — up to 3 half-days a week.",
      answeredBy: "Maria",
    });
    off();

    expect(res.posted).toBe(false);
    expect(res.collectedKnowledge).toBe(true);
    expect(res.promotedEntryId).toBeTruthy(); // collected as knowledge
    expect(received).toHaveLength(0); // nothing streamed to the gone parent
    expect(listMessages(db, "c1").some((m) => m.provenance === "staff")).toBe(false);
    expect(getEscalation(db, escId)!.status).toBe("answered"); // still resolved
  });

  it("still posts live when the parent is present", async () => {
    const turn = await relayWithSession("s2", "c2");
    const res = answerRelay(db, {
      escalationId: turn.message.escalationId!,
      answer: "Yes — up to 3 half-days a week.",
      answeredBy: "Maria",
    });
    expect(res.posted).toBe(true);
    expect(listMessages(db, "c2").some((m) => m.provenance === "staff")).toBe(true);
  });

  it("refuses a mid-relay context message once the parent has left", async () => {
    const turn = await relayWithSession("s3", "c3");
    closeSession(db, "s3", "parent");
    expect(() =>
      sendRelayMessage(db, { escalationId: turn.message.escalationId!, text: "Which days?", answeredBy: "M" }),
    ).toThrow(/left/i);
  });

  it("does not save a case-specific relay as general knowledge", async () => {
    createConversation(db, { id: "c5", session_id: "s5", active_provider: "anthropic" });
    createParentSession(db, { id: "s5", name: "Sam", email: "sam@example.com", conversation_id: "c5" });
    const cs = await handleTurn(db, {
      question: "My child has a fever, can she come?",
      model: new FakeModel(caseSpecific()),
      sessionId: "s5",
      conversationId: "c5",
    });
    closeSession(db, "s5", "parent");

    const res = answerRelay(db, {
      escalationId: cs.message.escalationId!,
      answer: "Please keep her home 24h after the fever breaks.",
      answeredBy: "Maria",
    });
    expect(res.posted).toBe(false);
    expect(res.collectedKnowledge).toBe(false); // a specific case is never general knowledge
    expect(res.promotedEntryId).toBeNull();
    expect(getEscalation(db, cs.message.escalationId!)!.status).toBe("answered");
  });

  it("reports parentPresent=false on the thread and queue after leaving", async () => {
    const turn = await relayWithSession("s6", "c6");
    const escId = turn.message.escalationId!;
    expect(buildRelayThread(db, escId)!.parentPresent).toBe(true);
    closeSession(db, "s6", "parent");
    expect(buildRelayThread(db, escId)!.parentPresent).toBe(false);
    expect(buildRelayQueue(db).find((q) => q.escalationId === escId)!.parentPresent).toBe(false);
  });
});

describe("Away mode — deferred escalation + email follow-up (analysis/11 §4.3)", () => {
  it("relays as an email follow-up (not live) with an honest holding message", async () => {
    updateSettings(db, { availability: "away" });
    const turn = await relayTurn(new FakeModel(outOfScope()));

    expect(turn.decision).toBe("relayed");
    expect(turn.message.delivery).toBe("email");
    // Honest holding text — no "real time" cue; pairs with the contact form.
    expect(turn.message.text).toMatch(/away right now/i);
    expect(turn.message.text).toMatch(/email/i);

    const esc = getEscalation(db, turn.message.escalationId!)!;
    expect(esc.delivery).toBe("email");
    expect(esc.contact_email).toBeNull();
  });

  it("grounded answers are unaffected by Away", async () => {
    updateSettings(db, { availability: "away" });
    const answered = (): GroundedResult => ({
      intent: "hours",
      is_case_specific: false,
      sensitive_category: null,
      grounding_confidence: 0.95,
      citations: ["hours.regular"],
      answer_intent: "answer",
      parent_message: "We're open 7am–6pm.",
    });
    const turn = await handleTurn(db, { question: "What are your hours?", model: new FakeModel(answered()) });
    expect(turn.decision).toBe("answered");
    expect(turn.message.delivery).toBeNull();
  });

  it("answers an email escalation without touching the live bus", async () => {
    updateSettings(db, { availability: "away" });
    const turn = await relayTurn(new FakeModel(outOfScope()));
    const escId = turn.message.escalationId!;
    setEscalationContact(db, { id: escId, contact_name: "Sam", contact_email: "sam@example.com" });

    const received: StaffMessageEvent[] = [];
    const off = getRelayBus().subscribe(turn.conversationId, (e) => {
      if (e.type === "staff_message") received.push(e);
    });
    const res = answerRelay(db, {
      escalationId: escId,
      answer: "Yes — up to 3 half-days a week.",
      answeredBy: "Maria",
    });
    off();

    expect(received).toHaveLength(0); // email path never publishes live
    expect(res.delivery).toBe("email");
    expect(res.contactEmail).toBe("sam@example.com");

    // the queue surfaces the captured contact
    const item = buildRelayQueue(db).find((q) => q.escalationId === escId);
    // (already answered → gone from waiting queue; refetch a fresh waiting one instead)
    expect(item).toBeUndefined();
  });

  it("surfaces delivery + captured contact in the relay queue", async () => {
    updateSettings(db, { availability: "away" });
    const turn = await relayTurn(new FakeModel(outOfScope()));
    setEscalationContact(db, {
      id: turn.message.escalationId!,
      contact_name: "Sam",
      contact_email: "sam@example.com",
    });
    const item = buildRelayQueue(db).find((q) => q.escalationId === turn.message.escalationId);
    expect(item?.delivery).toBe("email");
    expect(item?.contactEmail).toBe("sam@example.com");
  });
});

describe("buildRelayQueue", () => {
  it("enriches waiting items with references, case-specific flag, and capture default", async () => {
    await relayTurn(new FakeModel(caseSpecific())); // health, case-specific, cites illness policy
    await relayTurn(new FakeModel(outOfScope())); // gap

    const queue = buildRelayQueue(db);
    expect(queue).toHaveLength(2);

    const health = queue.find((q) => q.reason === "sensitive:case_specific")!;
    expect(health.isCaseSpecific).toBe(true);
    expect(health.captureDefault).toBe(false);
    expect(health.aiReferenced).toContain("When to Keep Your Child Home");

    const gap = queue.find((q) => q.reason === "out_of_scope")!;
    expect(gap.isCaseSpecific).toBe(false);
    expect(gap.captureDefault).toBe(true);
  });
});

describe("presence broadcast (analysis/11 §4.2)", () => {
  it("delivers presence events to every subscriber and stops after unsubscribe", () => {
    const bus = getRelayBus();
    const got: { availability: string; operatorName: string }[] = [];
    const off = bus.subscribePresence((e) =>
      got.push({ availability: e.availability, operatorName: e.operatorName }),
    );

    bus.publishPresence({
      type: "presence",
      availability: "away",
      operatorName: "Maria",
      awayMessage: "",
    });
    expect(got).toEqual([{ availability: "away", operatorName: "Maria" }]);

    off();
    bus.publishPresence({
      type: "presence",
      availability: "online",
      operatorName: "Diego",
      awayMessage: "",
    });
    expect(got).toHaveLength(1); // no delivery after unsubscribe
  });
});

describe("isAdmin", () => {
  const req = (code?: string) =>
    new Request("http://x/admin", {
      headers: code ? { "x-admin-passcode": code } : {},
    });

  it("accepts the configured passcode and rejects wrong/missing ones", () => {
    // default ADMIN_PASSCODE is "change-me" when the env var is unset
    expect(isAdmin(req("change-me"))).toBe(true);
    expect(isAdmin(req("wrong"))).toBe(false);
    expect(isAdmin(req())).toBe(false);
  });
});
