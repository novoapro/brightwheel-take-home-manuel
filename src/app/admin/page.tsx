"use client";

import { useCallback, useEffect, useState } from "react";
import { INTENTS, type Intent } from "@/lib/types";

/**
 * Operator control center — M4 ships the Live relay queue (analysis/03 §4.2):
 * waiting parents, the operator's reply relays into the parent thread live, and
 * one-tap context-aware capture promotes a general answer to a citable policy.
 * Dashboard / Handbook / Settings tabs arrive in M5–M6. Mock passcode gate (§9).
 */

type QueueItem = {
  escalationId: string;
  question: string;
  intent: string | null;
  reason: string;
  isCaseSpecific: boolean;
  aiReferenced: string[];
  waitingSince: string;
  captureDefault: boolean;
};

export default function AdminPage() {
  const [passcode, setPasscode] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string>();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [operatorName, setOperatorName] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [authCode, setAuthCode] = useState("");

  const refresh = useCallback(
    async (code = authCode) => {
      const res = await fetch("/api/admin/relay/queue", {
        headers: { "x-admin-passcode": code },
      });
      if (res.status === 401) {
        setAuthed(false);
        setError("Invalid passcode.");
        return false;
      }
      const data = await res.json();
      if (data.ok) setQueue(data.queue);
      return true;
    },
    [authCode],
  );

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setAuthCode(passcode);
    const ok = await refresh(passcode);
    if (ok) setAuthed(true);
  }

  // Poll the queue + tick the waiting timers while signed in.
  useEffect(() => {
    if (!authed) return;
    const poll = setInterval(refresh, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [authed, refresh]);

  if (!authed) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-6">
        <h1 className="text-lg font-semibold">🌰 Control Center</h1>
        <p className="text-sm text-muted">Enter the operator passcode.</p>
        <form onSubmit={login} className="flex flex-col gap-3">
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            className="rounded-lg border border-border bg-surface px-3 py-2.5 outline-none focus:border-brand"
            autoFocus
          />
          <button className="rounded-lg bg-brand px-4 py-2.5 text-brand-fg">Sign in</button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 px-4 py-5">
      <header className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h1 className="text-base font-semibold">🌰 Live relay</h1>
          <p className="text-xs text-muted">
            {queue.length} waiting {queue.length === 1 ? "parent" : "parents"}
          </p>
        </div>
        <input
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          placeholder="Your name"
          className="w-32 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
      </header>

      {queue.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          No one is waiting right now. New questions the front desk can&apos;t
          answer will appear here in real time.
        </p>
      ) : (
        queue.map((item) => (
          <RelayCard
            key={item.escalationId}
            item={item}
            now={now}
            operatorName={operatorName}
            passcode={authCode}
            onDone={refresh}
          />
        ))
      )}
    </main>
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

  async function send() {
    if (!answer.trim() || sending) return;
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
        <span className="flex items-center gap-1.5 font-medium text-red-600">
          <span className="animate-softpulse">🔴</span> waiting · {elapsed(item.waitingSince, now)}
        </span>
        <span className="rounded-full bg-you px-2 py-0.5 text-muted">
          {item.intent ?? "out of scope"}
          {item.isCaseSpecific ? " · case-specific" : ""}
        </span>
      </div>

      <p className="text-[15px] font-medium">“{item.question}”</p>
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

      <label className="mt-2 flex items-center gap-2 text-sm">
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
        disabled={!answer.trim() || sending}
        className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-brand-fg disabled:opacity-40"
      >
        {sending ? "Sending…" : capture ? "Send + Publish" : "Send to parent's chat"}
      </button>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
