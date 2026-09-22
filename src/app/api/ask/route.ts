import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ask } from "@/lib/frontdesk";

// better-sqlite3 + the Anthropic SDK need the Node.js runtime (never Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M2 endpoint: parent question → grounded, guardrailed decision.
 * Returns { decision, parent_message, citations, checks{…} } — a wrong number
 * can never reach a parent (it routes to relay instead). Full chat UI + audit
 * logging land in M3.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      question?: unknown;
      history?: unknown;
    };
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { ok: false, error: "Missing 'question' (string) in request body." },
        { status: 400 },
      );
    }

    const result = await ask(getDb(), { question });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
