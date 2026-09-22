import Link from "next/link";
import { getDb } from "@/lib/db";
import { getCenter } from "@/lib/repo/center";
import { listPublishedPolicies } from "@/lib/repo/policies";
import { renderMarkdownLite } from "@/lib/markdown";
import { INTENTS, type Intent } from "@/lib/types";

// The parent-facing read-only handbook — the single source of truth, derived
// from PolicyRecords (analysis/01 §2). Attribution chips in the chat link here
// by policy id (#<id>).
export const dynamic = "force-dynamic";

const INTENT_LABELS: Record<Intent, string> = {
  hours: "Hours & Closures",
  tuition: "Tuition & Fees",
  health: "Health & Sick-Child",
  meals: "Meals & Food",
  tours: "Tours & Enrollment",
};

export default function HandbookPage() {
  const db = getDb();
  const center = getCenter(db);
  const policies = listPublishedPolicies(db);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>🌰</span>
          <div>
            <h1 className="text-lg font-semibold">{center?.name ?? "Little Acorns"} — Family Handbook</h1>
            <p className="text-xs text-muted">The answers behind our front desk.</p>
          </div>
        </div>
        <Link href="/" className="text-sm text-brand-strong hover:underline">
          ← Front desk
        </Link>
      </header>

      {INTENTS.map((intent) => {
        const group = policies.filter((p) => p.intent === intent);
        if (group.length === 0) return null;
        return (
          <section key={intent} className="mb-8">
            <h2 className="mb-3 border-b border-border pb-1 text-sm font-semibold uppercase tracking-wide text-muted">
              {INTENT_LABELS[intent]}
            </h2>
            <div className="flex flex-col gap-5">
              {group.map((p) => (
                <article key={p.id} id={p.id} className="scroll-mt-4 rounded-xl border border-border bg-surface p-4">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold">{p.title}</h3>
                    {p.origin === "captured" && (
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] text-brand-strong">
                        ✎ added from a family question
                      </span>
                    )}
                  </div>
                  <div
                    className="prose-sm space-y-2 text-[15px] leading-relaxed [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: renderMarkdownLite(p.body_md) }}
                  />
                  {p.source && (
                    <p className="mt-2 text-xs text-muted">Source: {p.source}</p>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
