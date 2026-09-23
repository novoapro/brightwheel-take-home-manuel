import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import {
  closeSession,
  getParentSession,
  listSessionsForConsole,
  sweepStaleSessions,
} from "@/lib/repo/sessions";
import { notifySessionsClosed } from "@/lib/relay/notify";
import { applyRetention, removeSessions } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All parent sessions for the operator console (analysis/11 §6). */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const db = getDb();
  // The console polls this — use it to sweep timed-out sessions and push the
  // close to those parents' live streams.
  const swept = sweepStaleSessions(db);
  notifySessionsClosed(swept, "inactivity");
  // Apply retention to freshly timed-out sessions (drops their troubleshooting
  // envelopes when audit isn't collecting; a no-op otherwise).
  for (const s of swept) applyRetention(db, s.id);
  const sessions = listSessionsForConsole(db).map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    status: s.status,
    lastActiveAt: s.last_active_at,
    createdAt: s.created_at,
    closedReason: s.closed_reason,
    interactions: s.interactions,
    waitingRelays: s.waitingRelays,
    // A session is removable only when inactive AND not holding a pending relay.
    removable: s.status === "closed" && s.waitingRelays === 0,
  }));
  return NextResponse.json({ ok: true, sessions });
}

/**
 * Bulk-remove sessions to clean up data (analysis/11 §6). Server-enforced guards:
 * an ACTIVE session, or one with a pending live relay, is never removed. Metrics
 * live in the rollup, so removal never affects the Dashboard.
 */
export async function DELETE(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json().catch(() => ({}))) as { sessionIds?: unknown };
  const ids = Array.isArray(body.sessionIds)
    ? body.sessionIds.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "No sessionIds provided." }, { status: 400 });
  }
  const { removed, skipped } = removeSessions(getDb(), ids);
  return NextResponse.json({ ok: true, removed, skipped });
}

/** Agent closes a parent session from the desk. */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json()) as Record<string, unknown>;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "Missing sessionId." }, { status: 400 });
  }
  const db = getDb();
  const s = getParentSession(db, sessionId);
  if (s && s.status === "open") {
    const closed = closeSession(db, sessionId, "agent");
    if (closed) {
      notifySessionsClosed([closed], "agent"); // push the reset to the parent
      applyRetention(db, sessionId); // clean raw detail when audit isn't collecting
    }
  }
  return NextResponse.json({ ok: true });
}
