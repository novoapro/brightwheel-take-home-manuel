"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INTENTS, type Intent } from "@/lib/types";
import { useKnowledgeIntents } from "./useKnowledgeIntents";

type ThreadMessage = {
  id: string;
  role: "parent" | "frontdesk";
  provenance: "grounded" | "staff" | null;
  text: string;
  citations: { id: string; title: string }[];
  answeredBy: string | null;
  createdAt: string;
};

type Thread = {
  escalationId: string;
  status: "waiting" | "answered" | "dismissed";
  question: string;
  intent: string | null;
  reason: string;
  isCaseSpecific: boolean;
  waitingSince: string;
  delivery: "live" | "email";
  aiReferenced: string[];
  parentName: string | null;
  parentEmail: string | null;
  parentPresent: boolean;
  messages: ThreadMessage[];
};

/**
 * The operator's side of a live relay — the parent chat, mirrored. The one
 * question that triggered the relay is rarely the whole story, so this shows the
 * full thread and lets the operator ask clarifying questions (which stream to
 * the parent live) before giving a valuable final answer. Sending a normal
 * message keeps the relay open; "Send & resolve" closes it, optionally saving
 * the answer to the knowledge base so the front desk handles it next time.
 */
export default function RelayChat({
  escalationId,
  passcode,
  operatorName,
  intentHint,
  captureDefault,
  isCaseSpecific,
  onClose,
  onResolved,
}: {
  escalationId: string;
  passcode: string;
  operatorName: string;
  intentHint: string | null;
  captureDefault: boolean;
  isCaseSpecific: boolean;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [thread, setThread] = useState<Thread>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [capture, setCapture] = useState(captureDefault);
  const [captureIntent, setCaptureIntent] = useState<Intent>(
    (intentHint && (INTENTS as readonly string[]).includes(intentHint)
      ? intentHint
      : "tours") as Intent,
  );
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

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await fetch("/api/admin/relay/message", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
        body: JSON.stringify({ escalationId, text, answeredBy: operatorName }),
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

  async function resolve() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await fetch("/api/admin/relay/answer", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
        body: JSON.stringify({
          escalationId,
          answer: text,
          answeredBy: operatorName,
          capture: willCapture,
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

  const resolved = thread && thread.status !== "waiting";
  // Parent gone: a live message can't be delivered — only a resolve, which
  // collects the answer as knowledge (the server enforces the same rule).
  const parentLeft = thread && thread.status === "waiting" && !thread.parentPresent;
  // Saving is the only outcome (a specific case is just closed out, never saved
  // as general knowledge), so the capture checkbox is redundant.
  const knowledgeOnly = parentLeft && !isCaseSpecific;
  const willCapture = capture || knowledgeOnly;

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
        {/* Header — who + what triggered the relay */}
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {thread?.parentName || "Parent"}
              {thread?.parentEmail && (
                <span className="ml-1 font-normal text-muted">· {thread.parentEmail}</span>
              )}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className="rounded-full bg-you px-2 py-0.5">
                {thread?.intent ?? intentHint ?? "out of scope"}
                {isCaseSpecific ? " · case-specific" : ""}
              </span>
              {thread?.aiReferenced.length ? (
                <span>AI shared: {thread.aiReferenced.join(", ")}</span>
              ) : null}
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
            thread.messages.map((m) => <Bubble key={m.id} m={m} />)
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border px-4 py-3">
          {resolved ? (
            <p className="rounded-lg border border-border bg-you px-3 py-2 text-center text-xs text-muted">
              This relay is {thread!.status}. Nothing more to send.
            </p>
          ) : (
            <>
              {parentLeft && (
                <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-800">
                  {knowledgeOnly
                    ? "The parent has left this session. You can still resolve it — your answer will be saved to the knowledge base, not sent."
                    : "The parent has left this session. This is a specific case, so it won't be saved as general knowledge — you can close it out."}
                </p>
              )}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder={
                  parentLeft
                    ? "Answer to save to the knowledge base…"
                    : "Message the parent (streams to them now)…"
                }
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-brand"
              />

              {knowledgeOnly ? (
                // Saving is the only outcome — the checkbox is redundant; just let
                // the operator categorize what's being saved.
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span>Save to knowledge base under</span>
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
                </div>
              ) : parentLeft ? null : (
                <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={capture}
                    onChange={(e) => setCapture(e.target.checked)}
                  />
                  Save to knowledge base on resolve
                  {capture ? (
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
                  ) : (
                    <span className="text-xs text-muted">
                      {isCaseSpecific ? "(off — specific case, not general knowledge)" : "(off)"}
                    </span>
                  )}
                </label>
              )}

              <div className="mt-2 flex gap-2">
                {!parentLeft && (
                  <button
                    onClick={send}
                    disabled={!draft.trim() || busy}
                    className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-you disabled:opacity-40"
                    title="Send a message and keep the relay open (e.g. to ask for details)"
                  >
                    Send
                  </button>
                )}
                <button
                  onClick={resolve}
                  disabled={!draft.trim() || busy}
                  className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg disabled:opacity-40"
                  title={
                    knowledgeOnly
                      ? "Save this answer to the knowledge base and close the relay"
                      : parentLeft
                        ? "Close out this relay (the parent has left)"
                        : "Send this as the final answer and close the relay"
                  }
                >
                  {busy
                    ? "…"
                    : knowledgeOnly
                      ? "Save to knowledge base"
                      : parentLeft
                        ? "Close out"
                        : capture
                          ? "Send & resolve · save"
                          : "Send & resolve"}
                </button>
              </div>
              {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One transcript bubble — parent on the right, front desk (AI/staff) on the left. */
function Bubble({ m }: { m: ThreadMessage }) {
  if (m.role === "parent") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-[15px] leading-snug text-brand-fg">
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
