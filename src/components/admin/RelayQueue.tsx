"use client";

import { useCallback, useEffect, useState } from "react";
import { INTENTS, type Intent } from "@/lib/types";

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
};

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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {queue.length} waiting {queue.length === 1 ? "parent" : "parents"}
      </p>
      {queue.map((item) => (
        <RelayCard
          key={item.escalationId}
          item={item}
          now={now}
          operatorName={operatorName}
          passcode={passcode}
          onDone={refresh}
        />
      ))}
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
}: {
  item: QueueItem;
  now: number;
  operatorName: string;
  passcode: string;
  onDone: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [capture, setCapture] = useState(item.captureDefault);
  const [captureIntent, setCaptureIntent] = useState<Intent>(
    (item.intent && (INTENTS as readonly string[]).includes(item.intent)
      ? item.intent
      : "tours") as Intent,
  );
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string>();

  const isEmail = item.delivery === "email";
  // An email follow-up can't be sent until the parent leaves their address.
  const awaitingContact = isEmail && !item.contactEmail;

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
          capture,
          captureIntent: capture ? captureIntent : undefined,
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

      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        placeholder="Reply (relays to the parent now)…"
        className="mt-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[15px] outline-none focus:border-brand"
      />

      <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <input type="checkbox" checked={capture} onChange={(e) => setCapture(e.target.checked)} />
        Save as a policy
        {capture ? (
          <select
            value={captureIntent}
            onChange={(e) => setCaptureIntent(e.target.value as Intent)}
            className="rounded border border-border bg-surface px-1.5 py-0.5 text-sm"
          >
            {INTENTS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-muted">
            {item.isCaseSpecific ? "(off — specific case, not general policy)" : "(off)"}
          </span>
        )}
      </label>
      {capture && (
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
          ? "Sending…"
          : awaitingContact
            ? "Waiting for parent's email"
            : isEmail
              ? capture
                ? "Send email + Publish"
                : "Send email (simulated)"
              : capture
                ? "Send + Publish"
                : "Send to parent's chat"}
      </button>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
