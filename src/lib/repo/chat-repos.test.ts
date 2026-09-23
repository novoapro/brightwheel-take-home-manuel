import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { seedDatabase } from "../seed";
import { createConversation, getConversation } from "./conversations";
import { appendMessage, listMessages } from "./messages";
import { getAudit, insertAudit } from "./audit";
import { createEscalation, listWaitingEscalations } from "./escalations";

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
  seedDatabase(db);
});

function convo(): string {
  const id = randomUUID();
  createConversation(db, { id, session_id: "s1", active_provider: "anthropic" });
  return id;
}

describe("conversations repo", () => {
  it("creates and reads a conversation; missing → null", () => {
    const id = convo();
    expect(getConversation(db, id)?.session_id).toBe("s1");
    expect(getConversation(db, "nope")).toBeNull();
  });
});

describe("messages repo", () => {
  it("round-trips citations as an array and defaults to []", () => {
    const c = convo();
    const withCites = appendMessage(db, {
      id: randomUUID(),
      conversation_id: c,
      role: "frontdesk",
      provenance: "grounded",
      text: "Open 7–6.",
      citations: ["hours.regular", "hours.holidays.2026"],
    });
    expect(withCites.citations).toEqual(["hours.regular", "hours.holidays.2026"]);

    const parent = appendMessage(db, {
      id: randomUUID(),
      conversation_id: c,
      role: "parent",
      text: "hi",
    });
    expect(parent.citations).toEqual([]);
    expect(parent.provenance).toBeNull();
  });

  it("lists messages in insertion order even within one millisecond", () => {
    const c = convo();
    for (const t of ["a", "b", "c", "d"]) {
      appendMessage(db, {
        id: randomUUID(),
        conversation_id: c,
        role: "parent",
        text: t,
      });
    }
    expect(listMessages(db, c).map((m) => m.text)).toEqual(["a", "b", "c", "d"]);
  });

  it("enforces the conversation foreign key", () => {
    expect(() =>
      appendMessage(db, {
        id: randomUUID(),
        conversation_id: "ghost",
        role: "parent",
        text: "hi",
      }),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe("audit repo", () => {
  it("stores a turn and updates parent feedback", () => {
    const c = convo();
    const id = randomUUID();
    insertAudit(db, {
      id,
      session_id: "s1",
      conversation_id: c,
      parent_question: "hours?",
      detected_intent: "hours",
      decision: "answered",
      decision_reason: "grounded",
      cited_sources: ["hours.regular"],
      checks: { citation_valid: "pass" },
    });
    const a = getAudit(db, id)!;
    expect(a.decision).toBe("answered");
    expect(a.cited_sources).toEqual(["hours.regular"]);
    expect(a.parent_feedback).toBeNull();
  });
});

describe("escalations repo", () => {
  it("creates a waiting escalation linked to its interaction", () => {
    const c = convo();
    const auditId = randomUUID();
    insertAudit(db, {
      id: auditId,
      session_id: "s1",
      conversation_id: c,
      parent_question: "fever?",
      detected_intent: "health",
      decision: "escalated",
      decision_reason: "sensitive:case_specific",
    });
    const esc = createEscalation(db, {
      id: randomUUID(),
      interaction_id: auditId,
      question: "fever?",
      detected_intent: "health",
      reason: "sensitive:case_specific",
    });
    expect(esc.status).toBe("waiting");
    expect(listWaitingEscalations(db)).toHaveLength(1);
    expect(listWaitingEscalations(db)[0].interaction_id).toBe(auditId);
  });

  it("enforces the interaction foreign key", () => {
    expect(() =>
      createEscalation(db, {
        id: randomUUID(),
        interaction_id: "ghost-audit",
        question: "q",
        detected_intent: "out_of_scope",
        reason: "out_of_scope",
      }),
    ).toThrow(/FOREIGN KEY/i);
  });
});
