"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INTENTS, type Category, type CategorySensitivity, type Intent } from "@/lib/types";
import { adminFetch } from "./adminFetch";
import { ConfirmDialog, TrashIcon, XIcon } from "./DangerUI";
import { inputCls } from "./ui";

type Entry = {
  id: string;
  intent: Intent;
  title: string;
  body_md: string;
  structured: Record<string, unknown>;
  keywords: string[];
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
  status: "published" | "draft" | "unpublished";
  source: string;
};

const STATUS_LABEL: Record<Draft["status"], string> = {
  published: "✓",
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
  const [categories, setCategories] = useState<Category[]>([]);
  const [managingCategories, setManagingCategories] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | Entry["status"]>("all");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const NEW_CATEGORY = "__new__";

  const refresh = useCallback(async () => {
    const res = await adminFetch("/api/admin/knowledge", passcode);
    const data = await res.json();
    if (data.ok) {
      setEntries(data.entries);
      if (Array.isArray(data.intents) && data.intents.length) {
        setIntents(data.intents);
      }
      if (Array.isArray(data.categories)) {
        setCategories(data.categories);
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

  /** Import a { entries: [...] } JSON file (the handbook-to-knowledge-base shape). */
  async function importFile(file: File) {
    setError(undefined);
    setNotice(undefined);
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      const entries = Array.isArray(parsed)
        ? parsed
        : (parsed as { entries?: unknown }).entries;
      const res = await adminFetch("/api/admin/knowledge/import", passcode, {
        method: "POST",
        body: JSON.stringify({ entries, updated_by: operatorName || "Operator" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Import failed.");
      setNotice(
        `Imported ${data.imported} ${data.imported === 1 ? "entry" : "entries"}.`,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  /** Wipe the whole knowledge base (confirmed via the ConfirmDialog). */
  async function clearAll() {
    setError(undefined);
    setNotice(undefined);
    setClearing(true);
    try {
      const res = await adminFetch("/api/admin/knowledge/clear", passcode, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Clear failed.");
      setNotice(
        `Cleared ${data.removed} ${data.removed === 1 ? "entry" : "entries"}.`,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClearing(false);
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
                times, dates, thresholds — as JSON key/values. The front desk AI Assistant
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
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
              className="ml-auto rounded-lg border border-red-300 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/60 dark:hover:bg-red-950/40"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
        {confirmDelete && (
          <ConfirmDialog
            title="Delete this entry?"
            message={`This permanently removes “${draft.title}” from the knowledge base. This can't be undone.`}
            confirmLabel="Delete"
            onConfirm={() => {
              setConfirmDelete(false);
              remove();
            }}
            onClose={() => setConfirmDelete(false)}
          />
        )}
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

  // Each category's sensitivity tier — drives the list-header badge.
  const tierByName = new Map(categories.map((c) => [c.name, c.sensitivity]));

  // Keyword search: split on whitespace and require EVERY term to appear somewhere
  // in the entry's searchable text (title, body, keywords, category, id) — an AND
  // match so "fever toddler" narrows rather than widens.
  const terms = keywordFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchesKeywords = (e: Entry) => {
    if (terms.length === 0) return true;
    const hay =
      `${e.title} ${e.body_md} ${e.keywords.join(" ")} ${e.intent} ${e.id}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  };

  const filtered = entries.filter(
    (e) =>
      (categoryFilter === "all" || e.intent === categoryFilter) &&
      (statusFilter === "all" || e.status === statusFilter) &&
      matchesKeywords(e),
  );
  const filtering =
    categoryFilter !== "all" || statusFilter !== "all" || terms.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {filtering ? `${filtered.length} of ${entries.length}` : entries.length} entries · the source of truth
        </p>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so choosing the same file again re-fires onChange.
              e.target.value = "";
              if (file) importFile(file);
            }}
          />
          <ToolbarButton
            onClick={() => setImportOpen(true)}
            disabled={importing}
            label={importing ? "Importing…" : "Import JSON"}
          >
            {importing ? <SpinnerIcon /> : <ImportIcon />}
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setManagingCategories(true)}
            label="Manage categories"
          >
            <TagIcon />
          </ToolbarButton>
          <ToolbarButton onClick={newEntry} label="New entry">
            <PlusIcon />
          </ToolbarButton>
          {entries.length > 0 && (
            <ToolbarButton
              onClick={() => setConfirmClear(true)}
              disabled={clearing}
              label={clearing ? "Clearing…" : "Clear knowledge base"}
              destructive
            >
              {clearing ? <SpinnerIcon /> : <TrashIcon />}
            </ToolbarButton>
          )}
        </div>
      </div>

      {notice && <p className="text-sm text-brand-strong">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
          <span className="font-medium text-muted">Keyword</span>
          <input
            value={keywordFilter}
            onChange={(e) => setKeywordFilter(e.target.value)}
            placeholder="Search title, body, keywords…"
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
          />
        </label>
        <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter}>
          <option value="all">All categories</option>
          {categoryOptions.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
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
              setStatusFilter("all");
              setKeywordFilter("");
            }}
            className="rounded-lg px-2 py-1.5 text-xs text-muted hover:text-foreground"
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
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <span>
                {intent} ({group.length})
              </span>
              <SensitivityBadge tier={tierByName.get(intent)} />
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

      {managingCategories && (
        <CategoryManager
          passcode={passcode}
          categories={categories}
          entries={entries}
          onClose={() => setManagingCategories(false)}
          onChanged={refresh}
        />
      )}

      {importOpen && (
        <ImportDialog
          onCancel={() => setImportOpen(false)}
          onChoose={() => {
            setImportOpen(false);
            fileInputRef.current?.click();
          }}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear knowledge base?"
          message={`This permanently deletes all ${entries.length} ${entries.length === 1 ? "entry" : "entries"}. This can't be undone.`}
          confirmLabel="Clear all"
          onConfirm={() => {
            setConfirmClear(false);
            clearAll();
          }}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}

/** A square icon button for the KB toolbar — bordered, with a tooltip label. */
function ToolbarButton({
  onClick,
  label,
  destructive = false,
  disabled = false,
  children,
}: {
  onClick: () => void;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-lg border transition disabled:opacity-40 ${
        destructive
          ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-500 dark:hover:bg-red-950/40"
          : "border-border text-muted hover:border-brand hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** The import explainer + file-picker launcher (what the tooltip used to say). */
function ImportDialog({ onCancel, onChoose }: { onCancel: () => void; onChoose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-[1px]"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import knowledge base"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">Import a knowledge base file</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition hover:bg-you hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
          <p>
            Choose a <code className="font-mono text-foreground">.json</code> file
            shaped like{" "}
            <code className="font-mono text-foreground">{'{ "entries": [ … ] }'}</code>{" "}
            — the output of the handbook-to-knowledge-base tool.
          </p>
          <p>
            Each entry needs{" "}
            <code className="font-mono text-foreground">id</code>,{" "}
            <code className="font-mono text-foreground">intent</code>,{" "}
            <code className="font-mono text-foreground">title</code>,{" "}
            <code className="font-mono text-foreground">body_md</code>,{" "}
            <code className="font-mono text-foreground">structured</code>, and{" "}
            <code className="font-mono text-foreground">keywords</code>.
          </p>
          <p>
            The whole file is validated first — nothing is saved if any entry is
            malformed. Entries whose id already exists are overwritten.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onChoose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg transition hover:opacity-90"
          >
            <ImportIcon /> Choose file…
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Manage categories" dialog — operators create/remove KB categories and set each
 * one's sensitivity. A sensitive category raises the front desk's guardrail bar
 * for every answer classified under it (higher confidence + groundedness floor),
 * so this is the single place that decision — once hard-coded — is now owned by
 * the operator. Deleting a category in use is refused server-side; we surface the
 * count and disable the button so the operator reassigns those entries first.
 */
function CategoryManager({
  passcode,
  categories,
  entries,
  onClose,
  onChanged,
}: {
  passcode: string;
  categories: Category[];
  entries: Entry[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState<CategorySensitivity>("normal");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const countFor = (name: string) => entries.filter((e) => e.intent === name).length;

  async function post(name: string, sensitivity: CategorySensitivity) {
    setError(undefined);
    setBusy(name);
    try {
      const res = await adminFetch("/api/admin/knowledge/categories", passcode, {
        method: "POST",
        body: JSON.stringify({ name, sensitivity }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't save the category.");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addCategory() {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    await post(name, newTier);
    setNewName("");
    setNewTier("normal");
  }

  async function remove(name: string, inUse: number) {
    setError(undefined);
    // Give instant, visible feedback instead of a silently disabled button — a
    // category in use can't be removed until its entries are reassigned/deleted.
    if (inUse > 0) {
      setError(
        `“${name}” is still used by ${inUse} ${inUse === 1 ? "entry" : "entries"}. Reassign or remove them first.`,
      );
      return;
    }
    setBusy(name);
    try {
      const res = await adminFetch("/api/admin/knowledge/categories", passcode, {
        method: "DELETE",
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't remove the category.");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-[1px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage categories"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Manage categories</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Set each category&apos;s sensitivity.{" "}
              <span className="font-medium text-foreground">Sensitive</span> holds its
              answers to a higher bar (stronger grounding required).{" "}
              <span className="font-medium text-foreground">Always escalate</span> never
              answers — every question in it goes straight to your team.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition hover:bg-you hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-400"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-1.5 overflow-y-auto">
          {categories.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">
              No categories yet. Add one below.
            </p>
          )}
          {categories.map((cat) => {
            const inUse = countFor(cat.name);
            const isBusy = busy === cat.name;
            return (
              <div
                key={cat.name}
                className="flex items-center gap-2 rounded-lg border border-border bg-you/30 px-3 py-2 text-sm"
              >
                <span className="truncate font-medium">{cat.name}</span>
                <span className="text-xs text-muted">
                  {inUse} {inUse === 1 ? "entry" : "entries"}
                </span>
                <TierSelect
                  className="ml-auto"
                  value={cat.sensitivity}
                  disabled={isBusy}
                  onChange={(v) => post(cat.name, v)}
                />
                <button
                  type="button"
                  onClick={() => remove(cat.name, inUse)}
                  disabled={isBusy}
                  aria-label={`Remove ${cat.name}`}
                  title={
                    inUse > 0
                      ? "In use — reassign or remove its entries first"
                      : `Remove ${cat.name}`
                  }
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-red-600 transition hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950/40"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1.5 text-xs font-medium text-muted">Add a category</p>
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              value={newName}
              placeholder="e.g. transportation"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
            />
            <TierSelect
              className="shrink-0"
              value={newTier}
              disabled={busy !== null}
              onChange={setNewTier}
            />
            <button
              type="button"
              onClick={addCategory}
              disabled={!newName.trim() || busy !== null}
              className="shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-fg transition hover:opacity-90 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TIER_LABEL: Record<CategorySensitivity, string> = {
  normal: "Normal",
  sensitive: "Sensitive",
  always_escalate: "Always escalate",
};

/** The three-way sensitivity-tier picker used per-row and in the add form. */
function TierSelect({
  value,
  onChange,
  disabled,
  className = "",
}: {
  value: CategorySensitivity;
  onChange: (value: CategorySensitivity) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as CategorySensitivity)}
      aria-label="Sensitivity"
      className={`shrink-0 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand disabled:opacity-50 ${className}`}
    >
      <option value="normal">{TIER_LABEL.normal}</option>
      <option value="sensitive">{TIER_LABEL.sensitive}</option>
      <option value="always_escalate">{TIER_LABEL.always_escalate}</option>
    </select>
  );
}

/**
 * A small pill on the KB list header flagging a category's sensitivity tier:
 * amber for sensitive (higher bar), red for always-escalate (never answered).
 * Nothing renders for a normal category.
 */
function SensitivityBadge({ tier }: { tier?: CategorySensitivity }) {
  if (!tier || tier === "normal") return null;
  const escalate = tier === "always_escalate";
  const cls = escalate
    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400"
    : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-500";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal ${cls}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
        <path d="M12 9v4" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <path d="M12 17h.01" />
      </svg>
      {escalate ? "always escalate" : "sensitive"}
    </span>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4 animate-spin" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
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
