"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "./adminFetch";
import { ConfirmDialog, DeleteIconButton } from "./DangerUI";

/**
 * The operator Audit surface (analysis/05 §5): browse sessions in two modes —
 * all, or only those that did not receive a good review — and drill into one to
 * see the transcript, each turn's guardrail decision, and the retained "what we
 * sent / what we expected" envelope. A purge action reclaims space.
 */

type AuditMode = "off" | "flagged" | "all";
type Filter = "all" | "flagged";

type AuditSession = {
  session_id: string;
  name: string;
  email: string;
  status: "open" | "closed";
  closed_reason: string | null;
  created_at: string;
  last_active_at: string;
  rating: "up" | "down" | null;
  review: string | null;
  rated_at: string | null;
  interactions: number;
  answered: number;
  escalated: number;
  retained: number;
};

type Envelope = {
  system_prompt: string | null;
  messages: { role: string; content: string }[];
  raw_proposal: unknown;
  created_at: string;
};

type Interaction = {
  id: string;
  timestamp: string;
  parent_question: string;
  detected_intent: string | null;
  decision: "answered" | "escalated";
  decision_reason: string;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  response_text: string | null;
  cited_sources: string[];
  checks: Record<string, string> | null;
  judge_scores: { groundedness?: number; answer_relevancy?: number } | null;
  envelope: Envelope | null;
};

