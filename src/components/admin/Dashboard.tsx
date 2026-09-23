"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "./adminFetch";

type Metrics = {
  total: number;
  answered: number;
  escalated: number;
  containmentRate: number;
  escalationRate: number;
  attributionRate: number;
  groundedness: number | null;
  hoursSaved: number;
  avgHandleMinutes: number;
  thumbsUp: number;
  thumbsDown: number;
  capturedEntries: number;
  waiting: number;
  topGaps: { question: string; count: number; intent: string | null }[];
  byProvider: { provider: string; total: number; containmentRate: number; groundedness: number | null }[];
};

// Kept in sync with TIME_RANGES in lib/metrics — defined locally so this client
// component doesn't pull the server-only metrics module into the bundle.
type TimeRange = "today" | "week" | "month" | "all";
const RANGES: { id: TimeRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "Last 30 days" },
  { id: "all", label: "All time" },
];

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** The owner's 10-second read (analysis/03 §4.1, analysis/05). Hero = hours saved. */
export default function Dashboard({
  passcode,
  liveWaiting,
  onOpenGaps,
  onOpenRelay,
}: {
  passcode: string;
  /** Live waiting-relay count from the shell's SSE stream; overrides the fetched
   *  snapshot so the widget updates the instant a relay arrives — no refetch. */
  liveWaiting?: number;
  onOpenGaps: () => void;
  onOpenRelay: () => void;
}) {
  const [m, setM] = useState<Metrics>();
  const [range, setRange] = useState<TimeRange>("week");
  // The range whose data is currently shown; when it lags `range`, a fetch is
  // in flight. Deriving loading this way avoids a setState in the effect body.
  const [loadedRange, setLoadedRange] = useState<TimeRange>();

  useEffect(() => {
    let live = true;
    adminFetch(`/api/admin/dashboard?range=${range}`, passcode)
      .then((r) => r.json())
      .then((d) => {
        if (live && d.ok) {
          setM(d.metrics);
          setLoadedRange(range);
        }
      })
      .catch(() => {
        /* transient fetch error — the poll-free effect retries on the next range change */
      });
    return () => {
      live = false;
    };
  }, [passcode, range]);

  const loading = loadedRange !== range;
  const rangeLabel = RANGES.find((r) => r.id === range)!.label;

  return (
    <div className="flex flex-col gap-4">
      {/*
        Open escalations — the single most important thing on the dashboard, so
        it leads. Deliberately NOT scoped by the date filter: an open escalation
        is a parent waiting right now, not a historical stat.
      */}
      <OpenEscalations waiting={liveWaiting ?? m?.waiting ?? 0} loading={!m} onOpenRelay={onOpenRelay} />

      {/* Date-range quick filter — scopes everything below. */}
      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                range === r.id
                  ? "bg-brand text-brand-fg"
                  : "border border-border bg-surface text-muted hover:bg-you"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {loading && m && <span className="text-xs text-muted">Updating…</span>}
      </div>

      {!m ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          {/* Hero — the ROI number */}
          <div className="rounded-2xl bg-brand p-5 text-brand-fg">
            <p className="text-xs uppercase tracking-wide opacity-80">{rangeLabel}</p>
            <p className="mt-1 text-4xl font-bold">{m.hoursSaved.toFixed(1)} hrs</p>
            <p className="text-sm opacity-90">saved at the front desk</p>
            <p className="mt-2 text-xs opacity-80">
              {pct(m.containmentRate)} handled by the Front Desk AI Assistant · {pct(m.escalationRate)} to you.
            </p>
            <p className="mt-2 text-sm opacity-80">~ {m.avgHandleMinutes} min/inquiry</p>
          </div>

          {/* Trust */}
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Groundedness" value={m.groundedness == null ? "—" : pct(m.groundedness)} />
            <Stat label="Answers with a source" value={pct(m.attributionRate)} />
            <Stat label={`Interactions · ${rangeLabel.toLowerCase()}`} value={String(m.total)} />
            <Stat label="👍 / 👎" value={`${m.thumbsUp} / ${m.thumbsDown}`} />
            <Stat label="Captured into Knowledge Base" value={String(m.capturedEntries)} />
            <Stat label="Escalated to you" value={pct(m.escalationRate)} />
          </div>

          {/* Top gaps → curation */}
          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Top gaps</h2>
              <button onClick={onOpenGaps} className="text-xs text-brand-strong hover:underline">
                Add a policy →
              </button>
            </div>
            {m.topGaps.length === 0 ? (
              <p className="text-sm text-muted">No recurring gaps — nice.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {m.topGaps.map((g) => (
                  <li key={g.question} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">“{g.question}”</span>
                    <span className="shrink-0 rounded-full bg-you px-2 py-0.5 text-xs text-muted">
                      asked {g.count}×
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {m.byProvider.length > 0 && (
            <section className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Provider A/B</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1">Provider</th>
                    <th>Traffic</th>
                    <th>Containment</th>
                    <th>Groundedness</th>
                  </tr>
                </thead>
                <tbody>
                  {m.byProvider.map((p) => (
                    <tr key={p.provider} className="border-t border-border">
                      <td className="py-1.5 font-medium">{p.provider}</td>
                      <td>{p.total}</td>
                      <td>{pct(p.containmentRate)}</td>
                      <td>{p.groundedness == null ? "—" : pct(p.groundedness)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The dashboard's lead element: how many parents are waiting on a human right
 * now. When any are waiting it's an urgent call to action; when none are, it's a
 * calm "all caught up" reassurance — either way it's the first thing the owner
 * sees, front and center (not buried at the bottom).
 */
function OpenEscalations({
  waiting,
  loading,
  onOpenRelay,
}: {
  waiting: number;
  loading: boolean;
  onOpenRelay: () => void;
}) {
  if (loading) {
    return <div className="h-[92px] animate-pulse rounded-2xl border border-border bg-surface" />;
  }

  if (waiting === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-green-600/25 bg-green-600/5 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-green-600/10 text-lg text-green-700">
          ✓
        </span>
        <div>
          <p className="text-sm font-semibold text-green-800">You&apos;re all caught up</p>
          <p className="text-xs text-green-700/80">No parents are waiting on the front desk.</p>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onOpenRelay}
      className="flex w-full items-center gap-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-left transition hover:bg-red-500/15"
    >
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
      </span>
      <div className="flex-1">
        <p className="text-3xl font-bold leading-none text-red-700">{waiting}</p>
        <p className="mt-1 text-sm font-medium text-red-800">
          open escalation{waiting === 1 ? "" : "s"} waiting on you
        </p>
      </div>
      <span className="shrink-0 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white">
        Open Live relay →
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
