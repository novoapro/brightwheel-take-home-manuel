import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { computeDashboard } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator dashboard metrics (analysis/05) — hours saved, containment, gaps. */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  try {
    return NextResponse.json({ ok: true, metrics: computeDashboard(getDb()) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
