"use client";

import { useCallback, useEffect, useState } from "react";
import { INTENTS, type Intent } from "@/lib/types";

type Policy = {
  id: string;
  intent: Intent;
  title: string;
  body_md: string;
  structured: Record<string, unknown>;
  keywords: string[];
  sensitivity: "none" | "sensitive";
  status: "published" | "draft";
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
  status: "published" | "draft";
  source: string;
};

/** Source-of-truth editor (analysis/03 §4.3) — edit prose AND structured data. */
export default function HandbookEditor({
  passcode,
  operatorName,
}: {
  passcode: string;
  operatorName: string;
}) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/policies", {
      headers: { "x-admin-passcode": passcode },
    });
    const data = await res.json();
    if (data.ok) setPolicies(data.policies);
  }, [passcode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    refresh();
  }, [refresh]);

  function editExisting(p: Policy) {
    setError(undefined);
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

  function newPolicy() {
    setError(undefined);
    setDraft({
      intent: "hours",
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
      const res = await fetch("/api/admin/policies", {
        method: draft.id ? "PUT" : "POST",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
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

  if (draft) {
    return (
      <div className="flex flex-col gap-3">
        <button onClick={() => setDraft(null)} className="self-start text-sm text-muted">
          ‹ Back to list
        </button>
        <Field label="Title">
          <input className={inputCls} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <div className="flex gap-3">
          <Field label="Intent">
            <select className={inputCls} value={draft.intent} onChange={(e) => setDraft({ ...draft, intent: e.target.value as Intent })}>
              {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Sensitivity">
            <select className={inputCls} value={draft.sensitivity} onChange={(e) => setDraft({ ...draft, sensitivity: e.target.value as "none" | "sensitive" })}>
              <option value="none">none</option>
              <option value="sensitive">sensitive</option>
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as "published" | "draft" })}>
              <option value="published">published</option>
              <option value="draft">draft</option>
            </select>
          </Field>
        </div>
        <Field label="What parents see (markdown)">
          <textarea className={`${inputCls} min-h-28`} value={draft.body_md} onChange={(e) => setDraft({ ...draft, body_md: e.target.value })} />
        </Field>
        <Field label="Structured data (JSON) — powers deterministic answers">
          <textarea className={`${inputCls} min-h-28 font-mono text-xs`} value={draft.structuredText} onChange={(e) => setDraft({ ...draft, structuredText: e.target.value })} />
        </Field>
        <Field label="Keywords (comma-separated)">
          <input className={inputCls} value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} />
        </Field>
        <Field label="Source label">
          <input className={inputCls} value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2.5 text-brand-fg disabled:opacity-40">
          {saving ? "Saving…" : draft.status === "published" ? "Publish" : "Save draft"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{policies.length} policies · the source of truth</p>
        <button onClick={newPolicy} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-brand">
          + New
        </button>
      </div>
      {INTENTS.map((intent) => {
        const group = policies.filter((p) => p.intent === intent);
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
                    <span className={p.status === "published" ? "text-brand-strong" : "text-muted"}>
                      {p.status === "published" ? "✓ pub" : "draft"}
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

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
