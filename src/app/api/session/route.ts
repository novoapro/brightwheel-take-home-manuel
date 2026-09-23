import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { createConversation } from "@/lib/repo/conversations";
import { getEscalation } from "@/lib/repo/escalations";
import { listMessages } from "@/lib/repo/messages";
import { getEntry } from "@/lib/repo/knowledge";
import { resolveAvailability } from "@/lib/repo/settings";
import {
  closeSession,
  createParentSession,
  findResumableSession,
  getParentSession,
  touchSession,
  type SessionCloseReason,
} from "@/lib/repo/sessions";
import { CONTACT_FIELD_MAX } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Rehydrate a conversation into the client's chat-message shape (with citations). */
function historyFor(db: ReturnType<typeof getDb>, conversationId: string) {
  return listMessages(db, conversationId).map((m) => {
    if (m.role === "parent") {
      return { key: m.id, role: "you" as const, text: m.text };
    }
    const citations = m.citations.flatMap((id) => {
      const p = getEntry(db, id);
      return p ? [{ id: p.id, title: p.title, source: p.source }] : [];
    });
    const answeredBy = m.escalation_id
      ? getEscalation(db, m.escalation_id)?.answered_by ?? undefined
      : undefined;
    return {
      key: m.id,
      role: "frontdesk" as const,
      text: m.text,
      provenance: m.provenance ?? undefined,
      citations,
      answeredBy,
      escalationId: m.escalation_id ?? undefined,
    };
  });
}

/**
 * Start or resume a parent session (analysis/11 §6). Same email + an open,
 * non-stale session ⇒ log back in to that thread; otherwise a new session +
 * thread is created. Persisted server-side so it survives reloads and devices.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, CONTACT_FIELD_MAX) : "";
  const email =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase().slice(0, CONTACT_FIELD_MAX)
      : "";
  if (!name || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "A full name and a valid email are required." },
      { status: 400 },
    );
  }

  const db = getDb();

  const existing = findResumableSession(db, email);
  if (existing) {
    touchSession(db, existing.id);
    return NextResponse.json({
      ok: true,
      resumed: true,
      sessionId: existing.id,
      name: existing.name,
      email: existing.email,
      conversationId: existing.conversation_id,
      messages: existing.conversation_id ? historyFor(db, existing.conversation_id) : [],
    });
  }

  const sessionId = randomUUID();
  const conversationId = randomUUID();
  createConversation(db, {
    id: conversationId,
    session_id: sessionId,
    active_provider: resolveAvailability(db).active_provider,
  });
  createParentSession(db, { id: sessionId, name, email, conversation_id: conversationId });

  return NextResponse.json({
    ok: true,
    resumed: false,
    sessionId,
    name,
    email,
    conversationId,
    messages: [],
  });
}

/** Parent ends their own session from the chat CTA (analysis/11 §6). */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "Missing sessionId." }, { status: 400 });
  }
  const db = getDb();
  const s = getParentSession(db, sessionId);
  if (s && s.status === "open") {
    closeSession(db, sessionId, "parent" satisfies SessionCloseReason);
  }
  return NextResponse.json({ ok: true });
}
