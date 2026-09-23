"use client";

import { useCallback, useEffect, useState } from "react";
import RelayChat from "./RelayChat";
import { adminFetch } from "./adminFetch";
import type { PendingQuestion } from "./types";

type QueueItem = {
  sessionId: string;
  primaryEscalationId: string;
  parentName: string | null;
  parentEmail: string | null;
  delivery: "live" | "email";
  parentPresent: boolean;
  waitingSince: string;
  pending: PendingQuestion[];
};

type SortDir = "longest" | "shortest";
type DeliveryFilter = "all" | "live" | "email";

/**
 * The live-relay queue (analysis/03 §4.2) — one entry per waiting family, not per
 * message. A family that stumped the front desk on several questions shows up
 * once; the operator opens the session to read the full thread and answer each
 * pending question in context.
 */
export default function RelayQueue({
  passcode,
  operatorName,
  relaySignal,
}: {
  passcode: string;
  operatorName: string;
  /**
   * Bumped by the admin shell on every relay `queue_changed` SSE event. We
   * re-fetch when it changes instead of polling — the shell already holds one
   * stream open, so the queue rides it rather than opening a second connection.
   */
  relaySignal?: number;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [sort, setSort] = useState<SortDir>("longest");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [openEscalationId, setOpenEscalationId] = useState<string>();

  const refresh = useCallback(async () => {
    const res = await adminFetch("/api/admin/relay/queue", passcode);
    const data = await res.json();
    if (data.ok) setQueue(data.queue);
  }, [passcode]);

  // Fetch on mount and whenever the shell's relay SSE reports a queue change —
  // no polling. `refresh` is stable (memoized on passcode), so this fires on
  // mount and on each `relaySignal` bump.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    refresh();
  }, [refresh, relaySignal]);

  // A cheap catch-up when the operator returns to the tab — covers any change
  // that doesn't move the waiting count (e.g. a parent leaving a live relay),
  // without reintroducing a steady poll.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // A 1s clock for the elapsed-time labels — display only, not a server poll.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (queue.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
        No one is waiting right now. Questions the front desk can&apos;t answer
        appear here in real time.
      </p>
    );
  }

  // Split live chat from email follow-ups so the operator can triage one channel
  // at a time — live parents are waiting on the line, email can be batched later.
  const liveCount = queue.filter((q) => q.delivery === "live").length;
  const emailCount = queue.filter((q) => q.delivery === "email").length;

  const filtered =
    deliveryFilter === "all"
      ? queue
      : queue.filter((q) => q.delivery === deliveryFilter);

  // Sort by how long the family has waited. Longest-first is the default (fair
  // triage); shortest-first lets an operator clear quick wins to trim the queue.
  const ordered = [...filtered].sort((a, b) => {
    const at = new Date(a.waitingSince).getTime();
    const bt = new Date(b.waitingSince).getTime();
    return sort === "longest" ? at - bt : bt - at;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs">
          {(
            [
              ["all", `All · ${queue.length}`],
              ["live", `🔴 Live · ${liveCount}`],
              ["email", `📧 Email · ${emailCount}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setDeliveryFilter(value)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                deliveryFilter === value
                  ? "bg-you text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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

      {ordered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          No {deliveryFilter === "live" ? "live chat" : "email"} follow-ups
          waiting right now.
        </p>
      ) : (
        ordered.map((item) => (
        <RelayCard
          key={item.sessionId}
          item={item}
          now={now}
          onOpen={() => setOpenEscalationId(item.primaryEscalationId)}
        />
        ))
      )}

      {openEscalationId && (
        <RelayChat
          escalationId={openEscalationId}
          passcode={passcode}
          operatorName={operatorName}
          onClose={() => setOpenEscalationId(undefined)}
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

/** A waiting family — a summary that opens into the full session thread. */
function RelayCard({
  item,
  now,
  onOpen,
}: {
  item: QueueItem;
  now: number;
  onOpen: () => void;
}) {
  const isEmail = item.delivery === "email";
  const parentLeft = item.delivery === "live" && !item.parentPresent;
  const count = item.pending.length;
  const parent = item.parentName || (isEmail ? "Email follow-up" : "Parent");

  return (
    <button
      onClick={onOpen}
      className="w-full rounded-xl border border-border bg-surface p-4 text-left transition hover:border-brand"
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        {isEmail ? (
          <span className="flex items-center gap-1.5 font-medium text-amber-700">
            📧 email follow-up · {elapsed(item.waitingSince, now)}
          </span>
        ) : parentLeft ? (
          <span className="flex items-center gap-1.5 font-medium text-amber-700">
            👋 parent left · {elapsed(item.waitingSince, now)}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-red-600">
            <span className="animate-softpulse">🔴</span> waiting ·{" "}
            {elapsed(item.waitingSince, now)}
          </span>
        )}
        <span className="rounded-full bg-you px-2 py-0.5 font-medium text-muted">
          {count} {count === 1 ? "question" : "questions"}
        </span>
      </div>

      <p className="truncate text-sm font-semibold">
        {parent}
        {item.parentEmail && (
          <span className="ml-1 font-normal text-muted">· {item.parentEmail}</span>
        )}
      </p>

      {/* The pending questions, so the operator sees what's open before entering. */}
      <ul className="mt-2 space-y-1">
        {item.pending.map((p) => (
          <li key={p.escalationId} className="flex items-start gap-1.5 text-[13px] text-foreground">
            <span aria-hidden className="mt-0.5 text-muted">
              •
            </span>
            <span className="line-clamp-2">
              “{p.question}”
              {p.isCaseSpecific && (
                <span className="ml-1 text-xs text-muted">· case-specific</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-strong">
        Open session to reply →
      </span>
    </button>
  );
}