type Detail = {
  ok: boolean;
  auditMode: AuditMode;
  session: AuditSession & { rated_at: string | null };
  messages: {
    id: string;
    role: "parent" | "frontdesk";
    provenance: string | null;
    text: string;
    created_at: string;
  }[];
  interactions: Interaction[];
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function RatingBadge({ rating }: { rating: "up" | "down" | null }) {
  if (rating === "up") return <span title="Rated good">👍</span>;
  if (rating === "down") return <span title="Rated poor">👎</span>;
  return <span className="text-muted" title="Not rated">—</span>;
}

export default function AuditPanel({ passcode }: { passcode: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [auditMode, setAuditMode] = useState<AuditMode>();
  const [retained, setRetained] = useState(0);
  const [sessions, setSessions] = useState<AuditSession[]>();
  const [selected, setSelected] = useState<string>();
  // Multi-select for bulk removal (distinct from `selected`, the drill-in id).
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // "Select all" is a mode: deleting then clears ALL audit data (scope "all"),
  // so it works even if not every session is rendered.
  const [allSelected, setAllSelected] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await adminFetch(`/api/admin/audit?mode=${filter}`, passcode);
    const d = await r.json();
    if (d.ok) {
      setSessions(d.sessions);
      setAuditMode(d.auditMode);
      setRetained(d.retained);
      setChecked(new Set());
      setAllSelected(false);
    }
  }, [passcode, filter]);

  function clearSelection() {
    setChecked(new Set());
    setAllSelected(false);
  }

  function toggleChecked(id: string) {
    // Leaving "select all" by touching a single row: fall back to an explicit set
    // of everything rendered, minus the one just toggled off.
    if (allSelected) {
      const base = new Set((sessions ?? []).map((s) => s.session_id));
      base.delete(id);
      setAllSelected(false);
      setChecked(base);
      return;
    }
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    void load();
  }, [load]);

  // The bulk delete: "select all" clears ALL audit data; otherwise just the
  // checked sessions. Metrics are unaffected either way (they live in the rollup).
  async function confirmDelete() {
    const body = allSelected ? { scope: "all" } : { sessionIds: [...checked] };
    const r = await adminFetch("/api/admin/audit/purge", passcode, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const d = await r.json();
    setDeleteOpen(false);
    if (d.ok) {
      clearSelection();
      if (selected) setSelected(undefined);
      void load();
    }
  }

  if (selected) {
    return <SessionDetail passcode={passcode} sessionId={selected} onBack={() => setSelected(undefined)} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-surface p-4 shadow-card md:p-5">
        <h2 className="mb-1 text-sm font-semibold">Interaction audit</h2>
        <p className="mb-3 text-xs text-muted">
          Sessions with retained LLM troubleshooting detail — what we sent the model
          and what it returned. Removing detail here doesn&apos;t delete the session
          (manage those in the <b>Sessions</b> view); it just drops it from this list.
        </p>

        {/* One line: filter · mode/retained · clear-all CTA. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5" role="group" aria-label="Audit filter">
            {(
              [
                { id: "all", label: "All sessions" },
                { id: "flagged", label: "Needs review" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                aria-pressed={filter === t.id}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  filter === t.id
                    ? "bg-brand text-brand-fg"
                    : "border border-border bg-surface text-muted hover:bg-you"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-muted">
            Collecting: <b>{auditMode ?? "…"}</b><br/>
            Retained: <b>{retained}</b>
          </span>
        </div>
      </section>

      {!sessions ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          {filter === "flagged"
            ? "No flagged sessions with troubleshooting detail."
            : "No retained troubleshooting detail. It appears here as parents chat while audit is collecting."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Bulk-select bar — appears once anything is checked. */}
          {(checked.size > 0 || allSelected) && (
            <div className="flex items-center gap-2 px-1 py-1 text-xs">
              <span className="font-medium">
                {allSelected ? "All audit data selected" : `${checked.size} selected`}
              </span>
              <div className="ml-auto">
                <DeleteIconButton
                  onClick={() => setDeleteOpen(true)}
                  label={allSelected ? "Clear all troubleshooting detail" : "Remove troubleshooting detail"}
                />
              </div>
            </div>
          )}

          {/* Same select-all/deselect-all affordance as the Sessions view. */}
          <button
            onClick={() => (allSelected ? clearSelection() : setAllSelected(true))}
            className="self-start text-xs text-brand-strong hover:underline"
          >
            {allSelected ? "Deselect all" : `Select all (${sessions.length})`}
          </button>

          {sessions.map((s) => (
            <div
              key={s.session_id}
              className={`flex items-center gap-3 rounded-xl border bg-surface p-4 transition ${
                allSelected || checked.has(s.session_id) ? "border-brand" : "border-border"
              }`}
            >
              <input
                type="checkbox"
                checked={allSelected || checked.has(s.session_id)}
                onChange={() => toggleChecked(s.session_id)}
                aria-label={`Select ${s.name}'s session`}
                className="h-4 w-4 shrink-0"
              />
              <button
                onClick={() => setSelected(s.session_id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="text-lg leading-none">
                  <RatingBadge rating={s.rating} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted">
                    {fmt(s.last_active_at)} · {s.interactions} turn{s.interactions === 1 ? "" : "s"} ·{" "}
                    {s.answered} answered / {s.escalated} escalated
                  </p>
                  {s.review && <p className="mt-0.5 truncate text-xs italic text-muted">“{s.review}”</p>}
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {s.retained > 0 ? `${s.retained} detail` : "—"}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {deleteOpen &&
        (allSelected ? (
          <ConfirmDialog
            title="Clear troubleshooting detail"
            message="Remove the stored LLM troubleshooting detail for every session here? The sessions and their chats stay (see the Sessions view); Dashboard metrics are kept."
            confirmLabel="Clear all"
            onConfirm={confirmDelete}
            onClose={() => setDeleteOpen(false)}
          />
        ) : (
          <ConfirmDialog
            title="Remove troubleshooting detail"
            message={`Remove the troubleshooting detail for ${checked.size} selected ${
              checked.size === 1 ? "session" : "sessions"
            }? The ${
              checked.size === 1 ? "session" : "sessions"
            } stay in the Sessions view; Dashboard metrics are kept.`}
            confirmLabel="Remove"
            onConfirm={confirmDelete}
            onClose={() => setDeleteOpen(false)}
          />
        ))}
    </div>
  );
}

function SessionDetail({
  passcode,
  sessionId,
  onBack,
}: {
  passcode: string;
  sessionId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<Detail>();

  useEffect(() => {
    let live = true;
    adminFetch(`/api/admin/audit/session?sessionId=${encodeURIComponent(sessionId)}`, passcode)
      .then((r) => r.json())
      .then((d) => live && d.ok && setDetail(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [passcode, sessionId]);

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="self-start text-xs text-brand-strong hover:underline">
        ← Back to sessions
      </button>

      {!detail ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{detail.session.name}</p>
                <p className="truncate text-xs text-muted">{detail.session.email}</p>
              </div>
              <div className="shrink-0 text-right text-xs text-muted">
                <p className="text-lg leading-none">
                  <RatingBadge rating={detail.session.rating} />
                </p>
                <p className="mt-1">{detail.session.status}{detail.session.closed_reason ? ` · ${detail.session.closed_reason}` : ""}</p>
              </div>
            </div>
            {detail.session.review && (
              <p className="mt-2 rounded-lg bg-you px-3 py-2 text-xs italic text-muted">
                “{detail.session.review}”
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Turns ({detail.interactions.length})
            </h3>
            {detail.interactions.map((it) => (
              <InteractionCard key={it.id} it={it} auditMode={detail.auditMode} />
            ))}
            {detail.interactions.length === 0 && (
              <p className="text-sm text-muted">No recorded turns for this session.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function InteractionCard({ it, auditMode }: { it: Interaction; auditMode: AuditMode }) {
  const [showEnvelope, setShowEnvelope] = useState(false);
  const answered = it.decision === "answered";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">“{it.parent_question}”</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            answered ? "bg-green-600/10 text-green-800" : "bg-amber-500/10 text-amber-800"
          }`}
        >
          {it.decision}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted">{fmt(it.timestamp)} · {it.detected_intent ?? "—"}</p>

      {it.response_text && (
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-you px-3 py-2 text-sm">{it.response_text}</p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Row k="Reason" v={it.decision_reason} />
        <Row k="Confidence" v={it.confidence == null ? "—" : it.confidence.toFixed(2)} />
        <Row k="Citations" v={it.cited_sources.length ? it.cited_sources.join(", ") : "none"} />
        <Row
          k="Groundedness"
          v={it.judge_scores?.groundedness == null ? "—" : it.judge_scores.groundedness.toFixed(2)}
        />
        <Row k="Model" v={`${it.provider ?? "—"} · ${it.model ?? "—"}`} />
      </dl>

      {it.checks && Object.keys(it.checks).length > 0 && (
        <GuardrailChecks checks={it.checks} />
      )}

      {it.envelope ? (
        <div className="mt-3">
          <button
            onClick={() => setShowEnvelope((v) => !v)}
            className="text-xs font-medium text-brand-strong hover:underline"
          >
            {showEnvelope ? "Hide" : "Show"} what we sent / what we expected
          </button>
          {showEnvelope && (
            <div className="mt-2 flex flex-col gap-3">
              <Envelope label="System prompt (sent)" body={it.envelope.system_prompt ?? "(none)"} />
              <Envelope label="Messages (sent)" body={JSON.stringify(it.envelope.messages, null, 2)} />
              <Envelope label="Raw model proposal (received)" body={JSON.stringify(it.envelope.raw_proposal, null, 2)} />
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted">
          Troubleshooting detail not retained
          {auditMode === "off"
            ? " — audit is off."
            : auditMode === "flagged"
              ? " — this session was rated 👍 under “flagged” audit mode."
              : "."}
        </p>
      )}
    </div>
  );
}

/** Human labels for the deterministic guardrail checks (see guardrails/decide.ts). */
const GUARDRAIL_LABELS: Record<string, string> = {
  citation_valid: "Citation valid",
  fact_match: "Fact-check",
  groundedness_gate: "Groundedness gate",
};

/** The three inline guardrail results, collapsed by default — one `name: status`
 *  per line when expanded. Collapsed, it summarizes whether anything failed. */
function GuardrailChecks({ checks }: { checks: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  // Canonical order first, then any unexpected keys, so the display is stable.
  const order = ["citation_valid", "fact_match", "groundedness_gate"];
  const keys = [
    ...order.filter((k) => k in checks),
    ...Object.keys(checks).filter((k) => !order.includes(k)),
  ];
  const failed = keys.filter((k) => checks[k] === "fail").length;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium text-brand-strong hover:underline"
      >
        <span aria-hidden className="text-[10px]">{open ? "▾" : "▸"}</span>
        Guardrails
        <span className={`font-normal ${failed > 0 ? "text-red-600 dark:text-red-500" : "text-muted"}`}>
          ({failed > 0 ? `${failed} failed` : "all clear"})
        </span>
      </button>
      {open && (
        <dl className="mt-2 divide-y divide-border rounded-lg border border-border bg-background text-xs">
          {keys.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <dt className="text-muted">{GUARDRAIL_LABELS[k] ?? k}</dt>
              <dd>
                <GuardrailStatus state={checks[k]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function GuardrailStatus({ state }: { state: string }) {
  const cfg =
    state === "pass"
      ? { cls: "text-green-700 dark:text-green-500", mark: "✓" }
      : state === "fail"
        ? { cls: "text-red-600 dark:text-red-500", mark: "✗" }
        : { cls: "text-muted", mark: "–" };
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${cfg.cls}`}>
      <span aria-hidden>{cfg.mark}</span>
      {state}
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="truncate font-medium">{v}</dd>
    </>
  );
}

function Envelope({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 text-[11px] leading-relaxed">
        {body}
      </pre>
    </div>
  );
}
