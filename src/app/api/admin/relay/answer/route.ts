import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { answerRelay } from "@/lib/relay/answer";
import { INTENTS, type Intent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator answers a waiting escalation. The reply relays into the parent's
 * thread live (via the bus → SSE), marked "✓ From our team"; on capture it also
 * becomes a citable PolicyRecord so the front desk answers it next time.
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const escalationId = typeof body.escalationId === "string" ? body.escalationId : "";
    const answer = typeof body.answer === "string" ? body.answer : "";
    if (!escalationId || !answer.trim()) {
      return NextResponse.json(
        { ok: false, error: "Require 'escalationId' and non-empty 'answer'." },
        { status: 400 },
      );
    }
    const capture = body.capture === true;
    const captureIntent =
      typeof body.captureIntent === "string" &&
      (INTENTS as readonly string[]).includes(body.captureIntent)
        ? (body.captureIntent as Intent)
        : undefined;

    const result = answerRelay(getDb(), {
      escalationId,
      answer,
      answeredBy: typeof body.answeredBy === "string" ? body.answeredBy : "",
      capture,
      captureIntent,
      captureTitle: typeof body.captureTitle === "string" ? body.captureTitle : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
