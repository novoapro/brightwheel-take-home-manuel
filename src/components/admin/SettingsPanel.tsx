"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "./adminFetch";
import { inputCls } from "./ui";

type CautionLevel = "cautious" | "balanced" | "lean";
type AuditMode = "off" | "flagged" | "all";
type Settings = {
  caution_level: CautionLevel;
  availability: "online" | "away";
  operator_name: string;
  away_message: string;
  developer_mode: boolean;
  audit_mode: AuditMode;
  judge_enabled: boolean;
};

const CAUTIONS: { value: CautionLevel; label: string; hint: string }[] = [
  { value: "cautious", label: "Cautious", hint: "hand off more — highest safety" },
  { value: "balanced", label: "Balanced (recommended)", hint: "the default bias-to-escalate" },
  { value: "lean", label: "Lean", hint: "answer more — fewer handoffs" },
];

const AUDIT_MODES: { value: AuditMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "collect nothing" },
  { value: "flagged", label: "Flagged only (recommended)", hint: "keep detail only for poorly-rated sessions" },
  { value: "all", label: "All sessions", hint: "keep detail for every session" },
];

/** The owner's safety dial (analysis/03 §4.4). Always-escalate categories relay regardless of this dial. */
export default function SettingsPanel({
  passcode,
  onDeveloperMode,
}: {
  passcode: string;
  /** Notify the shell so the (developer-only) Audit tab shows/hides live. */
  onDeveloperMode?: (v: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    adminFetch("/api/admin/settings", passcode)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        setSettings(d.settings);
        onDeveloperMode?.(!!d.settings.developer_mode);
      });
  }, [passcode, onDeveloperMode]);

  async function patch(body: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...body } : s));
    setSaved(false);
    if (body.developer_mode !== undefined) onDeveloperMode?.(body.developer_mode);
    const res = await adminFetch("/api/admin/settings", passcode, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  if (!settings) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-surface p-4 shadow-card md:p-5">
        <h2 className="mb-1 text-sm font-semibold">Front-desk caution level</h2>
        <p className="mb-3 text-xs text-muted">
          How readily the front desk hands off to you when it isn&apos;t certain.
        </p>
        <div className="flex flex-col gap-2">
          {CAUTIONS.map((c) => (
            <label
              key={c.value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                settings.caution_level === c.value ? "border-brand bg-brand/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="caution"
                checked={settings.caution_level === c.value}
                onChange={() => patch({ caution_level: c.value })}
              />
              <span className="font-medium">{c.label}</span>
              <span className="text-xs text-muted">— {c.hint}</span>
            </label>
          ))}
        </div>
        {saved && <p className="mt-2 text-xs text-brand-strong">Saved ✓</p>}
      </section>

      <div className="rounded-lg border border-border bg-you p-3 text-xs text-muted">
        🔒 Safety, suspected abuse, injuries, custody, and legal categories ship set
        to <b>always escalate</b> — every question goes to a person. You can retune
        any category&apos;s sensitivity under the Knowledge Base &rsaquo; Manage
        categories.
      </div>

      <section className="rounded-xl border border-border bg-surface p-4 shadow-card md:p-5">
        <h2 className="mb-1 text-sm font-semibold">Availability</h2>
        <p className="mb-3 text-xs text-muted">
          The front desk is currently{" "}
          {settings.availability === "online" ? (
            <span className="font-medium text-foreground">
              🟢 Online{settings.operator_name ? ` · ${settings.operator_name}` : ""}
            </span>
          ) : (
            <span className="font-medium text-foreground">🟡 Away</span>
          )}
          . Flip Online/Away and set who&apos;s on duty from the header toggle.
        </p>
        <label className="text-xs font-medium text-muted" htmlFor="away-note">
          Away note (shown to parents while Away)
        </label>
        <textarea
          id="away-note"
          defaultValue={settings.away_message}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== settings.away_message) patch({ away_message: v });
          }}
          rows={3}
          maxLength={280}
          placeholder="We're away right now. I can answer common questions from our handbook…"
          className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <p className="mt-1 text-xs text-muted">Leave blank to use the default disclaimer.</p>
      </section>

      <ProviderConfig
        passcode={passcode}
        judgeEnabled={settings.judge_enabled}
        onJudgeChange={(v) => patch({ judge_enabled: v })}
      />

      {/* Developer tools — visually set apart, at the bottom (analysis/05 §5). */}
      <section className="rounded-xl border border-dashed border-border bg-you/40 p-4 md:p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded bg-you px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
            Dev
          </span>
          <h2 className="text-sm font-semibold">Developer mode</h2>
        </div>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.developer_mode}
            onChange={(e) => patch({ developer_mode: e.target.checked })}
          />
          <span>
            <span className="font-medium">Enable developer mode</span>
            <span className="mt-0.5 block text-xs text-muted">
              Reveals the <b>Audit</b> tab for inspecting what we send the model and
              what it returns. While off, nothing is collected. Turning it off keeps
              your audit-retention choice for next time.
            </span>
          </span>
        </label>

        {settings.developer_mode && (
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="mb-1 text-sm font-semibold">Audit detail retention</h3>
            <p className="mb-3 text-xs text-muted">
              How much per-turn troubleshooting detail we keep — the exact prompt we
              send the model and its raw response. Kept for auditing quality; less is
              more private and saves space.
            </p>
            <div className="flex flex-col gap-2">
              {AUDIT_MODES.map((a) => (
                <label
                  key={a.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                    settings.audit_mode === a.value ? "border-brand bg-brand/5" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="audit-mode"
                    checked={settings.audit_mode === a.value}
                    onChange={() => patch({ audit_mode: a.value })}
                  />
                  <span className="font-medium">{a.label}</span>
                  <span className="text-xs text-muted">— {a.hint}</span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Clear the stored history any time from the <b>Audit</b> tab.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}


// ── AI provider configuration (analysis/11 §3.5) ────────────────────────────
type ModelOption = { id: string; label: string };
type RegistryEntry = {
  label: string;
  answerers: ModelOption[];
  defaultAnswerer: string;
  defaultJudge: string;
};
type Provider = "anthropic" | "openai" | "google";
type MaskedCred = {
  provider: Provider;
  configured: boolean;
  hint: string | null;
  answerer_model: string;
  judge_model: string;
  valid: boolean | null;
  last_checked: string | null;
};
type ProviderData = {
  activeProvider: Provider;
  secretsEnabled: boolean;
  registry: Record<Provider, RegistryEntry>;
  providers: Record<Provider, MaskedCred>;
};

const PROVIDER_ORDER: Provider[] = ["anthropic", "openai", "google"];

/**
 * Select one provider, set its API key (write-only, masked) + model, and
 * activate it (analysis/11 §3.5). Keys are encrypted at rest and never returned.
 */
function ProviderConfig({
  passcode,
  judgeEnabled,
  onJudgeChange,
}: {
  passcode: string;
  judgeEnabled: boolean;
  onJudgeChange: (value: boolean) => void;
}) {
  const [data, setData] = useState<ProviderData>();
  const [selected, setSelected] = useState<Provider>("anthropic");
  const [keyInput, setKeyInput] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  const load = useCallback(async () => {
    const r = await adminFetch("/api/admin/provider", passcode);
    const d = await r.json();
    if (!d.ok) return;
    setData(d);
    setSelected(d.activeProvider);
    setModel(d.providers[d.activeProvider as Provider].answerer_model);
  }, [passcode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, state set after await
    void load();
  }, [load]);

  function pick(p: Provider) {
    if (!data) return;
    setSelected(p);
    setKeyInput("");
    setMsg(undefined);
    setModel(data.providers[p].answerer_model);
  }

  async function save(apiKey?: string) {
    if (!data) return;
    setBusy(true);
    setMsg(undefined);
    try {
      const res = await adminFetch("/api/admin/provider", passcode, {
        method: "PATCH",
        body: JSON.stringify({
          provider: selected,
          apiKey, // undefined = unchanged, "" = remove
          answerer_model: model,
          setActive: true,
        }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? "Could not save.");
      setKeyInput("");
      await load();
      setMsg(
        d.provider.configured
          ? d.provider.valid === false
            ? "Saved, but the key was rejected ✗"
            : "Saved ✓"
          : "Saved ✓",
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4 shadow-card md:p-5">
        <p className="text-sm text-muted">Loading provider config…</p>
      </section>
    );
  }

  const cred = data.providers[selected];
  const reg = data.registry[selected];

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-card md:p-5">
      <h2 className="mb-1 text-sm font-semibold">Front Desk AI Assistant</h2>
      <p className="mb-3 text-xs text-muted">
        Choose the model provider that powers your Front Desk AI Assistant. Bring
        your own key — only one provider is active at a time; keys are encrypted
        at rest and never shown again.
      </p>

      <div className="mb-3 flex flex-col gap-2">
        {PROVIDER_ORDER.map((p) => (
          <label
            key={p}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
              selected === p ? "border-brand bg-brand/5" : "border-border"
            }`}
          >
            <input type="radio" name="provider" checked={selected === p} onChange={() => pick(p)} />
            <span className="font-medium">{data.registry[p].label}</span>
            {data.activeProvider === p && (
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-strong">active</span>
            )}
            {data.providers[p].configured && (
              <span className="ml-auto text-xs text-muted">
                {data.providers[p].valid === false ? "✗ rejected" : "key set"}
              </span>
            )}
          </label>
        ))}
      </div>

      <label className="text-xs font-medium text-muted" htmlFor="api-key">
        API key
      </label>
      <input
        id="api-key"
        type="password"
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        placeholder={cred.configured ? `•••••••• ${cred.hint ?? ""}` : "Paste a key"}
        autoComplete="off"
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
      {cred.configured && (
        <p className="mt-1 text-xs text-muted">
          {cred.valid === false ? "✗ rejected" : cred.valid ? "✓ valid" : "key set"}
          {cred.last_checked ? ` · checked ${new Date(cred.last_checked).toLocaleString()}` : ""}
          {" · "}
          <button
            type="button"
            onClick={() => save("")}
            className="text-brand-strong hover:underline"
          >
            Remove key
          </button>
        </p>
      )}

      <label className="mt-3 block text-xs font-medium text-muted" htmlFor="model">
        Answerer model
      </label>
      <select
        id="model"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className={`mt-1 ${inputCls}`}
      >
        {reg.answerers.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>

      <button
        onClick={() => save(keyInput.trim() ? keyInput.trim() : undefined)}
        disabled={busy}
        className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-brand-fg disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save + activate"}
      </button>
      {msg && <p className="mt-2 text-xs text-brand-strong">{msg}</p>}

      <div className="mt-4 border-t border-border pt-4">
        <h3 className="mb-1 text-sm font-semibold">Groundedness judge</h3>
        <p className="mb-3 text-xs text-muted">
          A second AI model that double-checks each answer is backed by your
          policies before it&apos;s shown. Turning it off makes{" "}
          <b>one AI call per question instead of two</b> (lower cost), but the front
          desk leans on its faster checks alone.
        </p>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            checked={judgeEnabled}
            onChange={(e) => onJudgeChange(e.target.checked)}
          />
          <span className="font-medium">
            {judgeEnabled ? "On — verify every answer" : "Off — save on cost"}
          </span>
        </label>
        {!judgeEnabled && (
          <p className="mt-2 text-xs text-muted">
            With the judge off, anything in a <b>sensitive</b> or{" "}
            <b>always-escalate</b> category is handed to you instead of answered —
            we never show a sensitive answer we couldn&apos;t verify.
          </p>
        )}
      </div>
    </section>
  );
}
