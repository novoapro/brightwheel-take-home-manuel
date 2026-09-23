"use client";

import { useEffect, useRef, useState } from "react";
import Dashboard from "@/components/admin/Dashboard";
import HandbookEditor from "@/components/admin/HandbookEditor";
import RelayQueue from "@/components/admin/RelayQueue";
import SessionsPanel from "@/components/admin/SessionsPanel";
import SettingsPanel from "@/components/admin/SettingsPanel";
import BrandingPanel from "@/components/admin/BrandingPanel";
import PoweredByBrightwheel from "@/components/PoweredByBrightwheel";
import FrontDeskLogo from "@/components/FrontDeskLogo";

/**
 * Operator control center (analysis/03 §4). Mock passcode gate (§9), then a
 * left sidebar of sections: Dashboard (ROI + gaps), Live relay, Handbook
 * (curate the source of truth), Branding (everything parents see — analysis/10
 * §5.1), and Settings. A vertical rail scales as sections grow (unlike a
 * horizontal tab row) and reads as a panel inside Brightwheel.
 */
type Tab = "dashboard" | "relay" | "sessions" | "handbook" | "branding" | "settings";

const NAV: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "relay", label: "Live relay" },
  { id: "sessions", label: "Sessions" },
  { id: "handbook", label: "Handbook" },
  { id: "branding", label: "Branding" },
  { id: "settings", label: "Settings" },
];

