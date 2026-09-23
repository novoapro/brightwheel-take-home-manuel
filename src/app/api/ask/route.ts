import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handleTurn } from "@/lib/conversation";
import { judgeInteraction } from "@/lib/judge";
import {
  closeSession,
  getParentSession,
  isSessionStale,
  touchSession,
} from "@/lib/repo/sessions";
import { applyRetention } from "@/lib/retention";

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

    const db = getDb();
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

    // Enforce the session: a closed or timed-out session can't post — the parent
    // is asked to sign in again (analysis/11 §6).
    if (sessionId) {
      const s = getParentSession(db, sessionId);
      if (!s || s.status === "closed" || isSessionStale(s)) {
        if (s && s.status === "open") {
          closeSession(db, s.id, "inactivity");
          applyRetention(db, s.id); // clean raw detail when audit isn't collecting
        }
        return NextResponse.json(
          { ok: false, sessionClosed: true, error: "Your session has ended." },
          { status: 409 },
        );
      }
    }

    const result = await handleTurn(db, {
      question,
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : undefined,
      sessionId,
    });

    if (sessionId) touchSession(db, sessionId); // keep the session alive on activity

    // Off the critical path: score groundedness for the dashboard (analysis/04 §7).
    // The always-on container keeps this promise alive after the response returns.
    if (result.decision === "answered" && result.message.citations.length > 0) {
      void judgeInteraction(db, {
        interactionId: result.interactionId,
        question,
        answer: result.message.text,
        citationIds: result.message.citations.map((c) => c.id),
      }).catch(() => {
        /* best-effort measurement — never affects the parent */
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
