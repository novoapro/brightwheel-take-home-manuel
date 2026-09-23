import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "./db";
import { applyRetention, hasWaitingRelay, removeSession, removeSessions } from "./retention";
import { createConversation } from "./repo/conversations";
import { closeSession, createParentSession, getParentSession, setSessionRating } from "./repo/sessions";
import { insertAudit, getAudit } from "./repo/audit";
import { createEscalation } from "./repo/escalations";
import { appendMessage, listMessages } from "./repo/messages";
import { getDebugEnvelope, insertDebugEnvelope } from "./repo/debug";
import { updateSettings } from "./repo/settings";
import type { GroundedResult } from "./model/types";

const PROPOSAL: GroundedResult = {
  intent: "hours",
  is_case_specific: false,
  sensitive_category: null,
  grounding_confidence: 0.95,
  citations: ["hours.regular"],
  answer_intent: "answer",
  parent_message: "We open at 7.",
};

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

/** A session with one answered interaction + transcript + a retained envelope. */
function seed(sid = "s1"): string {
  const conv = `c-${sid}`;
  createConversation(db, { id: conv, session_id: sid, active_provider: "anthropic" });
  createParentSession(db, { id: sid, name: "P", email: `${sid}@x.com`, conversation_id: conv });
  const interactionId = `i-${sid}`;
  appendMessage(db, { id: `m-${sid}-q`, conversation_id: conv, role: "parent", text: "When do you open?" });
  appendMessage(db, { id: `m-${sid}-a`, conversation_id: conv, role: "frontdesk", provenance: "grounded", text: "7am" });
  insertAudit(db, {
    id: interactionId,
    session_id: sid,
    conversation_id: conv,
    parent_question: "When do you open?",
    detected_intent: "hours",
    decision: "answered",
    decision_reason: "grounded",
  });
  insertDebugEnvelope(db, {
    interaction_id: interactionId,
    system_prompt: "sys",
    messages: [{ role: "user", content: "When do you open?" }],
    raw_proposal: PROPOSAL,
  });
  return interactionId;
}

/** applyRetention only ever touches troubleshooting envelopes — never sessions. */
describe("applyRetention — envelope-only (analysis/05 §2)", () => {
  it("keeps everything under 'all'", () => {
    const id = seed();
    updateSettings(db, { developer_mode: true, audit_mode: "all" });
    setSessionRating(db, "s1", { rating: "up" });
    applyRetention(db, "s1");
    expect(getDebugEnvelope(db, id)).not.toBeNull();
  });

  it("under 'flagged', prunes a 👍 session's envelope but keeps the session", () => {
    const id = seed();
    updateSettings(db, { developer_mode: true, audit_mode: "flagged" });
    setSessionRating(db, "s1", { rating: "up" });
    applyRetention(db, "s1");
    expect(getDebugEnvelope(db, id)).toBeNull(); // envelope pruned
    expect(getAudit(db, id)).not.toBeNull(); // audit row kept
    expect(listMessages(db, "c-s1")).toHaveLength(2); // transcript kept
    expect(getParentSession(db, "s1")).not.toBeNull(); // session kept
  });

  it("under 'flagged', keeps a 👎 session's envelope", () => {
    const id = seed();
    updateSettings(db, { developer_mode: true, audit_mode: "flagged" });
    setSessionRating(db, "s1", { rating: "down" });
    applyRetention(db, "s1");
    expect(getDebugEnvelope(db, id)).not.toBeNull();
  });

  it("under 'off' (or dev off), prunes the envelope but keeps the session + chat", () => {
    const id = seed();
    updateSettings(db, { developer_mode: true, audit_mode: "off" });
    applyRetention(db, "s1");
    expect(getDebugEnvelope(db, id)).toBeNull(); // envelope gone
    expect(getAudit(db, id)).not.toBeNull(); // audit row kept
    expect(listMessages(db, "c-s1")).toHaveLength(2); // transcript kept
    expect(getParentSession(db, "s1")).not.toBeNull(); // session kept
  });
});

describe("removeSession — the Sessions-view cleanup (analysis/11 §6)", () => {
  it("refuses an ACTIVE (open) session", () => {
    const id = seed("open"); // still open
    expect(removeSession(db, "open")).toBe(false);
    expect(getParentSession(db, "open")).not.toBeNull();
    expect(getAudit(db, id)).not.toBeNull();
  });

  it("removes a closed session's full detail (metrics-safe)", () => {
    const id = seed("s1");
    closeSession(db, "s1", "parent");
    expect(removeSession(db, "s1")).toBe(true);
    expect(getParentSession(db, "s1")).toBeNull();
    expect(getAudit(db, id)).toBeNull();
    expect(getDebugEnvelope(db, id)).toBeNull();
    expect(listMessages(db, "c-s1")).toHaveLength(0);
  });

  it("refuses a closed session that still has a pending live relay", () => {
    const conv = "c-wait";
    createConversation(db, { id: conv, session_id: "wait", active_provider: "anthropic" });
    createParentSession(db, { id: "wait", name: "P", email: "w@x.com", conversation_id: conv });
    insertAudit(db, {
      id: "i-wait",
      session_id: "wait",
      conversation_id: conv,
      parent_question: "?",
      detected_intent: "out_of_scope",
      decision: "escalated",
      decision_reason: "out_of_scope",
    });
    createEscalation(db, {
      id: "e-wait",
      interaction_id: "i-wait",
      question: "?",
      detected_intent: "out_of_scope",
      reason: "out_of_scope",
    }); // status defaults to 'waiting'
    closeSession(db, "wait", "parent");

    expect(hasWaitingRelay(db, "wait")).toBe(true);
    expect(removeSession(db, "wait")).toBe(false);
    expect(getAudit(db, "i-wait")).not.toBeNull(); // untouched
  });

  it("removes a closed session with only a RESOLVED escalation (detaches it)", () => {
    const conv = "c-esc";
    createConversation(db, { id: conv, session_id: "esc", active_provider: "anthropic" });
    createParentSession(db, { id: "esc", name: "P", email: "e@x.com", conversation_id: conv });
    insertAudit(db, {
      id: "i-esc",
      session_id: "esc",
      conversation_id: conv,
      parent_question: "Do you offer part-time?",
      detected_intent: "out_of_scope",
      decision: "escalated",
      decision_reason: "out_of_scope",
    });
    createEscalation(db, {
      id: "e1",
      interaction_id: "i-esc",
      question: "Do you offer part-time?",
      detected_intent: "out_of_scope",
      reason: "out_of_scope",
    });
    db.prepare(`UPDATE escalations SET status = 'answered' WHERE id = 'e1'`).run();
    closeSession(db, "esc", "parent");

    expect(removeSession(db, "esc")).toBe(true);
    const e = db.prepare(`SELECT interaction_id, question FROM escalations WHERE id = 'e1'`).get() as {
      interaction_id: string | null;
      question: string;
    };
    expect(e.interaction_id).toBeNull(); // detached, but…
    expect(e.question).toBe("Do you offer part-time?"); // …still a gap record
  });

  it("removeSessions removes only the removable ones and reports skips", () => {
    seed("a");
    seed("b"); // stays open → skipped
    seed("c");
    closeSession(db, "a", "parent");
    closeSession(db, "c", "agent");
    const res = removeSessions(db, ["a", "b", "c"]);
    expect(res.removed).toBe(2);
    expect(res.skipped).toBe(1);
    expect(getParentSession(db, "b")).not.toBeNull(); // open → untouched
  });
});
