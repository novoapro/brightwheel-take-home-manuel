import type { Database } from "better-sqlite3";
import { pruneDebugForSession } from "./repo/debug";
import { getParentSession } from "./repo/sessions";
import { effectiveAuditMode, getSettings } from "./repo/settings";

/**
 * Audit retention (analysis/05 §2). Two distinct, deliberately separated concerns:
 *
 *  1. **Troubleshooting detail** — the per-turn `interaction_debug` envelopes
 *     ("what we sent the model / what it returned"). This is the ONLY thing audit
 *     retention and the Audit tab ever remove. Sessions, transcripts and relays are
 *     never touched here, so we can't orphan an unanswered live relay. The metrics
 *     rollup is folded independently, so dropping envelopes never affects the
 *     Dashboard.
 *
 *  2. **Whole sessions** — removed only by an explicit operator action in the
 *     Sessions view (`removeSession`), and only for INACTIVE sessions with no
 *     pending live relay.
 *
 * `applyRetention` handles concern (1) on rating/close:
 *   all     — keep every session's envelopes.
 *   flagged — keep only sessions that did NOT get a 👍; prune the rest.
 *   off     — keep nothing: prune this session's envelopes.
 */
export function applyRetention(db: Database, sessionId: string): void {
  const mode = effectiveAuditMode(getSettings(db));
  if (mode === "all") return;
  if (mode === "off") {
    pruneDebugForSession(db, sessionId);
    return;
  }
  // flagged: a positive rating means this session no longer needs auditing.
  const session = getParentSession(db, sessionId);
  if (session?.rating === "up") pruneDebugForSession(db, sessionId);
}

/** True when a session has a still-waiting escalation (an unanswered live relay). */
export function hasWaitingRelay(db: Database, sessionId: string): boolean {
  const w = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM escalations e
         JOIN interaction_audit ia ON ia.id = e.interaction_id
        WHERE ia.session_id = ? AND e.status = 'waiting'`,
    )
    .get(sessionId) as { n: number };
  return w.n > 0;
}

/**
 * Fully remove ONE session's data (transcript, envelopes, audit rows, and the
 * session/conversation rows) — the Sessions-view "clean up" action. Guarded, so
 * we never lose live information:
 *   - refuses an ACTIVE (open) session;
 *   - refuses a session with a pending live relay (waiting escalation).
 * Escalations survive as standalone relay/gap records (their `interaction_id` is
 * nulled). Metrics are unaffected (they live in the rollup). Returns whether it
 * removed anything.
 */
export function removeSession(db: Database, sessionId: string): boolean {
  const s = getParentSession(db, sessionId);
  if (!s || s.status !== "closed") return false; // never an active session
  if (hasWaitingRelay(db, sessionId)) return false; // never a pending relay

  db.transaction(() => {
    db.prepare(
      `UPDATE escalations SET interaction_id = NULL
        WHERE interaction_id IN (SELECT id FROM interaction_audit WHERE session_id = ?)`,
    ).run(sessionId);
    db.prepare(
      `DELETE FROM interaction_debug
        WHERE interaction_id IN (SELECT id FROM interaction_audit WHERE session_id = ?)`,
    ).run(sessionId);
    if (s.conversation_id) {
      db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(s.conversation_id);
    }
    db.prepare(`DELETE FROM interaction_audit WHERE session_id = ?`).run(sessionId);
    if (s.conversation_id) {
      db.prepare(`DELETE FROM conversations WHERE id = ?`).run(s.conversation_id);
    }
    db.prepare(`DELETE FROM parent_sessions WHERE id = ?`).run(sessionId);
  })();
  return true;
}

/** Bulk version — removes the removable ones, reports how many were skipped. */
export function removeSessions(
  db: Database,
  sessionIds: string[],
): { removed: number; skipped: number } {
  let removed = 0;
  let skipped = 0;
  for (const id of sessionIds) {
    if (removeSession(db, id)) removed++;
    else skipped++;
  }
  return { removed, skipped };
}
