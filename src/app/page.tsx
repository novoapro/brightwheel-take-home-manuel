import { getHealth } from "@/lib/db";

// Server component reads the DB directly — proves the end-to-end path (M0).
export const dynamic = "force-dynamic";

export default function Home() {
  const health = getHealth();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <p className="text-4xl" aria-hidden>
          🌰
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Little Acorns Front Desk
        </h1>
        <p className="text-sm text-neutral-500">
          Ask about hours, tuition, sick-day policy, meals, and tours — answers
          straight from our center.
        </p>
      </header>

      <div className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
        Walking skeleton (M0). The parent chat lands in M3 — see{" "}
        <code className="rounded bg-neutral-100 px-1">analysis/06-build-sequence.md</code>.
      </div>

      <footer className="text-xs text-neutral-400">
        db: {health.ok ? "ok" : "error"} · {health.dbPath} · schema v
        {health.schemaVersion}
      </footer>
    </main>
  );
}
