"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INTENTS, type Intent } from "@/lib/types";
import { useKnowledgeIntents } from "./useKnowledgeIntents";

type PendingQuestion = {
  escalationId: string;
  question: string;
  intent: string | null;
  reason: string;
  isCaseSpecific: boolean;
  aiReferenced: string[];
  captureDefault: boolean;
  waitingSince: string;
};

type ThreadMessage = {
  id: string;
  role: "parent" | "frontdesk";
  provenance: "grounded" | "staff" | null;
  text: string;
  citations: { id: string; title: string }[];
  answeredBy: string | null;
  pendingEscalationId: string | null;
  createdAt: string;
};

type Thread = {
  sessionId: string | null;
  escalationId: string;
  status: "waiting" | "answered" | "dismissed";
  delivery: "live" | "email";
  parentName: string | null;
  parentEmail: string | null;
  parentPresent: boolean;
  pending: PendingQuestion[];
  messages: ThreadMessage[];
};

/**
 * The operator's side of a live relay, scoped to the whole session. The family's
 * chat is mirrored here; every question the front desk couldn't answer is flagged
 * in the transcript (⏳). One reply resolves the *whole* session — the operator
 * doesn't answer questions one by one. A plain "Send" keeps the relay open (e.g.
 * to ask a clarifying question). Saving to the knowledge base is opt-in: tap a
 * ⏳ question to mark it, and that question's answer becomes citable so the front
 * desk handles it next time; an unmarked reply collects nothing.
 */
