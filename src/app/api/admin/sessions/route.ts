import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import {
  closeSession,
  getParentSession,
  listOpenSessions,
  sweepStaleSessions,
} from "@/lib/repo/sessions";
import { notifySessionsClosed } from "@/lib/relay/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open parent sessions for the operator console (analysis/11 §6). */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const db = getDb();
  // The console polls this — use it to sweep timed-out sessions and push the
  // close to those parents' live streams.
  notifySessionsClosed(sweepStaleSessions(db), "inactivity");
  const sessions = listOpenSessions(db).map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    lastActiveAt: s.last_active_at,
    createdAt: s.created_at,
  }));
  return NextResponse.json({ ok: true, sessions });
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
    if (closed) notifySessionsClosed([closed], "agent"); // push the reset to the parent
  }
  return NextResponse.json({ ok: true });
}
