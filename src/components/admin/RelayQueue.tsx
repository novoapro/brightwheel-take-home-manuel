"use client";

import { useCallback, useEffect, useState } from "react";
import { INTENTS, type Intent } from "@/lib/types";
import { useKnowledgeIntents } from "./useKnowledgeIntents";
import RelayChat from "./RelayChat";

type QueueItem = {
  escalationId: string;
  question: string;
  intent: string | null;
  reason: string;
  isCaseSpecific: boolean;
  aiReferenced: string[];
  waitingSince: string;
  captureDefault: boolean;
  delivery: "live" | "email";
  contactName: string | null;
  contactEmail: string | null;
  parentPresent: boolean;
};

type SortDir = "longest" | "shortest";

/** The live-relay queue (analysis/03 §4.2) — reply relays to the parent live. */
export default function RelayQueue({
  passcode,
  operatorName,
}: {
  passcode: string;
  operatorName: string;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [sort, setSort] = useState<SortDir>("longest");
  const [chatItem, setChatItem] = useState<QueueItem>();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/relay/queue", {
      headers: { "x-admin-passcode": passcode },
    });
    const data = await res.json();
    if (data.ok) setQueue(data.queue);
  }, [passcode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    refresh();
    const poll = setInterval(refresh, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  if (queue.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
        No one is waiting right now. Questions the front desk can&apos;t answer
        appear here in real time.
      </p>
    );
  }

  // Sort by how long the parent has waited. Longest-first is the default (fair
  // triage); shortest-first lets an operator clear quick wins to trim the queue.
  const ordered = [...queue].sort((a, b) => {
    const at = new Date(a.waitingSince).getTime();
    const bt = new Date(b.waitingSince).getTime();
    return sort === "longest" ? at - bt : bt - at;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {queue.length} waiting {queue.length === 1 ? "parent" : "parents"}
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortDir)}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
          >
            <option value="longest">Waiting longest</option>
            <option value="shortest">Waiting shortest</option>
          </select>
        </label>
      </div>
      {ordered.map((item) => (
        <RelayCard
          key={item.escalationId}
          item={item}
          now={now}
          operatorName={operatorName}
          passcode={passcode}
          onDone={refresh}
          onOpenChat={() => setChatItem(item)}
        />
      ))}

      {chatItem && (
        <RelayChat
          escalationId={chatItem.escalationId}
          passcode={passcode}
          operatorName={operatorName}
          intentHint={chatItem.intent}
          captureDefault={chatItem.captureDefault}
          isCaseSpecific={chatItem.isCaseSpecific}
          onClose={() => setChatItem(undefined)}
          onResolved={refresh}
        />
      )}
    </div>
  );
}

