"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { renderMarkdownLite } from "@/lib/markdown";
import { deriveTheme, normalizeHex } from "@/lib/theme";
import { centerDisplayName } from "@/lib/types";
import { adminFetch } from "./adminFetch";
import { inputCls } from "./ui";

/**
 * The Branding tab (analysis/10 §5.1) — the one place the admin edits everything
 * parents see: business name, front-desk name, logo, theme color, and the
 * welcome copy. Grouped into cards (Identity · Greeting · Appearance) beside a
 * *live* parent preview that recolors instantly via deriveTheme, so the owner
 * sees the white-label before saving.
 */

type Center = {
  name: string;
  display_name: string;
  brand_color: string;
  logo?: string;
  welcome_message?: string;
};

// Brightwheel-curated presets keep non-designer SMB owners on tasteful, legible
// colors (less-is-more); the contrast util guarantees the rest.
const PRESETS = [
  "#6c4ee8", // Brightwheel blurple
  "#4f7a5b", // sage
  "#0f766e", // teal
  "#b4530f", // amber-brown
  "#be123c", // rose
  "#2563eb", // sky
  "#7c3aed", // violet
  "#c2410c", // coral
];

const DEFAULT_WELCOME =
  "Hi! I can help with **hours, tuition, sick-day policy, meals, and tours** — with answers straight from our center. What can I help you with?";

