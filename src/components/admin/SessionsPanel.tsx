"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "./adminFetch";
import { ConfirmDialog, DeleteIconButton } from "./DangerUI";

type Session = {
  id: string;
  name: string;
  email: string;
  status: "open" | "closed";
  lastActiveAt: string;
  createdAt: string;
  closedReason: string | null;
  interactions: number;
  waitingRelays: number;
  removable: boolean;
};

type SessionFilter = "all" | "active" | "inactive";

function ago(iso: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

/**
 * Every parent session (analysis/11 §6). Active ones can be ended; inactive ones
 * can be selected and removed to clean up data — but never an active session, nor
 * one holding a pending live relay (server-enforced). Metrics live in the rollup,
 * so removal never affects the Dashboard.
 */
export default function SessionsPanel({ passcode }: { passcode: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  async function endSession(id: string) {
    await adminFetch("/api/admin/sessions", passcode, {
      method: "POST",
      body: JSON.stringify({ sessionId: id }),
    });
    refresh();
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const shown = sessions.filter((s) =>
    filter === "active" ? s.status === "open" : filter === "inactive" ? s.status === "closed" : true,
  );
  const removableShown = shown.filter((s) => s.removable);
  const allRemovableChecked =
    removableShown.length > 0 && removableShown.every((s) => checked.has(s.id));

  function selectAllRemovable() {
    setChecked(allRemovableChecked ? new Set() : new Set(removableShown.map((s) => s.id)));
  }

  async function removeSelected() {
    const res = await adminFetch("/api/admin/sessions", passcode, {
      method: "DELETE",
      body: JSON.stringify({ sessionIds: [...checked] }),
    });
    const d = await res.json();
    setConfirmOpen(false);
    if (d.ok) {
      setChecked(new Set());
      refresh();
    }
  }

  const FILTERS: { id: SessionFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "inactive", label: "Inactive" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Filter + bulk actions on one line. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Session filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filter === f.id
                  ? "bg-brand text-brand-fg"
                  : "border border-border bg-surface text-muted hover:bg-you"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">
          {shown.length} {shown.length === 1 ? "session" : "sessions"}
        </span>
      </div>

      {checked.size > 0 && (
        <div className="flex items-center gap-2 px-1 py-1 text-xs">
          <span className="font-medium">{checked.size} selected</span>
          <div className="ml-auto">
            <DeleteIconButton onClick={() => setConfirmOpen(true)} label="Remove selected sessions" />
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          No {filter === "all" ? "" : `${filter} `}sessions. They appear here when a parent signs in.
        </p>
      ) : (
        <>
          {removableShown.length > 0 && (
            <button
              onClick={selectAllRemovable}
              className="self-start text-xs text-brand-strong hover:underline"
            >
              {allRemovableChecked ? "Deselect all" : `Select all inactive (${removableShown.length})`}
            </button>
          )}
          {shown.map((s) => {
            const active = s.status === "open";
            return (
              <div
                key={s.id}
                className={`flex items-center gap-3 rounded-xl border bg-surface p-4 ${
                  checked.has(s.id) ? "border-brand" : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked.has(s.id)}
                  onChange={() => toggle(s.id)}
                  disabled={!s.removable}
                  aria-label={`Select ${s.name}'s session`}
                  title={
                    s.removable
                      ? undefined
                      : active
                        ? "Active sessions can't be removed"
                        : "This session has a pending live relay"
                  }
                  className="h-4 w-4 shrink-0 disabled:opacity-30"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    {active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-600/10 px-2 py-0.5 text-[10px] font-medium text-green-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-600" /> Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-you px-2 py-0.5 text-[10px] font-medium text-muted">
                        Closed{s.closedReason ? ` · ${s.closedReason}` : ""}
                      </span>
                    )}
                    {s.waitingRelays > 0 && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                        ● live relay pending
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted">{s.email}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {s.interactions} {s.interactions === 1 ? "turn" : "turns"} · active {ago(s.lastActiveAt, now)}
                  </p>
                </div>
                {active && (
                  <button
                    onClick={() => endSession(s.id)}
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:border-red-400 hover:text-red-600"
                  >
                    End session
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Remove selected sessions"
          message={`Permanently remove ${checked.size} inactive ${
            checked.size === 1 ? "session" : "sessions"
          } and their chats? Dashboard metrics are kept. Active sessions and any with a pending live relay are skipped.`}
          confirmLabel="Remove"
          onConfirm={removeSelected}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
