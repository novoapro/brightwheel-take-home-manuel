import type { Database } from "better-sqlite3";

/**
 * Parent sessions (analysis/11 §6): a persisted parent identity + chat thread,
 * keyed by email. A session stays open until the parent ends it, the agent
 * closes it, or 30 minutes of inactivity elapse. Returning with the same email
 * resumes the open session (and its thread).
 */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export type SessionCloseReason = "agent" | "inactivity" | "parent";

/** Session-level parent rating (analysis/05 Tier 4) — captured at close. */
export type SessionRating = "up" | "down";

export interface ParentSession {
  id: string;
  name: string;
  email: string;
  status: "open" | "closed";
  conversation_id: string | null;
  created_at: string;
  last_active_at: string;
  closed_at: string | null;
  closed_reason: SessionCloseReason | null;
  /** 👍/👎 the parent left when closing the session; null until rated. */
  rating: SessionRating | null;
  /** Optional free-text the parent left with the rating. */
  review: string | null;
  rated_at: string | null;
}

/** True when an open session has been idle past the inactivity window. */
export function isSessionStale(s: ParentSession): boolean {
  return Date.now() - Date.parse(s.last_active_at) > SESSION_TIMEOUT_MS;
}

export function getParentSession(db: Database, id: string): ParentSession | null {
  const row = db
    .prepare(`SELECT * FROM parent_sessions WHERE id = ?`)
    .get(id) as ParentSession | undefined;
  return row ?? null;
}

/**
 * Has the parent left this session? A relay only reaches a parent who's still
 * here — closed (ended it themselves / swept) or gone-stale means there's no
 * live thread to answer into, so the operator's reply should be collected as
 * knowledge instead. Unknown session (anonymous / not yet persisted) counts as
 * present — we don't assume someone left without evidence.
 */
export function hasParentLeft(db: Database, sessionId: string): boolean {
  const s = getParentSession(db, sessionId);
  return !!s && (s.status === "closed" || isSessionStale(s));
}

export function createParentSession(
  db: Database,
  input: { id: string; name: string; email: string; conversation_id: string },
): ParentSession {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO parent_sessions
       (id, name, email, status, conversation_id, created_at, last_active_at)
     VALUES (@id, @name, @email, 'open', @conversation_id, @created_at, @last_active_at)`,
  ).run({ ...input, created_at: now, last_active_at: now });
  return getParentSession(db, input.id)!;
}

/**
 * Close a session with a reason (agent CTA, parent CTA, or timeout sweep).
 * Returns the closed session (with its conversation_id) so callers can notify
 * the parent's live stream, or null if it was already closed/absent.
 */
export function closeSession(
  db: Database,
  id: string,
  reason: SessionCloseReason,
): ParentSession | null {
  const res = db
    .prepare(
      `UPDATE parent_sessions
          SET status = 'closed', closed_at = @closed_at, closed_reason = @reason
        WHERE id = @id AND status = 'open'`,
    )
    .run({ id, reason, closed_at: new Date().toISOString() });
  return res.changes > 0 ? getParentSession(db, id) : null;
}

/**
 * Record the parent's session-level rating (analysis/05 Tier 4). Set at close
 * from the rating popup; works whether the session is still open or already
 * closed (agent/inactivity closes rate on the parent's next presence). The
 * review is length-capped by the caller. Returns the updated session, or null
 * if it doesn't exist.
 */
export function setSessionRating(
  db: Database,
  id: string,
  input: { rating: SessionRating; review?: string | null },
): ParentSession | null {
  const res = db
    .prepare(
      `UPDATE parent_sessions
          SET rating = @rating, review = @review, rated_at = @rated_at
        WHERE id = @id`,
    )
    .run({
      id,
      rating: input.rating,
      review: input.review?.trim() || null,
      rated_at: new Date().toISOString(),
    });
  return res.changes > 0 ? getParentSession(db, id) : null;
}

/** Mark activity — keeps an open session alive. No-op on a closed session. */
export function touchSession(db: Database, id: string): void {
  db.prepare(
    `UPDATE parent_sessions SET last_active_at = @now WHERE id = @id AND status = 'open'`,
  ).run({ id, now: new Date().toISOString() });
}

/** Close every open session idle past the timeout; returns the closed sessions. */
export function sweepStaleSessions(db: Database): ParentSession[] {
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
  const stale = db
    .prepare(`SELECT * FROM parent_sessions WHERE status = 'open' AND last_active_at < ?`)
    .all(cutoff) as ParentSession[];
  if (stale.length === 0) return [];
  db.prepare(
    `UPDATE parent_sessions
        SET status = 'closed', closed_at = @now, closed_reason = 'inactivity'
      WHERE status = 'open' AND last_active_at < @cutoff`,
  ).run({ now: new Date().toISOString(), cutoff });
  return stale;
}

/**
 * The open, non-stale session for an email, if any — the "log back in" target.
 * Sweeps stale sessions first so a timed-out one never resumes.
 */
export function findResumableSession(db: Database, email: string): ParentSession | null {
  sweepStaleSessions(db);
  const row = db
    .prepare(
      `SELECT * FROM parent_sessions
        WHERE email = ? AND status = 'open'
        ORDER BY last_active_at DESC LIMIT 1`,
    )
    .get(email) as ParentSession | undefined;
  return row ?? null;
}

/** Rated sessions (for CSAT rollups, analysis/05 Tier 4) — rating + when. */
export function listRatedSessions(
  db: Database,
): { rating: SessionRating; rated_at: string }[] {
  return db
    .prepare(
      `SELECT rating, rated_at FROM parent_sessions
        WHERE rating IS NOT NULL AND rated_at IS NOT NULL`,
    )
    .all() as { rating: SessionRating; rated_at: string }[];
}

/** Open sessions for the operator's console (stale ones swept first). */
export function listOpenSessions(db: Database): ParentSession[] {
  sweepStaleSessions(db);
  return db
    .prepare(`SELECT * FROM parent_sessions WHERE status = 'open' ORDER BY last_active_at DESC`)
    .all() as ParentSession[];
}

/** A session row for the Sessions console — status + counts that decide whether
 *  it's safe to remove (active or with a pending live relay ⇒ not removable). */
export interface ConsoleSession {
  id: string;
  name: string;
  email: string;
  status: "open" | "closed";
  created_at: string;
  last_active_at: string;
  closed_reason: SessionCloseReason | null;
  interactions: number;
  waitingRelays: number;
}

/**
 * Every session for the operator console — active first, then most-recent. Stale
 * ones are swept to closed first, so "active" reflects reality.
 */
export function listSessionsForConsole(db: Database): ConsoleSession[] {
  sweepStaleSessions(db);
  return db
    .prepare(
      `SELECT ps.id, ps.name, ps.email, ps.status, ps.created_at, ps.last_active_at,
              ps.closed_reason,
              (SELECT COUNT(*) FROM interaction_audit ia WHERE ia.session_id = ps.id) AS interactions,
              (SELECT COUNT(*) FROM escalations e
                 JOIN interaction_audit ia ON ia.id = e.interaction_id
                WHERE ia.session_id = ps.id AND e.status = 'waiting') AS waitingRelays
         FROM parent_sessions ps
        ORDER BY (ps.status = 'open') DESC, ps.last_active_at DESC`,
    )
    .all() as ConsoleSession[];
}