const MAX_LOGO_BYTES = 256 * 1024;
const OK_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export default function BrandingPanel({ passcode }: { passcode: string }) {
  const router = useRouter();
  const [center, setCenter] = useState<Center>();
  const [baseline, setBaseline] = useState<Center>(); // last-saved values → dirty check
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [colorOpen, setColorOpen] = useState(false);

  useEffect(() => {
    adminFetch("/api/admin/center", passcode)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setCenter(d.center);
          setBaseline(d.center);
        }
      })
      .catch(() => setError("Couldn't load branding."));
  }, [passcode]);

  function set<K extends keyof Center>(key: K, value: Center[K]) {
    setCenter((c) => (c ? { ...c, [key]: value } : c));
  }

  async function onLogoPick(file: File) {
    setError(undefined);
    if (!OK_LOGO_TYPES.includes(file.type)) {
      setError("Logo must be a PNG, JPEG, or WebP.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo is too large — please use an image under 256KB.");
      return;
    }
    const dataUri = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
    set("logo", dataUri);
  }

  async function save() {
    if (!center) return;
    setSaving(true);
    setError(undefined);
    const res = await adminFetch("/api/admin/center", passcode, {
      method: "PATCH",
      body: JSON.stringify({
        name: center.name,
        display_name: center.display_name,
        brand_color: center.brand_color,
        logo: center.logo ?? null,
        welcome_message: center.welcome_message ?? "",
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) {
      setError(data.error ?? "Couldn't save.");
      return;
    }
    setCenter(data.center);
    setBaseline(data.center); // now pristine → the CTA hides
    // The accent is injected server-side in the root layout from brand_color, so
    // refresh the server components to re-theme the whole admin surface (sidebar,
    // buttons, chips) to the newly-saved color. Client state (auth) is preserved.
    router.refresh();
  }

  if (!center) {
    return <p className="text-sm text-muted">{error ?? "Loading…"}</p>;
  }

  const theme = deriveTheme(center.brand_color);
  const pickerHex = normalizeHex(center.brand_color) ?? theme.brand;
  const validColor = normalizeHex(center.brand_color) !== null;
  const currentHex = normalizeHex(center.brand_color);
  // Show 4 swatches, always including the color that's currently set.
  const swatches = (
    currentHex ? [currentHex, ...PRESETS.filter((h) => h !== currentHex)] : [...PRESETS]
  ).slice(0, 4);
  const dirty = !!baseline && JSON.stringify(center) !== JSON.stringify(baseline);
  const previewDisplayName = centerDisplayName(center);
  const previewWelcome = (center.welcome_message || "").trim() || DEFAULT_WELCOME;

  return (
    <div className="flex flex-col gap-4">
      {dirty && (
        <div
          role="status"
          className="sticky top-14 z-20 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow-sm backdrop-blur-sm dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300"
        >
          <InfoBannerIcon />
          <span className="min-w-0 truncate">You have unsaved changes.</span>
          <button
            onClick={save}
            disabled={saving}
            aria-label="Save changes"
            title="Save changes"
            className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-lg text-amber-900 transition hover:bg-amber-500/15 disabled:opacity-50 dark:text-amber-200"
          >
            {saving ? <Spinner /> : <SaveIcon />}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
      {/* ── Edit form: three cards ── */}
      <div className="flex flex-1 flex-col gap-4">
        {/* 1 · Identity */}
        <SectionCard title="Identity">
          <Field label="Business name" hint="The center's name — the header title parents read.">
            <input value={center.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
          </Field>
          <Field
            label="Front-desk name"
            hint={`What you call your front desk (e.g. “Ask Acorn”). Leave blank to use “${center.name} Front Desk”.`}
          >
            <input
              value={center.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              placeholder={`${center.name} Front Desk`}
              className={inputCls}
            />
          </Field>
        </SectionCard>

        {/* 2 · Greeting */}
        <SectionCard title="Greeting">
          <Field label="Welcome message" hint="The first thing parents see. **bold** is supported.">
            <textarea
              value={center.welcome_message ?? ""}
              onChange={(e) => set("welcome_message", e.target.value)}
              placeholder={DEFAULT_WELCOME}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </Field>
        </SectionCard>

        {/* 3 · Appearance — brand mark + theme color side by side */}
        <SectionCard title="Appearance">
          <div className="flex flex-row items-start gap-4 md:gap-6">
          <div className="flex-1 min-w-0">
          <Field label="Brand mark" hint="Upload a logo (PNG/JPEG/WebP, under 256KB). With no logo, the app icon is used.">
            <div className="flex items-center gap-4">
              <div className="grid h-28 w-28 shrink-0 place-items-center rounded-xl border border-border bg-background">
                <BrandMark logo={center.logo} imgSize={84} />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  aria-label={center.logo ? "Replace logo" : "Upload logo"}
                  title={center.logo ? "Replace logo" : "Upload logo"}
                  className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition hover:bg-you hover:text-foreground"
                >
                  <UploadIcon />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onLogoPick(f);
                      e.target.value = "";
                    }}
                  />
                </label>

                {center.logo && (
                  <button
                    type="button"
                    onClick={() => set("logo", undefined)}
                    aria-label="Remove logo"
                    title="Remove logo"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-you hover:text-red-600"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </div>
          </Field>
          </div>
          <div className="flex-1 min-w-0">
          <Field label="Theme color" hint="One accent color; text contrast on it is checked automatically.">
            {/* Collapsed summary row — expands to reveal presets + custom picker. */}
            <div className="overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setColorOpen((o) => !o)}
                aria-expanded={colorOpen}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-you/50"
              >
                <span
                  className="h-6 w-6 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: theme.brand }}
                />
                <span className="font-mono">{center.brand_color}</span>
                <span
                  className="ml-auto grid h-6 w-10 place-items-center rounded text-xs font-semibold"
                  style={{ backgroundColor: theme.brand, color: theme.brandFg }}
                  title="Accent + auto-contrast text"
                >
                  Aa
                </span>
                <ChevronIcon className={`shrink-0 text-muted transition ${colorOpen ? "rotate-180" : ""}`} />
              </button>

              {colorOpen && (
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    {swatches.map((hex) => {
                      const active = currentHex === hex;
                      return (
                        <button
                          key={hex}
                          type="button"
                          aria-label={hex}
                          aria-pressed={active}
                          onClick={() => set("brand_color", hex)}
                          className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-surface transition ${
                            active ? "ring-foreground" : "ring-transparent hover:ring-border"
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={pickerHex}
                      onChange={(e) => set("brand_color", e.target.value)}
                      aria-label="Pick a custom color"
                      className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1"
                    />
                    <input
                      value={center.brand_color}
                      onChange={(e) => set("brand_color", e.target.value)}
                      aria-label="Hex color"
                      spellCheck={false}
                      className={`w-28 rounded-lg border bg-surface px-2 py-2 font-mono text-sm outline-none focus:border-brand ${
                        validColor ? "border-border" : "border-red-400"
                      }`}
                    />
                  </div>
                  {!validColor && (
                    <p className="text-xs text-red-600">Enter a valid hex like #4f7a5b.</p>
                  )}
                </div>
              )}
            </div>
          </Field>
          </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Live parent preview ── */}
      <div className="flex flex-col gap-3 md:w-72 md:shrink-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Live preview</p>
        <div
          className="overflow-hidden rounded-xl border border-border bg-background shadow-card"
          style={
            {
              "--brand": theme.brand,
              "--brand-strong": theme.brandStrong,
              "--brand-fg": theme.brandFg,
            } as React.CSSProperties
          }
        >
          <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2.5">
            <BrandMark logo={center.logo} imgSize={24} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">{center.name}</p>
              <p className="truncate text-xs text-muted">{previewDisplayName}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 p-3">
            <div
              className="text-[13px] leading-relaxed [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: renderMarkdownLite(previewWelcome) }}
            />
            <div className="self-start rounded-2xl rounded-tl-sm bg-surface px-3 py-2 text-[13px] shadow-sm ring-1 ring-border">
              We&apos;re open Mon–Fri, 7 AM–6 PM.
            </div>
            <div className="inline-flex w-fit items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs text-brand-strong">
              📎 per our Handbook
            </div>
            <button className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-[13px]">
              <span aria-hidden>🕐</span> Hours &amp; closures
            </button>
            <button className="grid h-9 w-9 place-items-center self-end rounded-full bg-brand text-brand-fg">▷</button>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card md:p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      {children}
    </div>
  );
}

/** Instructions live here as a hover/focus tooltip rather than as body text. */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex">
      <span
        tabIndex={0}
        role="note"
        aria-label={text}
        className="inline-grid h-4 w-4 cursor-help place-items-center rounded-full border border-border text-[10px] font-semibold text-muted"
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-64 -translate-x-1/2 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-normal leading-snug text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function InfoBannerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
      <path d="M17.6 3.6A2 2 0 0 0 16.17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7.83a2 2 0 0 0-.59-1.41zM12 19a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`} aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
