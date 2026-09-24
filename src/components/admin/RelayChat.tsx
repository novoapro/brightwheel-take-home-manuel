"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "./adminFetch";
import { inputCls } from "./ui";
import type { PendingQuestion, ReferencedPolicy } from "./types";

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
  escalationId: string;
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
 * to ask a clarifying question). For each question the front desk drafts a
 * grounded reply the operator can accept as-is, edit, or replace; the handbook is
 * a tap away for reference or to attach a source. (Curating the knowledge base
 * itself lives in the Knowledge Base view, not here.)
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
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  // Compose state: whether the operator is editing/writing a reply (vs. looking at
  // the AI suggestion), the handbook policies attached to it (📎 chips the parent
  // sees), whether the edit started from the AI draft, and the handbook overlay.
  const [editing, setEditing] = useState(false);
  const [editFromAi, setEditFromAi] = useState(false);
  const [attached, setAttached] = useState<ReferencedPolicy[]>([]);
  const [handbookOpen, setHandbookOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await adminFetch(
      `/api/admin/relay/thread?escalationId=${escalationId}`,
      passcode,
    );
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
  // The question whose AI draft we surface for accept/edit: the one the operator
  // tapped, otherwise the question they opened (the oldest waiting).
  const focus = selected ?? thread?.pending[0];
  // There's an AI draft worth forwarding only when it's grounded in the handbook.
  const hasSuggestion = !!focus?.aiDraft && focus.aiReferenced.length > 0;
  // Show the compose UI (textarea + sources + actions) when the operator is
  // editing/writing, or when there's no suggestion to accept in the first place.
  const composeMode = editing || !hasSuggestion;

  function enterEdit() {
    setEditFromAi(true);
    setDraft(focus?.aiDraft ?? "");
    setAttached(focus?.aiReferenced ?? []);
    setEditing(true);
  }
  function enterWriteOwn() {
    setEditFromAi(false);
    setDraft("");
    setAttached([]);
    setEditing(true);
  }
  // Cancel edit mode → back to the AI suggestion, which can still be accepted as-is.
  function cancelEdit() {
    setEditing(false);
    setEditFromAi(false);
    setDraft("");
    setAttached([]);
    setHandbookOpen(false);
    setErr(undefined);
  }
  function toggleAttach(policy: ReferencedPolicy) {
    setAttached((cur) =>
      cur.some((c) => c.id === policy.id)
        ? cur.filter((c) => c.id !== policy.id)
        : [...cur, policy],
    );
  }

  const isEmail = thread?.delivery === "email";
  const awaitingContact = isEmail && !thread?.parentEmail;
  // Live relay whose parent has left: no chat to post into (server enforces this).
  const parentLeft = thread?.delivery === "live" && !thread.parentPresent;
  const livePresent = !isEmail && !parentLeft;
  const pendingCount = thread?.pending.length ?? 0;
  // A delivered reply (live/email) needs text; a parent-gone close-out does not.
  const needsText = livePresent || isEmail;
  const resolveDisabled = busy || awaitingContact || (needsText && !draft.trim());

  function toggleSelect(escId: string) {
    setSelectedEscId((cur) => (cur === escId ? undefined : escId));
  }

  // Clear the compose form (draft text + attached sources + edit mode) after a
  // reply is sent, so the next question starts fresh.
  function resetComposer() {
    setDraft("");
    setAttached([]);
    setEditing(false);
    setEditFromAi(false);
    setHandbookOpen(false);
  }

  // After a per-question reply: refresh the queue, clear the form, and reload the
  // thread. The answered question drops out of `pending`; the empty-pending effect
  // closes the modal only once every question is handled.
  async function afterQuestionAnswered() {
    onResolved();
    resetComposer();
    await load();
  }

  // Forward the AI's drafted answer verbatim — one tap, no typing — for the FOCUSED
  // question only. The parent sees it as a normal AI answer (📎, with its sources);
  // it's recorded as ai_suggested for attribution + ROI. Other waiting questions
  // stay open.
  async function acceptAiAnswer() {
    const draftText = focus?.aiDraft?.trim();
    const escId = focus?.escalationId;
    if (busy || !escId || !draftText) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await adminFetch("/api/admin/relay/answer", passcode, {
        method: "POST",
        body: JSON.stringify({
          escalationId: escId,
          answer: draftText,
          answeredBy: operatorName,
          source: "ai_suggested",
          citations: (focus?.aiReferenced ?? []).map((r) => r.id),
          resolveSession: false,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to send.");
      await afterQuestionAnswered();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Send the composed reply for the FOCUSED question, carrying any attached handbook
  // sources. `resolveSession` decides whether this also closes every other waiting
  // question in the session ("Send & resolve session") or leaves them open ("Send").
  async function sendAnswer(resolveSession: boolean) {
    const escId = focus?.escalationId;
    if (resolveDisabled || !escId) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await adminFetch("/api/admin/relay/answer", passcode, {
        method: "POST",
        body: JSON.stringify({
          escalationId: escId,
          answer: draft,
          answeredBy: operatorName,
          // Written/edited → a staff answer, carrying the kept/attached policies.
          source: "staff",
          citations: attached.map((c) => c.id),
          resolveSession,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to send.");
      if (resolveSession) {
        onResolved();
        onClose();
      } else {
        await afterQuestionAnswered();
        setBusy(false);
      }
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
      const res = await adminFetch("/api/admin/relay/dismiss", passcode, {
        method: "POST",
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

  // Primary action answers just this question; the secondary (only when more than
  // one is waiting) also closes the rest of the session.
  const sendLabel = busy
    ? "…"
    : parentLeft
      ? "Close out"
      : isEmail
        ? "Send email"
        : "Send";
  const resolveAllLabel = busy
    ? "…"
    : parentLeft
      ? "Close out session"
      : isEmail
        ? "Send email & resolve all"
        : "Send & resolve session";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Relay conversation"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
        {/* Header — who, and how many questions are still open */}
        <div className="flex items-start gap-3 border-b border-border px-4 py-3 md:px-6">
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

        {/* Body — the conversation on the left, the reply workspace on the right.
            Full-screen and roomy so everything the operator needs is on one view;
            stacks to a single column on narrow screens. */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Transcript — a positioning context so the handbook overlays it (below)
              while the reply workspace stays visible. */}
          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-4 md:px-6">
            <div className="mx-auto w-full max-w-2xl space-y-3">
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
            </div>
            {/* Handbook — opens OVER the conversation, leaving the reply workspace
                visible so the operator can attach a policy while composing. */}
            {handbookOpen && (
              <HandbookOverlay
                passcode={passcode}
                composing={composeMode}
                attachedIds={new Set(attached.map((c) => c.id))}
                onToggleAttach={(e) => toggleAttach({ id: e.id, title: e.title })}
                onClose={() => setHandbookOpen(false)}
              />
            )}
          </div>

          {/* Reply workspace — suggested reply, composer, handbook, actions */}
          <div className="max-h-[55vh] shrink-0 overflow-y-auto border-t border-border px-4 py-4 md:px-6 lg:max-h-none lg:w-[26rem] lg:border-l lg:border-t-0">
          {pendingCount > 0 ? (
            <>
              {/* What this reply does. */}
              <div className="mb-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs">
                {selected ? (
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="mt-px">
                      ⭐
                    </span>
                    <span className="min-w-0 flex-1 text-muted">
                      <span className="font-medium text-foreground">“{selected.question}”</span>
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
                    {pendingCount > 1 && " Tap a ⏳ question above to work on its suggested reply."}
                  </span>
                )}
              </div>

              {parentLeft && (
                <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-800">
                  The parent has left this session — your reply can&apos;t be sent. You can close it out.
                </p>
              )}
              {awaitingContact && (
                <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-800">
                  Waiting for the parent to leave their email before a follow-up can be sent.
                </p>
              )}

              {/* AI-suggested reply — accept it as-is (a 📎 AI answer), edit it, or
                  write your own. Shown only when the draft is grounded in the handbook. */}
              {hasSuggestion && !editing && (
                <SuggestedReply
                  draft={focus!.aiDraft!}
                  why={whyHeld(focus!.reason)}
                  referenced={focus!.aiReferenced}
                  canSend={(livePresent || isEmail) && !awaitingContact}
                  busy={busy}
                  onAccept={acceptAiAnswer}
                  onEdit={enterEdit}
                  onWriteOwn={enterWriteOwn}
                />
              )}

              {composeMode && (
                <>
                  {editing && hasSuggestion && (
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">
                        {editFromAi ? "Editing the AI reply" : "Writing your reply"}
                      </span>
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-muted hover:text-foreground hover:underline"
                        title="Discard this and go back to the AI suggestion"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={editing ? 4 : 2}
                    placeholder={
                      parentLeft
                        ? "Add a note, or just close the session out…"
                        : isEmail
                          ? "Reply (sent to the parent by email)…"
                          : "Reply the whole session (streams to the parent now)…"
                    }
                    className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-brand"
                  />

                  {/* Attached handbook sources — the parent sees these as 📎 chips.
                      Detach any, or attach more from the handbook (opens over the chat). */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {attached.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-strong"
                      >
                        📎 {c.title}
                        <button
                          onClick={() => toggleAttach(c)}
                          aria-label={`Remove ${c.title}`}
                          className="leading-none text-brand-strong/60 hover:text-brand-strong"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => setHandbookOpen(true)}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted hover:border-brand hover:text-brand-strong"
                    >
                      + Attach from handbook
                    </button>
                  </div>

                  <div className="mt-2 flex gap-2">
                    {pendingCount > 1 && (
                      <button
                        onClick={() => sendAnswer(true)}
                        disabled={resolveDisabled}
                        className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-you disabled:opacity-40"
                        title="Send this reply and close EVERY waiting question in the session"
                      >
                        {resolveAllLabel}
                      </button>
                    )}
                    <button
                      onClick={() => sendAnswer(false)}
                      disabled={resolveDisabled}
                      className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg disabled:opacity-40"
                      title={
                        pendingCount > 1
                          ? "Send this reply and close only this question — other questions stay open"
                          : "Send this reply and close the question"
                      }
                    >
                      {sendLabel}
                    </button>
                  </div>
                </>
              )}

              {/* Look up the handbook without leaving the relay — opens over the
                  conversation; in compose mode each policy can be attached. */}
              <div className="mt-3 flex items-center gap-3 text-xs">
                <button
                  onClick={() => setHandbookOpen(true)}
                  className="font-medium text-brand-strong hover:underline"
                >
                  🔎 Browse the handbook
                </button>
                <a
                  href="/handbook"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-brand-strong hover:underline"
                >
                  Open full handbook ↗
                </a>
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
            title={isSelected ? "You're working on this question" : "Work on this question's reply"}
          >
            {isSelected ? "⭐" : "⏳"} {isSelected ? "Selected" : "Awaiting reply"}
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
          <span aria-hidden>✨</span> Front Desk AI Assistant
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
            <a
              key={c.id}
              href={`/handbook#${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open our family handbook"
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-strong hover:bg-brand/20"
            >
              📎 {c.title} ›
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Short, plain reason the front desk held this question for a person — shown on
 *  the AI-suggested reply so the operator knows what to double-check. */
function whyHeld(reason: string): string | null {
  if (reason === "sensitive:always_escalate") return "This topic always goes to a person";
  if (reason === "sensitive:case_specific") return "About a specific child — needs a person";
  if (reason.startsWith("sensitive:")) return "Sensitive — review before sending";
  switch (reason) {
    case "no_citation":
    case "invalid_citation":
    case "fact_mismatch":
    case "low_groundedness":
      return "Not verified against the handbook — please review";
    case "below_threshold":
    case "model_escalate":
      return "The AI wasn't confident — please review";
    case "out_of_scope":
      return "Not covered by the handbook";
    default:
      return null;
  }
}

/**
 * The AI's drafted answer for the focused question: accept it as-is (sent as a
 * grounded AI answer with its sources), edit it (loads into the reply box with its
 * sources, which the operator can detach/attach), or write your own from scratch.
 */
function SuggestedReply({
  draft,
  why,
  referenced,
  canSend,
  busy,
  onAccept,
  onEdit,
  onWriteOwn,
}: {
  draft: string;
  why: string | null;
  referenced: ReferencedPolicy[];
  canSend: boolean;
  busy: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onWriteOwn: () => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <span aria-hidden>✨</span> AI-suggested reply
        </span>
        {why && (
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {why}
          </span>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-foreground">{draft}</p>
      {referenced.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {referenced.map((c) => (
            <a
              key={c.id}
              href={`/handbook#${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open our family handbook"
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-strong hover:bg-brand/20"
            >
              📎 {c.title} ›
            </a>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canSend && (
          <button
            onClick={onAccept}
            disabled={busy}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg disabled:opacity-40"
            title="Send the AI's answer to the parent as-is (recorded as an AI answer)"
          >
            Accept &amp; send
          </button>
        )}
        <button
          onClick={onEdit}
          disabled={busy}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-you disabled:opacity-40"
          title="Load this draft into the reply box — tweak the text and its sources before sending"
        >
          Edit
        </button>
        <button
          onClick={onWriteOwn}
          disabled={busy}
          className="text-xs text-muted hover:text-foreground hover:underline disabled:opacity-40"
          title="Ignore the suggestion and write your own reply"
        >
          Write my own
        </button>
      </div>
    </div>
  );
}

type KbEntry = { id: string; title: string; intent: string; status: string };

/**
 * The handbook, opened OVER the conversation (analysis/03 §4.2) so the operator can
 * look things up without losing the reply workspace. Search by title, filter by
 * category, open any policy in a new tab — and, while composing, attach/detach a
 * policy so the parent sees it as a 📎 source on the reply.
 */
function HandbookOverlay({
  passcode,
  composing,
  attachedIds,
  onToggleAttach,
  onClose,
}: {
  passcode: string;
  composing: boolean;
  attachedIds: Set<string>;
  onToggleAttach: (entry: KbEntry) => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");

  useEffect(() => {
    let alive = true;
    adminFetch("/api/admin/knowledge", passcode)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.ok && Array.isArray(d.entries)) {
          setEntries((d.entries as KbEntry[]).filter((e) => e.status === "published"));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [passcode]);

  const cats = ["all", ...Array.from(new Set(entries.map((e) => e.intent)))];
  const needle = q.trim().toLowerCase();
  const results = entries
    .filter((e) => cat === "all" || e.intent === cat)
    .filter((e) => needle === "" || `${e.title} ${e.intent}`.toLowerCase().includes(needle))
    .slice(0, 60);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 md:px-6">
        <span className="text-sm font-semibold">
          Handbook
          {composing && (
            <span className="ml-1.5 font-normal text-muted">· tap Attach to cite a policy</span>
          )}
        </span>
        <button
          onClick={onClose}
          aria-label="Close handbook"
          className="grid h-8 w-8 place-items-center rounded-lg text-lg text-muted hover:bg-you"
        >
          ✕
        </button>
      </div>
      <div className="flex gap-2 border-b border-border px-4 py-2 md:px-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search policies…"
          className={inputCls}
          autoFocus
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-2 text-sm"
        >
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2 md:px-4">
        {!loaded ? (
          <li className="px-2 py-1 text-xs text-muted">Loading…</li>
        ) : results.length === 0 ? (
          <li className="px-2 py-1 text-xs text-muted">No matching policies.</li>
        ) : (
          results.map((e) => {
            const isAttached = attachedIds.has(e.id);
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-you"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{e.title}</p>
                  <p className="text-xs text-muted">{e.intent}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <a
                    href={`/handbook#${e.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded px-2 py-1 text-xs text-muted hover:text-brand-strong"
                    title="Open in the handbook"
                  >
                    Open ↗
                  </a>
                  {composing && (
                    <button
                      onClick={() => onToggleAttach(e)}
                      className={`rounded-lg px-2 py-1 text-xs font-medium ${
                        isAttached
                          ? "bg-brand/15 text-brand-strong ring-1 ring-brand/30"
                          : "border border-border text-foreground hover:bg-surface"
                      }`}
                    >
                      {isAttached ? "Attached ✓" : "Attach"}
                    </button>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
