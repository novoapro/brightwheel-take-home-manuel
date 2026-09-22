import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setParentFeedback } from "@/lib/repo/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Record a parent 👍/👎 on an answered interaction (analysis/05 Tier 4 CSAT). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      interactionId?: unknown;
      feedback?: unknown;
    };
    const interactionId =
      typeof body.interactionId === "string" ? body.interactionId : "";
    const feedback = body.feedback === "up" || body.feedback === "down" ? body.feedback : null;
    if (!interactionId || !feedback) {
      return NextResponse.json(
        { ok: false, error: "Require 'interactionId' and 'feedback' ('up'|'down')." },
        { status: 400 },
      );
    }
    const updated = setParentFeedback(getDb(), interactionId, feedback);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Unknown interactionId." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
