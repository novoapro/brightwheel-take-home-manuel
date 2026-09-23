"use client";

import { useCallback, useEffect, useState } from "react";

type CautionLevel = "cautious" | "balanced" | "lean";
type Settings = {
  caution_level: CautionLevel;
  availability: "online" | "away";
  operator_name: string;
  away_message: string;
};

const CAUTIONS: { value: CautionLevel; label: string; hint: string }[] = [
  { value: "cautious", label: "Cautious", hint: "hand off more — highest safety" },
  { value: "balanced", label: "Balanced (recommended)", hint: "the default bias-to-escalate" },
  { value: "lean", label: "Lean", hint: "answer more — fewer handoffs" },
];

/** The owner's safety dial (analysis/03 §4.4). HARD_SENSITIVE is floor-locked. */
export default function SettingsPanel({ passcode }: { passcode: string }) {
  const [settings, setSettings] = useState<Settings>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings", { headers: { "x-admin-passcode": passcode } })
      .then((r) => r.json())
      .then((d) => d.ok && setSettings(d.settings));
  }, [passcode]);

  async function patch(body: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...body } : s));
    setSaved(false);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-passcode": passcode },
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
        🔒 Safety, suspected abuse, injuries, custody, and legal matters
        <b> always</b> go to a person — this floor can&apos;t be lowered.
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

      <ProviderConfig passcode={passcode} />
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
function ProviderConfig({ passcode }: { passcode: string }) {
  const [data, setData] = useState<ProviderData>();
  const [selected, setSelected] = useState<Provider>("anthropic");
  const [keyInput, setKeyInput] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/provider", { headers: { "x-admin-passcode": passcode } });
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
      const res = await fetch("/api/admin/provider", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-admin-passcode": passcode },
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
      <h2 className="mb-1 text-sm font-semibold">AI provider</h2>
      <p className="mb-3 text-xs text-muted">
        Bring your own key. Only one provider is active at a time; keys are
        encrypted at rest and never shown again.
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
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
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
    </section>
  );
}
