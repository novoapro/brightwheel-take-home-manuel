import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { createConversation } from "./conversations";
import { insertAudit } from "./audit";
import { createEscalation } from "./escalations";
import {
  SESSION_TIMEOUT_MS,
  closeSession,
  createParentSession,
  findResumableSession,
  getParentSession,
  isSessionStale,
  listOpenSessions,
  listRatedSessions,
  listSessionsForConsole,
  setSessionRating,
  sweepStaleSessions,
  touchSession,
} from "./sessions";

let db: Database;
beforeEach(() => {
  db = createMemoryDb();
});

/** Create a session (with its conversation) for `email`. */
function open(email: string, name = "Jordan") {
  const id = `sess-${email}`;
  const convId = `conv-${email}`;
  createConversation(db, { id: convId, session_id: id, active_provider: "anthropic" });
  return createParentSession(db, { id, name, email, conversation_id: convId });
}

/** Force a session's last activity to `ms` ago. */
function setIdle(id: string, ms: number) {
  db.prepare(`UPDATE parent_sessions SET last_active_at = ? WHERE id = ?`).run(
    new Date(Date.now() - ms).toISOString(),
    id,
  );
}

describe("parent sessions (analysis/11 §6)", () => {
  it("creates an open session and resumes it by email", () => {
    const s = open("a@b.com");
    expect(s.status).toBe("open");
    const resumed = findResumableSession(db, "a@b.com");
    expect(resumed?.id).toBe(s.id);
    expect(resumed?.conversation_id).toBe(s.conversation_id);
  });

  it("does not resume a stale session, and closes it as inactivity", () => {
    const s = open("a@b.com");
    setIdle(s.id, SESSION_TIMEOUT_MS + 60_000);
    expect(findResumableSession(db, "a@b.com")).toBeNull();
    const after = getParentSession(db, s.id)!;
    expect(after.status).toBe("closed");
    expect(after.closed_reason).toBe("inactivity");
  });

  it("touch keeps a session alive; isSessionStale reflects the window", () => {
    const s = open("a@b.com");
    setIdle(s.id, SESSION_TIMEOUT_MS + 60_000);
    expect(isSessionStale(getParentSession(db, s.id)!)).toBe(true);
    touchSession(db, s.id);
    expect(isSessionStale(getParentSession(db, s.id)!)).toBe(false);
    expect(findResumableSession(db, "a@b.com")?.id).toBe(s.id);
  });

  it("agent/parent close is terminal — no resume afterwards", () => {
    const s = open("a@b.com");
    closeSession(db, s.id, "agent");
    expect(getParentSession(db, s.id)!.closed_reason).toBe("agent");
    expect(findResumableSession(db, "a@b.com")).toBeNull();
    // touch is a no-op on a closed session
    touchSession(db, s.id);
    expect(getParentSession(db, s.id)!.status).toBe("closed");
  });

  it("records a session-level rating + review, even after the session closed", () => {
    const s = open("a@b.com");
    closeSession(db, s.id, "parent");
    const updated = setSessionRating(db, s.id, { rating: "down", review: "  too slow  " });
    expect(updated?.rating).toBe("down");
    expect(updated?.review).toBe("too slow"); // trimmed
    expect(updated?.rated_at).toBeTruthy();
    expect(setSessionRating(db, "nope", { rating: "up" })).toBeNull();
  });

  it("listRatedSessions returns only rated sessions", () => {
    const a = open("a@b.com");
    const b = open("b@b.com");
    open("c@b.com"); // unrated — excluded
    setSessionRating(db, a.id, { rating: "up" });
    setSessionRating(db, b.id, { rating: "down", review: "meh" });
    const rated = listRatedSessions(db);
    expect(rated).toHaveLength(2);
    expect(rated.map((r) => r.rating).sort()).toEqual(["down", "up"]);
  });

  it("listSessionsForConsole lists all sessions (active first) with relay counts", () => {
    const active = open("active@b.com");
    const closed = open("closed@b.com");
    // Give the closed one a waiting escalation (a pending live relay).
    insertAudit(db, {
      id: "i1",
      session_id: closed.id,
      conversation_id: closed.conversation_id!,
      parent_question: "?",
      detected_intent: "out_of_scope",
      decision: "escalated",
      decision_reason: "out_of_scope",
    });
    createEscalation(db, {
      id: "e1",
      interaction_id: "i1",
      question: "?",
      detected_intent: "out_of_scope",
      reason: "out_of_scope",
    });
    closeSession(db, closed.id, "parent");

    const rows = listSessionsForConsole(db);
    expect(rows.map((r) => r.id)).toEqual([active.id, closed.id]); // active first
    const c = rows.find((r) => r.id === closed.id)!;
    expect(c.status).toBe("closed");
    expect(c.waitingRelays).toBe(1);
    expect(c.interactions).toBe(1);
    expect(rows.find((r) => r.id === active.id)!.waitingRelays).toBe(0);
  });

  it("sweep + listOpenSessions drop timed-out sessions", () => {
    const fresh = open("fresh@b.com");
    const stale = open("stale@b.com");
    setIdle(stale.id, SESSION_TIMEOUT_MS + 1000);
    const closed = sweepStaleSessions(db);
    expect(closed.map((s) => s.id)).toEqual([stale.id]);
    const open_ = listOpenSessions(db);
    expect(open_.map((s) => s.id)).toEqual([fresh.id]);
  });
});
