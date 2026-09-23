import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { sendRelayMessage } from "@/lib/relay/answer";
import { getSettings } from "@/lib/repo/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator sends a mid-relay message to gather context, WITHOUT resolving the
 * escalation (it stays in the queue). Streams to the parent live via the bus.
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const escalationId = typeof body.escalationId === "string" ? body.escalationId : "";
    const text = typeof body.text === "string" ? body.text : "";
    if (!escalationId || !text.trim()) {
      return NextResponse.json(
        { ok: false, error: "Require 'escalationId' and non-empty 'text'." },
        { status: 400 },
      );
    }
    const bodyAnsweredBy = typeof body.answeredBy === "string" ? body.answeredBy.trim() : "";
    const answeredBy = bodyAnsweredBy || getSettings(getDb()).operator_name;
    const result = sendRelayMessage(getDb(), { escalationId, text, answeredBy });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