// Monochrome line icons (Feather-style) that inherit the nav text color via
// currentColor — so they pick up the muted/active-brand states automatically.
const ICON_PATHS: Record<Tab, React.ReactNode> = {
  dashboard: (
    <>
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="10" />
    </>
  ),
  relay: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  sessions: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  handbook: (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
  branding: (
    <>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.4-1.01-.24-.27-.39-.63-.39-1.02 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z" />
      <circle cx="6.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </>
  ),
};

function NavIcon({ name, className = "h-[18px] w-[18px] shrink-0" }: { name: Tab; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export default function AdminPage() {
  const [passcode, setPasscode] = useState("");
  const [authCode, setAuthCode] = useState<string>();
  const [operatorName, setOperatorName] = useState("");
  const [availability, setAvailability] = useState<"online" | "away">("online");
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("dashboard");
  // Start closed so mobile never flashes the overlay open before the mount
  // effect resolves the saved preference / breakpoint.
  const [collapsed, setCollapsed] = useState(true);

  // Remember the operator's nav preference; default to collapsed on small screens.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fd_admin_nav_collapsed");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time read of a client-only preference
      setCollapsed(saved != null ? saved === "1" : window.matchMedia("(max-width: 767px)").matches);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleNav() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("fd_admin_nav_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // On mobile the sidebar is an overlay drawer (below md), so open/close it
  // without persisting — the saved value is the desktop rail preference only,
  // and we don't want a drawer auto-reopening on the next mobile load.
  const isMobile = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  const openNav = () => setCollapsed(false);
  const closeNav = () => setCollapsed(true);

  // Load the persisted on-duty operator + availability once signed in, so the
  // operator's name survives reloads and is consistent across devices
  // (analysis/11 §4.1) — no more re-typing every session.
  useEffect(() => {
    if (!authCode) return;
    fetch("/api/admin/settings", { headers: { "x-admin-passcode": authCode } })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        setOperatorName(d.settings.operator_name ?? "");
        setAvailability(d.settings.availability ?? "online");
        setOfflineAt(d.settings.offline_at ?? null);
      })
      .catch(() => {});
  }, [authCode]);

  // Persist a presence change (name / availability / auto-offline). Returns the
  // server error, if any, so the caller can surface "a name is required".
  async function savePresence(patch: {
    operator_name?: string;
    availability?: "online" | "away";
    offline_at?: string | null;
  }): Promise<string | undefined> {
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-passcode": authCode! },
      body: JSON.stringify(patch),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !d.ok) return d.error ?? "Could not save.";
    setOperatorName(d.settings.operator_name);
    setAvailability(d.settings.availability);
    setOfflineAt(d.settings.offline_at ?? null);
    return undefined;
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const res = await fetch("/api/admin/dashboard", {
      headers: { "x-admin-passcode": passcode },
    });
    if (res.status === 401) {
      setError("Invalid passcode.");
      return;
    }
    setAuthCode(passcode);
  }

  if (!authCode) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <FrontDeskLogo className="h-6 w-6 text-brand-strong" /> Control Center
        </h1>
        <p className="text-sm text-muted">Enter the operator passcode.</p>
        <form onSubmit={login} className="flex flex-col gap-3">
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            className="rounded-lg border border-border bg-surface px-3 py-2.5 outline-none focus:border-brand"
            autoFocus
          />
          <button className="rounded-lg bg-brand px-4 py-2.5 text-brand-fg">Sign in</button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </main>
    );
  }

  const current = NAV.find((n) => n.id === tab)!;

  return (
    <div className="flex min-h-dvh w-full">
      {/* Backdrop — only while the mobile drawer is open; taps close it. */}
      {!collapsed && (
        <div
          className="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-[1px] md:hidden"
          onClick={closeNav}
          aria-hidden
        />
      )}

      {/*
        Sidebar. Desktop (md+): an in-flow rail that pushes the content and
        collapses between w-16 and w-60. Mobile (< md): an off-canvas overlay
        drawer (fixed) that slides in on top of the content — so opening it never
        reflows the page body.
      */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh flex-col border-r border-border bg-surface shadow-xl transition-[translate,width] duration-200 ease-out md:sticky md:top-0 md:z-auto md:shrink-0 md:shadow-none ${
          collapsed
            ? "w-60 -translate-x-full md:w-16 md:translate-x-0"
            : "w-60 translate-x-0"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-3">
          {!collapsed && (
            <span className="flex flex-1 items-center gap-2 truncate text-sm font-semibold leading-none">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 shrink-0 text-brand-strong"
                aria-hidden
              >
                <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
                <path d="M9.5 12l1.8 1.8L15 10" />
              </svg>
              Admin Console
            </span>
          )}
          <button
            onClick={toggleNav}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            aria-expanded={!collapsed}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg leading-none text-muted transition hover:bg-you ${
              collapsed ? "mx-auto" : ""
            }`}
          >
            {collapsed ? "☰" : "«"}
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2 py-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setTab(n.id);
                if (isMobile()) closeNav(); // dismiss the drawer after picking
              }}
              title={n.label}
              className={`flex items-center gap-3 rounded-lg py-2 text-sm transition ${
                collapsed ? "justify-center px-0" : "px-3"
              } ${
                tab === n.id
                  ? "bg-brand/10 font-medium text-brand-strong"
                  : "text-muted hover:bg-you"
              }`}
            >
              <NavIcon name={n.id} />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </button>
          ))}
        </nav>

        {!collapsed && <PoweredByBrightwheel />}
      </aside>

      {/* ── Content ── */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={openNav}
              aria-label="Open menu"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-you md:hidden"
            >
              ☰
            </button>
            <FrontDeskLogo className="h-7 w-7 shrink-0 text-brand-strong" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase leading-none tracking-wide text-muted">
                Front Desk
              </p>
              <h1 className="mt-0.5 truncate text-base font-semibold leading-tight">
                {current.label}
              </h1>
            </div>
          </div>
          <PresenceControl
            availability={availability}
            operatorName={operatorName}
            offlineAt={offlineAt}
            onSave={savePresence}
          />
        </header>

        <div className="flex-1 px-4 py-5 md:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-3xl">
            {tab === "dashboard" && <Dashboard passcode={authCode} onOpenGaps={() => setTab("handbook")} />}
            {tab === "relay" && <RelayQueue passcode={authCode} operatorName={operatorName} />}
            {tab === "sessions" && <SessionsPanel passcode={authCode} />}
            {tab === "handbook" && <HandbookEditor passcode={authCode} operatorName={operatorName} />}
            {tab === "branding" && <BrandingPanel passcode={authCode} />}
            {tab === "settings" && <SettingsPanel passcode={authCode} />}
          </div>
        </div>

        {collapsed && <PoweredByBrightwheel />}
      </section>
    </div>
  );
}

/** Format an ISO time as a short local clock time, e.g. "5:00 PM". */
function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * The operator presence control in the admin header (analysis/11 §4.2a).
 *   Away  → a single prominent "Open Front Desk" CTA.
 *   Online → a status pill (🟢 name · until 5:00 PM) + "Close" + "Edit".
 * Opening the desk goes through a dialog (name + auto-offline schedule); a name
 * is required, so the desk is never open anonymously, and it persists so every
 * live answer is attributed to a real person.
 */
function PresenceControl({
  availability,
  operatorName,
  offlineAt,
  onSave,
}: {
  availability: "online" | "away";
  operatorName: string;
  offlineAt: string | null;
  onSave: (patch: {
    operator_name?: string;
    availability?: "online" | "away";
    offline_at?: string | null;
  }) => Promise<string | undefined>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const online = availability === "online";

  // One consistent pill for both states — same shape/border/background, only the
  // color and content change. Clicking it always opens the dialog.
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        title={online ? "Edit who's on duty, or close the desk" : "Open the Front Desk"}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
          online
            ? "border-green-600/30 bg-green-600/10 text-green-800 hover:bg-green-600/15"
            : "border-amber-500/40 bg-amber-400/10 text-amber-800 hover:bg-amber-400/20"
        }`}
      >
        <span className="relative flex h-2 w-2" aria-hidden>
          {online && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500/60" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              online ? "bg-green-600" : "bg-amber-500"
            }`}
          />
        </span>
        {online ? (
          <>
            <span>{operatorName || "Online"}</span>
            {offlineAt && (
              <span className="hidden text-xs text-green-700/80 sm:inline">
                · until {shortTime(offlineAt)}
              </span>
            )}
          </>
        ) : (
          <>
            <span>Away</span>
            <span className="text-xs text-amber-700/80">· Open Front Desk</span>
          </>
        )}
      </button>

      {dialogOpen && (
        <OpenDeskDialog
          online={online}
          initialName={operatorName}
          initialOfflineAt={online ? offlineAt : null}
          onClose={() => setDialogOpen(false)}
          onSave={onSave}
        />
      )}
    </div>
  );
}

/**
 * Modal to open (or edit) the Front Desk: the operator's name plus an auto-
 * offline schedule — a specific time today, or never. Submitting sets the desk
 * Online under that name (analysis/11 §4.1).
 */
function OpenDeskDialog({
  online,
  initialName,
  initialOfflineAt,
  onClose,
  onSave,
}: {
  online: boolean;
  initialName: string;
  initialOfflineAt: string | null;
  onClose: () => void;
  onSave: (patch: {
    operator_name?: string;
    availability?: "online" | "away";
    offline_at?: string | null;
  }) => Promise<string | undefined>;
}) {
  const [name, setName] = useState(initialName);
  const [mode, setMode] = useState<"never" | "at">(initialOfflineAt ? "at" : "never");
  const [time, setTime] = useState<string>(() =>
    initialOfflineAt
      ? new Date(initialOfflineAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
      : "17:00",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Interpret "HH:MM" as the next occurrence of that clock time (today, or
  // tomorrow if it has already passed) → an ISO instant.
  function offlineIso(): string | null {
    if (mode === "never") return null;
    const [h, m] = time.split(":").map(Number);
    const at = new Date();
    at.setHours(h, m, 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    return at.toISOString();
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter the operator's name.");
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    const err = await onSave({
      availability: "online",
      operator_name: trimmed,
      offline_at: offlineIso(),
    });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  async function closeDesk() {
    setBusy(true);
    setError(undefined);
    const err = await onSave({ availability: "away", offline_at: null });
    setBusy(false);
    if (err) setError(err);
    else onClose();
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
        aria-label="Open the Front Desk"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Front desk</h2>
        <p className="mt-1 text-xs text-muted">
          {online
            ? "Open, and you're shown as the person answering. Mark it as away to make changes."
            : "You'll be shown as the person answering. Parents see you're online."}
        </p>

        {online ? (
          // Read-only while open — the on-duty name is locked (§4.2a). To change
          // it, mark the desk as away first, then open again.
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">On duty</dt>
              <dd className="font-medium">{name || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Auto-offline</dt>
              <dd className="font-medium">
                {initialOfflineAt ? shortTime(initialOfflineAt) : "Never"}
              </dd>
            </div>
          </dl>
        ) : (
          <>
            <label className="mt-4 block text-xs font-medium text-muted" htmlFor="op-name">
              Operator name
            </label>
            <input
              id="op-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && mode === "never" && submit()}
              placeholder="e.g. Maria"
              maxLength={60}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />

            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-muted">Automatically go offline</legend>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="offline-mode"
                  checked={mode === "never"}
                  onChange={() => setMode("never")}
                />
                Never — I&apos;ll close the desk myself
              </label>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="offline-mode"
                  checked={mode === "at"}
                  onChange={() => setMode("at")}
                />
                Go offline at
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setMode("at");
                  }}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-brand"
                />
              </label>
            </fieldset>
          </>
        )}

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={online ? closeDesk : submit}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${
              online
                ? "border border-border text-foreground hover:border-red-400 hover:text-red-600"
                : "bg-brand text-brand-fg"
            }`}
          >
            {busy ? "Saving…" : online ? "Mark as away" : "Mark as active"}
          </button>
        </div>
      </div>
    </div>
  );
}
