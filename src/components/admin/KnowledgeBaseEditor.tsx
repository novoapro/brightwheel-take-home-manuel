"use client";

import { useCallback, useEffect, useState } from "react";
import { INTENTS, type Intent } from "@/lib/types";
import { adminFetch } from "./adminFetch";
import { inputCls } from "./ui";

type Entry = {
  id: string;
  intent: Intent;
  title: string;
  body_md: string;
  structured: Record<string, unknown>;
  keywords: string[];
  sensitivity: "none" | "sensitive";
  status: "published" | "draft" | "unpublished";
  origin: "seed" | "captured";
  source: string | null;
};

type Draft = {
  id?: string;
  intent: Intent;
  title: string;
  body_md: string;
  structuredText: string;
  keywords: string;
  sensitivity: "none" | "sensitive";
  status: "published" | "draft" | "unpublished";
  source: string;
};

const STATUS_LABEL: Record<Draft["status"], string> = {
  published: "✓ pub",
  draft: "draft",
  unpublished: "unpublished",
};

/** Knowledge Base editor (analysis/03 §4.3) — the operator-curated source of truth.
 *  The handbook is one source that feeds it; captured front-desk answers are another. */
export default function KnowledgeBaseEditor({
  passcode,
  operatorName,
}: {
  passcode: string;
  operatorName: string;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [intents, setIntents] = useState<string[]>([...INTENTS]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sensitivityFilter, setSensitivityFilter] = useState<"all" | Entry["sensitivity"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | Entry["status"]>("all");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  const NEW_CATEGORY = "__new__";

  const refresh = useCallback(async () => {
    const res = await adminFetch("/api/admin/knowledge", passcode);
    const data = await res.json();
    if (data.ok) {
      setEntries(data.entries);
      if (Array.isArray(data.intents) && data.intents.length) {
        setIntents(data.intents);
      }
    }
  }, [passcode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    refresh();
  }, [refresh]);

  function editExisting(p: Entry) {
    setError(undefined);
    setAddingCategory(false);
    setDraft({
      id: p.id,
      intent: p.intent,
      title: p.title,
      body_md: p.body_md,
      structuredText: JSON.stringify(p.structured, null, 2),
      keywords: p.keywords.join(", "),
      sensitivity: p.sensitivity,
      status: p.status,
      source: p.source ?? "",
    });
  }

  function newEntry() {
    setError(undefined);
    setAddingCategory(false);
    setDraft({
      intent: intents[0] ?? "hours",
      title: "",
      body_md: "",
      structuredText: "{}",
      keywords: "",
      sensitivity: "none",
      status: "draft",
      source: "",
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(undefined);
    try {
      const res = await adminFetch("/api/admin/knowledge", passcode, {
        method: draft.id ? "PUT" : "POST",
        body: JSON.stringify({
          id: draft.id,
          intent: draft.intent,
          title: draft.title,
          body_md: draft.body_md,
          structured: draft.structuredText,
          keywords: draft.keywords,
          sensitivity: draft.sensitivity,
          status: draft.status,
          source: draft.source,
          updated_by: operatorName || "Operator",
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Save failed.");
      setDraft(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    if (
      !window.confirm(
        `Delete "${draft.title}" from the knowledge base? This can't be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(undefined);
    try {
      const res = await adminFetch("/api/admin/knowledge", passcode, {
        method: "DELETE",
        body: JSON.stringify({ id: draft.id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Delete failed.");
      setDraft(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  if (draft) {
    const saveLabel = saving
      ? "Saving…"
      : draft.status === "published"
        ? "Publish"
        : draft.status === "unpublished"
          ? "Save (unpublished)"
          : "Save draft";
    return (
      <div className="flex flex-col gap-3">
        <button onClick={() => setDraft(null)} className="self-start text-sm text-muted">
          ‹ Back to list
        </button>
        <Field label="Title">
          <input className={inputCls} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <div className="flex gap-3">
          <Field label="Category">
            <select
              className={inputCls}
              value={addingCategory ? NEW_CATEGORY : draft.intent}
              onChange={(e) => {
                if (e.target.value === NEW_CATEGORY) {
                  setAddingCategory(true);
                  setDraft({ ...draft, intent: "" });
                } else {
                  setAddingCategory(false);
                  setDraft({ ...draft, intent: e.target.value });
                }
              }}
            >
              {/* Existing categories, plus the current custom value if not listed. */}
              {[...new Set([...intents, ...(draft.intent && !addingCategory ? [draft.intent] : [])])].map(
                (i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ),
              )}
              <option value={NEW_CATEGORY}>+ Add new category…</option>
            </select>
            {addingCategory && (
              <input
                className={`${inputCls} mt-1.5`}
                value={draft.intent}
                placeholder="e.g. transportation"
                autoFocus
                onChange={(e) => setDraft({ ...draft, intent: e.target.value })}
              />
            )}
          </Field>
          <Field label="Sensitivity">
            <select className={inputCls} value={draft.sensitivity} onChange={(e) => setDraft({ ...draft, sensitivity: e.target.value as "none" | "sensitive" })}>
              <option value="none">none</option>
              <option value="sensitive">sensitive</option>
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}>
              <option value="published">published</option>
              <option value="draft">draft</option>
              <option value="unpublished">unpublished</option>
            </select>
          </Field>
        </div>
        {draft.status === "unpublished" && (
          <p className="-mt-1 text-xs text-muted">
            Unpublished entries are kept but not served to parents.
          </p>
        )}
        <Field
          label="What parents see (markdown)"
          info={
            <p>
              The source of truth for this answer. The front desk rephrases it in
              its own warm voice — it won&apos;t quote this word-for-word — but it
              never changes the facts.
            </p>
          }
        >
          <textarea className={`${inputCls} min-h-28`} value={draft.body_md} onChange={(e) => setDraft({ ...draft, body_md: e.target.value })} />
        </Field>
        <Field
          label="Structured data (JSON) — powers deterministic answers"
          info={
            <>
              <p>
                <span className="font-medium text-foreground">Optional, but powerful.</span>{" "}
                A machine-readable copy of the facts in your answer — prices, ages,
                times, dates, thresholds — as JSON key/values. The front desk
                cross-checks every number and date it tells a parent against this
                (and the answer text above); a figure that doesn&apos;t match is
                blocked and sent to your team instead of shown. Leave it{" "}
                <code className="font-mono">{"{}"}</code> if the answer has no
                specific figures.
              </p>
              <p className="mt-1.5 rounded bg-you/60 px-2 py-1.5 font-mono text-[11px] text-foreground">
                {'{ "late_fee_usd": 15, "grace_minutes": 5, "after_strikes": 3 }'}
              </p>
            </>
          }
        >
          <textarea className={`${inputCls} min-h-28 font-mono text-xs`} value={draft.structuredText} onChange={(e) => setDraft({ ...draft, structuredText: e.target.value })} />
        </Field>
        <Field label="Keywords (comma-separated)">
          <input className={inputCls} value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} />
        </Field>
        <Field label="Source label">
          <input className={inputCls} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || deleting} className="rounded-lg bg-brand px-4 py-2.5 text-brand-fg disabled:opacity-40">
            {saveLabel}
          </button>
          {draft.id && (
            <button
              onClick={remove}
              disabled={saving || deleting}
              className="ml-auto rounded-lg border border-red-300 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/60 dark:hover:bg-red-950/40"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Group by category: known categories in canonical order, then any left over.
  const groupOrder = [
    ...intents,
    ...[...new Set(entries.map((e) => e.intent))].filter((i) => !intents.includes(i)),
  ];

  // Every category present in the data, for the category filter dropdown.
  const categoryOptions = groupOrder.filter((i) => entries.some((e) => e.intent === i));

  const filtered = entries.filter(
    (e) =>
      (categoryFilter === "all" || e.intent === categoryFilter) &&
      (sensitivityFilter === "all" || e.sensitivity === sensitivityFilter) &&
      (statusFilter === "all" || e.status === statusFilter),
  );
  const filtering = categoryFilter !== "all" || sensitivityFilter !== "all" || statusFilter !== "all";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {filtering ? `${filtered.length} of ${entries.length}` : entries.length} entries · the source of truth
        </p>
        <button onClick={newEntry} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-brand">
          + New
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter}>
          <option value="all">All categories</option>
          {categoryOptions.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Sensitivity"
          value={sensitivityFilter}
          onChange={(v) => setSensitivityFilter(v as "all" | Entry["sensitivity"])}
        >
          <option value="all">Any sensitivity</option>
          <option value="none">none</option>
          <option value="sensitive">sensitive</option>
        </FilterSelect>
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as "all" | Entry["status"])}
        >
          <option value="all">Any status</option>
          <option value="published">published</option>
          <option value="draft">draft</option>
          <option value="unpublished">unpublished</option>
        </FilterSelect>
        {filtering && (
          <button
            onClick={() => {
              setCategoryFilter("all");
              setSensitivityFilter("all");
              setStatusFilter("all");
            }}
            className="self-end rounded-lg px-2 py-1.5 text-xs text-muted hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          No entries match these filters.
        </p>
      )}
      {groupOrder.map((intent) => {
        const group = filtered.filter((p) => p.intent === intent);
        if (group.length === 0) return null;
        return (
          <section key={intent}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {intent} ({group.length})
            </h3>
            <div className="flex flex-col gap-1.5">
              {group.map((p) => (
                <button
                  key={p.id}
                  onClick={() => editExisting(p)}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-sm hover:border-brand"
                >
                  <span className="truncate">{p.title}</span>
                  <span className="ml-2 flex shrink-0 items-center gap-1.5 text-xs">
                    {p.origin === "captured" && <span className="text-brand-strong">✎ captured</span>}
                    {p.sensitivity === "sensitive" && <span className="text-amber-600">sensitive</span>}
                    <span className={p.status === "published" ? "text-foreground" : "text-muted"}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand"
      >
        {children}
      </select>
    </label>
  );
}

function Field({
  label,
  info,
  children,
}: {
  label: string;
  /** Optional explainer shown in a click-to-open ⓘ tooltip next to the label. */
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1 text-sm">
      <span className="flex items-center gap-1 text-xs font-medium text-muted">
        {label}
        {info && <InfoTip label={label}>{info}</InfoTip>}
      </span>
      {children}
    </div>
  );
}

/**
 * A small ⓘ affordance next to a field label: click to open a popover with the
 * explanation (and examples). Keeps the form itself uncluttered. Click-away and
 * Escape both dismiss it; mirrors the parent surface's presence popover.
 */
function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`About "${label}"`}
        className="grid h-4 w-4 place-items-center rounded-full border border-border text-[10px] font-semibold leading-none text-muted transition hover:border-brand hover:text-brand-strong"
      >
        i
      </button>
      {open && (
        <>
          {/* Click-away backdrop. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            role="dialog"
            aria-label={label}
            className="absolute left-0 top-full z-40 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-3 text-left text-xs font-normal leading-relaxed text-muted shadow-lg"
          >
            {children}
          </div>
        </>
      )}
    </span>
  );
}
