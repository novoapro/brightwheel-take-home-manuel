import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { createConversation } from "./conversations";
import { createParentSession, setSessionRating } from "./sessions";
import { insertAudit } from "./audit";
import { appendMessage } from "./messages";
import {
  countRetainedEnvelopes,
  insertDebugEnvelope,
  purgeDebugEnvelopes,
} from "./debug";
import { getSessionAuditDetail, listSessionsForAudit } from "./audit_view";
import type { GroundedResult } from "../model/types";

const PROPOSAL: GroundedResult = {
  intent: "hours",
  is_case_specific: false,
  sensitive_category: null,
  grounding_confidence: 0.9,
  citations: ["hours.regular"],
  answer_intent: "answer",
  parent_message: "We open at 7.",
};

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

/** A session with one answered interaction; optionally a retained envelope. */
function seed(sid: string, opts: { rating?: "up" | "down"; envelope?: boolean } = {}) {
  const conv = `c-${sid}`;
  createConversation(db, { id: conv, session_id: sid, active_provider: "anthropic" });
  createParentSession(db, { id: sid, name: sid, email: `${sid}@x.com`, conversation_id: conv });
  const interactionId = `i-${sid}`;
  appendMessage(db, { id: `m-${sid}-q`, conversation_id: conv, role: "parent", text: "When do you open?" });
  appendMessage(db, {
    id: `m-${sid}-a`,
    conversation_id: conv,
    role: "frontdesk",
    provenance: "grounded",
    text: "We open at 7.",
  });
  insertAudit(db, {
    id: interactionId,
    session_id: sid,
    conversation_id: conv,
    parent_question: "When do you open?",
    detected_intent: "hours",
    decision: "answered",
    decision_reason: "grounded",
  });
  if (opts.envelope) {
    insertDebugEnvelope(db, {
      interaction_id: interactionId,
      system_prompt: "sys",
      messages: [{ role: "user", content: "When do you open?" }],
      raw_proposal: PROPOSAL,
    });
  }
  if (opts.rating) setSessionRating(db, sid, { rating: opts.rating });
  return interactionId;
}

describe("audit view (analysis/05 §5)", () => {
  it("only lists sessions with retained detail; 'flagged' excludes 👍", () => {
    seed("up", { rating: "up", envelope: true });
    seed("down", { rating: "down", envelope: true });
    seed("unrated", { envelope: true });
    seed("nodetail", { rating: "down" }); // no envelope → not shown at all

    const all = listSessionsForAudit(db, "all");
    expect(all.map((s) => s.session_id).sort()).toEqual(["down", "unrated", "up"]);

    const flagged = listSessionsForAudit(db, "flagged");
    expect(flagged.map((s) => s.session_id).sort()).toEqual(["down", "unrated"]);
  });

  it("drops a session from the view once its detail is removed", () => {
    seed("down", { rating: "down", envelope: true });
    expect(listSessionsForAudit(db, "all").map((s) => s.session_id)).toEqual(["down"]);
    // Removing the troubleshooting detail (not the session) hides it from Audit.
    purgeDebugEnvelopes(db, "all");
    expect(listSessionsForAudit(db, "all")).toHaveLength(0);
  });

  it("aggregates per-session counts and retained-envelope counts", () => {
    seed("down", { rating: "down", envelope: true });
    const row = listSessionsForAudit(db, "all").find((s) => s.session_id === "down")!;
    expect(row.interactions).toBe(1);
    expect(row.answered).toBe(1);
    expect(row.escalated).toBe(0);
    expect(row.retained).toBe(1);
    expect(row.rating).toBe("down");
  });

  it("detail joins transcript + audit + envelope (present or null)", () => {
    seed("down", { rating: "down", envelope: true });
    seed("up", { rating: "up" }); // pruned → no envelope

    const withEnv = getSessionAuditDetail(db, "down")!;
    expect(withEnv.messages).toHaveLength(2);
    expect(withEnv.interactions).toHaveLength(1);
    expect(withEnv.interactions[0].envelope).not.toBeNull();
    expect(withEnv.interactions[0].envelope!.raw_proposal).toMatchObject({ intent: "hours" });

    const noEnv = getSessionAuditDetail(db, "up")!;
    expect(noEnv.interactions[0].envelope).toBeNull();

    expect(getSessionAuditDetail(db, "missing")).toBeNull();
  });

  it("purge('all') clears every envelope and reports the count", () => {
    seed("a", { envelope: true });
    seed("b", { envelope: true });
    expect(countRetainedEnvelopes(db)).toBe(2);
    expect(purgeDebugEnvelopes(db, "all")).toBe(2);
    expect(countRetainedEnvelopes(db)).toBe(0);
  });

  it("purge('rated_up') clears only 👍 sessions' envelopes", () => {
    seed("up", { rating: "up", envelope: true });
    seed("down", { rating: "down", envelope: true });
    expect(purgeDebugEnvelopes(db, "rated_up")).toBe(1);
    expect(countRetainedEnvelopes(db)).toBe(1); // the 👎 one remains
  });
});
