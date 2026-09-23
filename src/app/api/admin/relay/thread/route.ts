import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { buildRelayThread } from "@/lib/relay/thread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full conversation behind a live relay — the operator's context view. */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  try {
    const escalationId = new URL(request.url).searchParams.get("escalationId") ?? "";
    if (!escalationId) {
      return NextResponse.json({ ok: false, error: "Missing 'escalationId'." }, { status: 400 });
    }
    const thread = buildRelayThread(getDb(), escalationId);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "Escalation not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, thread });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
