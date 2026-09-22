"use client";

import { useEffect, useState } from "react";

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
  capturedPolicies: number;
  waiting: number;
  topGaps: { question: string; count: number; intent: string | null }[];
};

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** The owner's 10-second read (analysis/03 §4.1, analysis/05). Hero = hours saved. */
export default function Dashboard({
  passcode,
  onOpenGaps,
}: {
  passcode: string;
  onOpenGaps: () => void;
}) {
  const [m, setM] = useState<Metrics>();

  useEffect(() => {
    fetch("/api/admin/dashboard", { headers: { "x-admin-passcode": passcode } })
      .then((r) => r.json())
      .then((d) => d.ok && setM(d.metrics));
  }, [passcode]);

  if (!m) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero — the ROI number */}
      <div className="rounded-2xl bg-brand p-5 text-brand-fg">
        <p className="text-xs uppercase tracking-wide opacity-80">This week</p>
        <p className="mt-1 text-4xl font-bold">{m.hoursSaved.toFixed(1)} hrs</p>
        <p className="text-sm opacity-90">saved at the front desk</p>
        <p className="mt-2 text-xs opacity-80">
          {pct(m.containmentRate)} handled by the front desk · {pct(m.escalationRate)} to you
          {" · "}~{m.avgHandleMinutes} min/inquiry
        </p>
      </div>

      {/* Trust */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Groundedness" value={m.groundedness == null ? "—" : pct(m.groundedness)} />
        <Stat label="Answers with a source" value={pct(m.attributionRate)} />
        <Stat label="Interactions this week" value={String(m.total)} />
        <Stat label="👍 / 👎" value={`${m.thumbsUp} / ${m.thumbsDown}`} />
        <Stat label="Captured into handbook" value={String(m.capturedPolicies)} />
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

      {m.waiting > 0 && (
        <p className="text-sm text-red-600">⚠ {m.waiting} escalation{m.waiting === 1 ? "" : "s"} waiting — see Live relay.</p>
      )}
    </div>
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
