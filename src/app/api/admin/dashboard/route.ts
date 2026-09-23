import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { computeDashboard, isTimeRange } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator dashboard metrics (analysis/05) — hours saved, containment, gaps. */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  try {
    const raw = new URL(request.url).searchParams.get("range");
    const range = isTimeRange(raw) ? raw : "week";
    return NextResponse.json({ ok: true, range, metrics: computeDashboard(getDb(), range) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
