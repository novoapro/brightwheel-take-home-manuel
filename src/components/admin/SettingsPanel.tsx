"use client";

import { useEffect, useState } from "react";

type CautionLevel = "cautious" | "balanced" | "lean";
type Settings = { caution_level: CautionLevel; active_provider: "claude" | "gemini" };

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
        <h2 className="mb-1 text-sm font-semibold">AI provider (for testing)</h2>
        <p className="mb-3 text-xs text-muted">
          Swap the model behind the same prompt and guardrails; compare results on the Dashboard.
        </p>
        <div className="flex flex-col gap-2">
          {([
            ["claude", "Claude · Sonnet 5"],
            ["gemini", "Gemini · Flash"],
          ] as const).map(([value, label]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                settings.active_provider === value ? "border-brand bg-brand/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="provider"
                checked={settings.active_provider === value}
                onChange={() => patch({ active_provider: value })}
              />
              <span className="font-medium">{label}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
