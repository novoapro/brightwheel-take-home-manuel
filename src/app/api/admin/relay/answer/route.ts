import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { answerRelay } from "@/lib/relay/answer";
import { getEmailSender } from "@/lib/email/sender";
import { markEscalationDelivered } from "@/lib/repo/escalations";
import { getCenter } from "@/lib/repo/center";
import { getSettings } from "@/lib/repo/settings";
import { type Intent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator answers a waiting escalation. The reply relays into the parent's
 * thread live (via the bus → SSE), marked "✓ From our team"; on capture it also
 * becomes a citable KnowledgeEntry so the front desk answers it next time.
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
    // Categories are operator-configurable, so accept any non-empty token.
    const captureIntentRaw =
      typeof body.captureIntent === "string"
        ? body.captureIntent.trim().toLowerCase()
        : "";
    const captureIntent = captureIntentRaw
      ? (captureIntentRaw as Intent)
      : undefined;

    // Attribution: the client sends the operator's name; if it's blank, fall
    // back to the persisted on-duty operator (analysis/11 §4.5) before
    // answerRelay's generic "Front Desk Team" safety net.
    const bodyAnsweredBy = typeof body.answeredBy === "string" ? body.answeredBy.trim() : "";
    const answeredBy = bodyAnsweredBy || getSettings(getDb()).operator_name;

    const result = answerRelay(getDb(), {
      escalationId,
      answer,
      answeredBy,
      capture,
      captureIntent,
      captureTitle: typeof body.captureTitle === "string" ? body.captureTitle : undefined,
    });

    // Away follow-up: deliver the answer by (simulated) email instead of the SSE
    // bus, then mark it delivered (analysis/11 §4.4). Live relays already streamed.
    let emailed = false;
    if (result.delivery === "email" && result.contactEmail) {
      const center = getCenter(getDb());
      await getEmailSender().send({
        to: result.contactEmail,
        subject: `A reply from ${center?.name ?? "the front desk"}`,
        body: answer,
      });
      markEscalationDelivered(getDb(), escalationId);
      emailed = true;
    }

    return NextResponse.json({ ok: true, ...result, emailed });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