function elapsed(sinceIso: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function RelayCard({
  item,
  now,
  operatorName,
  passcode,
  onDone,
  onOpenChat,
}: {
  item: QueueItem;
  now: number;
  operatorName: string;
  passcode: string;
  onDone: () => void;
  onOpenChat: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [capture, setCapture] = useState(item.captureDefault);
  const [captureIntent, setCaptureIntent] = useState<Intent>(
    (item.intent && (INTENTS as readonly string[]).includes(item.intent)
      ? item.intent
      : "tours") as Intent,
  );
  const intents = useKnowledgeIntents(passcode);
  const [sending, setSending] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [err, setErr] = useState<string>();

  const isEmail = item.delivery === "email";
  // An email follow-up can't be sent until the parent leaves their address.
  const awaitingContact = isEmail && !item.contactEmail;
  // Live relay whose parent has left: no chat to post into, so the operator's
  // reply is collected as knowledge instead of sent (the server enforces this).
  const parentLeft = item.delivery === "live" && !item.parentPresent;
  // Saving to knowledge is the only outcome (a specific case is never saved as
  // general knowledge — it just gets closed out).
  const knowledgeOnly = parentLeft && !item.isCaseSpecific;
  const willCapture = capture || knowledgeOnly;

  async function send() {
    if (!answer.trim() || sending || awaitingContact) return;
    setSending(true);
    setErr(undefined);
    try {
      const res = await fetch("/api/admin/relay/answer", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
        body: JSON.stringify({
          escalationId: item.escalationId,
          answer,
          answeredBy: operatorName,
          capture: willCapture,
          captureIntent: willCapture ? captureIntent : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to send.");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setSending(false);
    }
  }

  async function dismiss() {
    setDismissing(true);
    setErr(undefined);
    try {
      const res = await fetch("/api/admin/relay/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
        body: JSON.stringify({ escalationId: item.escalationId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to dismiss.");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setDismissing(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        {isEmail ? (
          <span className="flex items-center gap-1.5 font-medium text-amber-700">
            📧 email follow-up · {elapsed(item.waitingSince, now)}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-red-600">
            <span className="animate-softpulse">🔴</span> waiting · {elapsed(item.waitingSince, now)}
          </span>
        )}
        <span className="rounded-full bg-you px-2 py-0.5 text-muted">
          {item.intent ?? "out of scope"}
          {item.isCaseSpecific ? " · case-specific" : ""}
        </span>
      </div>

      <p className="text-[15px] font-medium">“{item.question}”</p>
      {isEmail && (
        <p className="mt-1 text-xs text-amber-700">
          {item.contactEmail
            ? `Reply goes to ${item.contactName ? `${item.contactName} · ` : ""}${item.contactEmail} (simulated).`
            : "Waiting for the parent to leave their email…"}
        </p>
      )}
      {item.aiReferenced.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          AI already referenced: {item.aiReferenced.join(", ")}
        </p>
      )}

      {/* Parent gone: the reply can't be delivered — kept as knowledge, or (for a
          specific case) just closed out. */}
      {parentLeft && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-800">
          {knowledgeOnly
            ? "The parent has left this session — your reply will be saved to the knowledge base, not sent."
            : "The parent has left this session. This is a specific case, so it won't be saved as general knowledge — you can close it out."}
        </p>
      )}

      {/* Need more context first? Open the full conversation (live, parent still here). */}
      {!isEmail && !parentLeft && (
        <button
          onClick={onOpenChat}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-strong hover:underline"
        >
          💬 Open chat for more context →
        </button>
      )}

      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        placeholder={parentLeft ? "Answer to save to the knowledge base…" : "Reply (relays to the parent now)…"}
        className="mt-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[15px] outline-none focus:border-brand"
      />

      {knowledgeOnly ? (
        // Saving is the only outcome, so the checkbox is redundant — just let the
        // operator categorize what's being saved.
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>Save to knowledge base under</span>
          <select
            value={captureIntent}
            onChange={(e) => setCaptureIntent(e.target.value as Intent)}
            className="rounded border border-border bg-surface px-1.5 py-0.5 text-sm"
          >
            {intents.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
          </select>
        </div>
      ) : parentLeft ? null : (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" checked={capture} onChange={(e) => setCapture(e.target.checked)} />
          Save to knowledge base
          {capture ? (
            <select
              value={captureIntent}
              onChange={(e) => setCaptureIntent(e.target.value as Intent)}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-sm"
            >
              {intents.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-muted">
              {item.isCaseSpecific ? "(off — specific case, not general knowledge)" : "(off)"}
            </span>
          )}
        </label>
      )}
      {willCapture && (
        <p className="mt-1 text-xs text-brand-strong">
          ↳ becomes citable — the front desk will answer this next time.
        </p>
      )}

      <button
        onClick={send}
        disabled={!answer.trim() || sending || awaitingContact}
        className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-brand-fg disabled:opacity-40"
      >
        {sending
          ? knowledgeOnly
            ? "Saving…"
            : parentLeft
              ? "Closing…"
              : "Sending…"
          : awaitingContact
            ? "Waiting for parent's email"
            : knowledgeOnly
              ? "Save to knowledge base"
              : parentLeft
                ? "Close out"
                : isEmail
                  ? capture
                    ? "Send email + Save"
                    : "Send email (simulated)"
                  : capture
                    ? "Reply + Save"
                    : "Reply to parent's chat"}
      </button>

      {/* Dismiss — the parent left / thread went stale; clear it without replying. */}
      <div className="mt-2 text-center">
        {confirmDismiss ? (
          <span className="inline-flex items-center gap-2 text-xs text-muted">
            This session is no longer active?
            <button
              onClick={dismiss}
              disabled={dismissing}
              className="font-medium text-red-600 hover:underline disabled:opacity-40"
            >
              {dismissing ? "Dismissing…" : "Yes, dismiss"}
            </button>
            <button
              onClick={() => setConfirmDismiss(false)}
              disabled={dismissing}
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
            Dismiss
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
