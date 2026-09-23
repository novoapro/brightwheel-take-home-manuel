"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "./adminFetch";

type Session = {
  id: string;
  name: string;
  email: string;
  lastActiveAt: string;
  createdAt: string;
};

function ago(iso: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

/**
 * Open parent sessions (analysis/11 §6). The agent can end any session from here;
 * sessions also close themselves after 30 minutes of inactivity.
 */
export default function SessionsPanel({ passcode }: { passcode: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const res = await adminFetch("/api/admin/sessions", passcode);
    const d = await res.json();
    if (d.ok) setSessions(d.sessions);
  }, [passcode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    refresh();
    const poll = setInterval(refresh, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  async function close(id: string) {
    await adminFetch("/api/admin/sessions", passcode, {
      method: "POST",
      body: JSON.stringify({ sessionId: id }),
    });
    refresh();
  }

  if (sessions.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
        No active parent sessions. They appear here when a parent signs in, and
        close after 30 minutes of inactivity.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {sessions.length} active {sessions.length === 1 ? "session" : "sessions"}
      </p>
      {sessions.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{s.name}</p>
            <p className="truncate text-xs text-muted">{s.email}</p>
            <p className="mt-0.5 text-xs text-muted">active {ago(s.lastActiveAt, now)}</p>
          </div>
          <button
            onClick={() => close(s.id)}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:border-red-400 hover:text-red-600"
          >
            End session
          </button>
        </div>
      ))}
    </div>
  );
}