export default function RelayChat({
  escalationId,
  passcode,
  operatorName,
  onClose,
  onResolved,
}: {
  escalationId: string;
  passcode: string;
  operatorName: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [thread, setThread] = useState<Thread>();
  const [selectedEscId, setSelectedEscId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [capture, setCapture] = useState(false);
  const [captureIntent, setCaptureIntent] = useState<Intent>("tours");
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const intents = useKnowledgeIntents(passcode);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/relay/thread?escalationId=${escalationId}`, {
      headers: { "x-admin-passcode": passcode },
    });
    const data = await res.json();
    if (data.ok) setThread(data.thread);
  }, [escalationId, passcode]);

  // Load once, then poll — the parent's replies come back through the normal
  // ask flow, so we pull the thread every few seconds to catch them.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    load();
    const poll = setInterval(load, 3000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(poll);
      window.removeEventListener("keydown", onKey);
    };
  }, [load, onClose]);

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread?.messages.length]);

  // If the session leaves the queue (resolved/dismissed here or elsewhere), close.
  useEffect(() => {
    if (thread && thread.pending.length === 0) {
      onResolved();
      onClose();
    }
  }, [thread, onResolved, onClose]);

  // Drop a selection that's no longer waiting (it got answered).
  useEffect(() => {
    if (!thread || !selectedEscId) return;
    if (!thread.pending.some((p) => p.escalationId === selectedEscId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deriving from freshly loaded thread
      setSelectedEscId(undefined);
    }
  }, [thread, selectedEscId]);

  const selected = thread?.pending.find((p) => p.escalationId === selectedEscId);
  const canCapture = !!selected && !selected.isCaseSpecific;

  // When a question is marked, seed capture from its context-aware default — but
  // only on an actual change, so a 3s poll never clobbers an in-progress toggle.
  const seededFor = useRef<string | undefined>("__init__");
  useEffect(() => {
    if (seededFor.current === selectedEscId) return;
    seededFor.current = selectedEscId;
    if (!selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the form when nothing is marked
      setCapture(false);
      return;
    }
    setCapture(!selected.isCaseSpecific && selected.captureDefault);
    const hint = selected.intent;
    setCaptureIntent(
      (hint && (INTENTS as readonly string[]).includes(hint) ? hint : "tours") as Intent,
    );
  }, [selectedEscId, selected]);

  const isEmail = thread?.delivery === "email";
  const awaitingContact = isEmail && !thread?.parentEmail;
  // Live relay whose parent has left: no chat to post into (server enforces this).
  const parentLeft = thread?.delivery === "live" && !thread.parentPresent;
  const livePresent = !isEmail && !parentLeft;
  const pendingCount = thread?.pending.length ?? 0;
  const willCapture = capture && canCapture;
  // A delivered reply (live/email) needs text; a marked capture needs its body.
  const needsText = livePresent || isEmail || willCapture;
  const resolveDisabled = busy || awaitingContact || (needsText && !draft.trim());

  function toggleSelect(escId: string) {
    setSelectedEscId((cur) => (cur === escId ? undefined : escId));
  }

  // A mid-relay message to gather context, WITHOUT resolving — live relays only.
  async function send() {
    const text = draft.trim();
    if (!text || busy || !thread?.pending[0]) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await fetch("/api/admin/relay/message", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
        body: JSON.stringify({
          escalationId: thread.pending[0].escalationId,
          text,
          answeredBy: operatorName,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to send.");
      setDraft("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // One reply resolves the whole session. A marked question is also saved to the
  // knowledge base; an unmarked reply collects nothing.
  async function resolve() {
    if (resolveDisabled || !thread?.pending[0]) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await fetch("/api/admin/relay/answer", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
        body: JSON.stringify({
          escalationId: thread.pending[0].escalationId,
          answer: draft,
          answeredBy: operatorName,
          captureEscalationId: willCapture ? selectedEscId : null,
          captureIntent: willCapture ? captureIntent : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to send.");
      onResolved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  // Dismiss the whole session — the parent left / the thread went stale.
  async function dismiss() {
    if (busy || !thread?.pending[0]) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await fetch("/api/admin/relay/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
        body: JSON.stringify({ escalationId: thread.pending[0].escalationId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to dismiss.");
      onResolved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const resolveLabel = busy
    ? "…"
    : parentLeft
      ? willCapture
        ? "Save & close out session"
        : "Close out session"
      : isEmail
        ? willCapture
          ? "Send email + save · resolve"
          : "Send email & resolve"
        : willCapture
          ? "Send & resolve · save"
          : "Send & resolve session";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-0 backdrop-blur-[1px] sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Relay conversation"
        onClick={(e) => e.stopPropagation()}
        className="flex h-dvh w-full max-w-lg flex-col bg-background shadow-xl sm:h-[85vh] sm:rounded-2xl sm:border sm:border-border"
      >
        {/* Header — who, and how many questions are still open */}
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {thread?.parentName || "Parent"}
              {thread?.parentEmail && (
                <span className="ml-1 font-normal text-muted">· {thread.parentEmail}</span>
              )}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {pendingCount > 0 && (
                <span className="rounded-full bg-you px-2 py-0.5 font-medium">
                  {pendingCount} {pendingCount === 1 ? "question waiting" : "questions waiting"}
                </span>
              )}
              {isEmail && <span className="text-amber-700">📧 email follow-up</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg text-muted hover:bg-you"
          >
            ✕
          </button>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {!thread ? (
            <p className="text-sm text-muted">Loading conversation…</p>
          ) : (
            thread.messages.map((m) => (
              <Bubble
                key={m.id}
                m={m}
                pendingOrdinal={
                  m.pendingEscalationId
                    ? thread.pending.findIndex((p) => p.escalationId === m.pendingEscalationId) + 1
                    : 0
                }
                isSelected={!!m.pendingEscalationId && m.pendingEscalationId === selectedEscId}
                onSelect={
                  m.pendingEscalationId ? () => toggleSelect(m.pendingEscalationId!) : undefined
                }
              />
            ))
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border px-4 py-3">
          {pendingCount > 0 ? (
            <>
              {/* What this reply does, and the opt-in knowledge capture. */}
              <div className="mb-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs">
                {selected ? (
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="mt-px">
                      ⭐
                    </span>
                    <span className="min-w-0 flex-1 text-muted">
                      <span className="font-medium text-foreground">“{selected.question}”</span>
                      {selected.aiReferenced.length > 0 && (
                        <span className="mt-0.5 block">
                          AI already referenced: {selected.aiReferenced.join(", ")}
                        </span>
                      )}
                      <button
                        onClick={() => setSelectedEscId(undefined)}
                        className="mt-0.5 block text-brand-strong hover:underline"
                      >
                        Clear selection
                      </button>
                    </span>
                  </div>
                ) : (
                  <span className="text-muted">
                    Your reply resolves{" "}
                    <span className="font-medium text-foreground">
                      all {pendingCount} {pendingCount === 1 ? "question" : "questions"}
                    </span>{" "}
                    in this session.
                    {pendingCount >= 1 && " Tap a ⏳ question above to also save its answer to the knowledge base."}
                  </span>
                )}
              </div>

              {parentLeft && (
                <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-800">
                  The parent has left this session — your reply can&apos;t be sent. You can close it
                  out{canCapture ? ", and still save a marked answer to the knowledge base" : ""}.
                </p>
              )}
              {awaitingContact && (
                <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-800">
                  Waiting for the parent to leave their email before a follow-up can be sent.
                </p>
              )}

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder={
                  parentLeft
                    ? canCapture
                      ? "Answer to save to the knowledge base…"
                      : "Add a note, or just close the session out…"
                    : isEmail
                      ? "Reply (sent to the parent by email)…"
                      : "Reply the whole session (streams to the parent now)…"
                }
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-brand"
              />

              {/* Knowledge capture — only offered for a marked, non-case-specific question. */}
              {canCapture ? (
                <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={capture}
                    onChange={(e) => setCapture(e.target.checked)}
                  />
                  Save the marked answer to the knowledge base
                  {capture && (
                    <select
                      value={captureIntent}
                      onChange={(e) => setCaptureIntent(e.target.value as Intent)}
                      className="rounded border border-border bg-surface px-1.5 py-0.5 text-sm"
                    >
                      {intents.map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              ) : selected ? (
                <p className="mt-2 text-xs text-muted">
                  This is a case-specific question — it won&apos;t be saved as general knowledge.
                </p>
              ) : null}
              {willCapture && (
                <p className="mt-1 text-xs text-brand-strong">
                  ↳ becomes citable — the front desk will answer this next time.
                </p>
              )}

              <div className="mt-2 flex gap-2">
                {livePresent && (
                  <button
                    onClick={send}
                    disabled={!draft.trim() || busy}
                    className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-you disabled:opacity-40"
                    title="Send a message and keep the session open (e.g. to ask for details)"
                  >
                    Send
                  </button>
                )}
                <button
                  onClick={resolve}
                  disabled={resolveDisabled}
                  className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg disabled:opacity-40"
                  title="Send this reply and close every waiting question in the session"
                >
                  {resolveLabel}
                </button>
              </div>

              {/* Dismiss the whole session without replying. */}
              <div className="mt-2 text-center">
                {confirmDismiss ? (
                  <span className="inline-flex items-center gap-2 text-xs text-muted">
                    Dismiss this session?
                    <button
                      onClick={dismiss}
                      disabled={busy}
                      className="font-medium text-red-600 hover:underline disabled:opacity-40"
                    >
                      {busy ? "Dismissing…" : "Yes, dismiss"}
                    </button>
                    <button
                      onClick={() => setConfirmDismiss(false)}
                      disabled={busy}
                      className="text-muted hover:underline"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDismiss(true)}
                    className="text-xs text-muted hover:text-red-600 hover:underline"
                  >
                    Dismiss session
                  </button>
                )}
              </div>

              {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
            </>
          ) : (
            <p className="rounded-lg border border-border bg-you px-3 py-2 text-center text-xs text-muted">
              {thread ? "No questions are waiting in this session." : "Loading…"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** One transcript bubble — parent on the right, front desk (AI/staff) on the left. */
function Bubble({
  m,
  pendingOrdinal,
  isSelected,
  onSelect,
}: {
  m: ThreadMessage;
  pendingOrdinal: number;
  isSelected: boolean;
  onSelect?: () => void;
}) {
  if (m.role === "parent") {
    const isPending = !!m.pendingEscalationId;
    return (
      <div className="flex flex-col items-end gap-1">
        {isPending && (
          <button
            onClick={onSelect}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition ${
              isSelected
                ? "bg-brand text-brand-fg"
                : "bg-amber-400/20 text-amber-800 hover:bg-amber-400/30"
            }`}
            title={isSelected ? "Marked to save to the knowledge base" : "Mark this question to save its answer"}
          >
            {isSelected ? "⭐" : "⏳"} {isSelected ? "Marked" : "Awaiting reply"}
            {pendingOrdinal > 0 ? ` · #${pendingOrdinal}` : ""}
          </button>
        )}
        <div
          className={`max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-[15px] leading-snug text-brand-fg ${
            isPending && isSelected ? "ring-2 ring-brand/50" : ""
          }`}
        >
          <span className="whitespace-pre-wrap">{m.text}</span>
        </div>
      </div>
    );
  }
  const isStaff = m.provenance === "staff";
  const isAI = m.provenance === "grounded";
  return (
    <div className="flex max-w-[85%] flex-col gap-1 self-start">
      {isStaff ? (
        <span className="ml-1 flex items-center gap-1.5 text-xs font-medium text-brand-strong">
          <span aria-hidden>👤</span> From our team{m.answeredBy ? ` · ${m.answeredBy}` : ""}
        </span>
      ) : isAI ? (
        <span className="ml-1 flex items-center gap-1.5 text-xs font-medium text-muted">
          <span aria-hidden>✨</span> AI assistant
        </span>
      ) : null}
      <div
        className={`rounded-2xl rounded-tl-sm px-3.5 py-2 text-[15px] leading-snug ring-1 ${
          isStaff ? "bg-brand/10 ring-brand/30" : "bg-surface ring-border"
        }`}
      >
        <span className="whitespace-pre-wrap">{m.text}</span>
      </div>
      {m.citations.length > 0 && (
        <div className="ml-1 flex flex-wrap gap-1.5">
          {m.citations.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-strong"
            >
              📎 {c.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
