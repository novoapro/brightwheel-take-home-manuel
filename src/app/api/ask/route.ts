import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handleTurn } from "@/lib/conversation";

// better-sqlite3 + the Anthropic SDK need the Node.js runtime (never Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parent turn: question → grounded, guardrailed decision, persisted as a
 * conversation + messages + audit (+ a waiting escalation on relay). Returns
 * the assistant message, its citations/provenance, and the interaction id
 * (echoed back with 👍/👎). A wrong number never reaches the parent — it relays.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      question?: unknown;
      conversationId?: unknown;
      sessionId?: unknown;
    };
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { ok: false, error: "Missing 'question' (string) in request body." },
        { status: 400 },
      );
    }

    const result = await handleTurn(getDb(), {
      question,
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : undefined,
      sessionId:
        typeof body.sessionId === "string" ? body.sessionId : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
