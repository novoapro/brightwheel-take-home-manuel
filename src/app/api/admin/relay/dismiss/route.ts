import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { dismissEscalation } from "@/lib/repo/escalations";
import { publishQueueCount } from "@/lib/relay/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator dismisses a waiting escalation that's no longer actionable (the
 * parent left, the thread went stale). It drops out of the queue without a reply
 * being relayed. Idempotent — a non-waiting escalation is a no-op.
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const escalationId = typeof body.escalationId === "string" ? body.escalationId : "";
    if (!escalationId) {
      return NextResponse.json({ ok: false, error: "Missing 'escalationId'." }, { status: 400 });
    }
    const dismissed = dismissEscalation(getDb(), escalationId);
    // Dropped from the waiting queue — push the fresh count to operators live.
    if (dismissed) publishQueueCount(getDb());
    return NextResponse.json({ ok: true, dismissed });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
