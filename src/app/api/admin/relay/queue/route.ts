import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { buildRelayQueue } from "@/lib/relay/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator live-relay queue — waiting parents, oldest first (analysis/03 §4.2). */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  try {
    return NextResponse.json({ ok: true, queue: buildRelayQueue(getDb()) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
