"use client";

import { useState } from "react";
import Dashboard from "@/components/admin/Dashboard";
import HandbookEditor from "@/components/admin/HandbookEditor";
import RelayQueue from "@/components/admin/RelayQueue";

/**
 * Operator control center (analysis/03 §4). Mock passcode gate (§9), then tabs:
 * Dashboard (ROI + gaps), Live relay (answer waiting parents), and Handbook
 * (curate the source of truth). Settings + provider toggle arrive in M6/M7.
 */
type Tab = "dashboard" | "relay" | "handbook";

export default function AdminPage() {
  const [passcode, setPasscode] = useState("");
  const [authCode, setAuthCode] = useState<string>();
  const [operatorName, setOperatorName] = useState("");
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("dashboard");

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
        <h1 className="text-lg font-semibold">🌰 Control Center</h1>
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-4">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">🌰 Control Center</h1>
        <input
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          placeholder="Your name"
          className="w-28 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
        />
      </header>

      <nav className="mb-4 flex gap-1 rounded-lg bg-you p-1 text-sm">
        {(
          [
            ["dashboard", "Dashboard"],
            ["relay", "Live relay"],
            ["handbook", "Handbook"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-3 py-1.5 transition ${
              tab === id ? "bg-surface font-medium shadow-sm" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && <Dashboard passcode={authCode} onOpenGaps={() => setTab("handbook")} />}
      {tab === "relay" && <RelayQueue passcode={authCode} operatorName={operatorName} />}
      {tab === "handbook" && <HandbookEditor passcode={authCode} operatorName={operatorName} />}
    </main>
  );
}
