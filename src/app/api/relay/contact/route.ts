import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEscalation, setEscalationContact } from "@/lib/repo/escalations";
import { CONTACT_FIELD_MAX } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deliberately permissive shape check — not full RFC validation (analysis/11 §6).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parent captures where an Away follow-up should be sent (analysis/11 §4.3).
 * Only a waiting *email* escalation accepts a contact — a live relay never does.
 * Captured email is demo PII: validated, length-capped, and only used by the
 * simulated sender ([00 §8]).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const escalationId = typeof body.escalationId === "string" ? body.escalationId : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, CONTACT_FIELD_MAX) : "";
    const email = typeof body.email === "string" ? body.email.trim().slice(0, CONTACT_FIELD_MAX) : "";

    if (!escalationId || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { ok: false, error: "A valid email and escalationId are required." },
        { status: 400 },
      );
    }

    const esc = getEscalation(getDb(), escalationId);
    if (!esc || esc.delivery !== "email" || esc.status !== "waiting") {
      return NextResponse.json(
        { ok: false, error: "This request is no longer accepting a contact." },
        { status: 400 },
      );
    }

    setEscalationContact(getDb(), {
      id: escalationId,
      contact_name: name,
      contact_email: email,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
