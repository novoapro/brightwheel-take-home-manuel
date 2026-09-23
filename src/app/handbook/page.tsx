import Link from "next/link";
import { getDb } from "@/lib/db";
import { getCenter } from "@/lib/repo/center";
import { listPublishedEntries } from "@/lib/repo/knowledge";
import { renderMarkdownLite } from "@/lib/markdown";
import { INTENTS, type Intent } from "@/lib/types";
import BrandMark from "@/components/BrandMark";
import PoweredByBrightwheel from "@/components/PoweredByBrightwheel";

// The parent-facing read-only handbook — one view onto the Knowledge Base,
// derived from published KnowledgeEntries (analysis/01 §2). Attribution chips in
// the chat link here by entry id (#<id>).
export const dynamic = "force-dynamic";

const INTENT_LABELS: Record<string, string> = {
  hours: "Hours & Closures",
  tuition: "Tuition & Fees",
  health: "Health & Sick-Child",
  meals: "Meals & Food",
  tours: "Tours & Enrollment",
};

/** Fall back to a readable heading for operator-added categories. */
function categoryLabel(intent: Intent): string {
  return (
    INTENT_LABELS[intent] ??
    intent.replace(/(^|\s|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase())
  );
}

export default function HandbookPage() {
  const db = getDb();
  const center = getCenter(db);
  const policies = listPublishedEntries(db);
  // Core categories first (canonical order), then operator-added ones, sorted.
  const extras = [...new Set(policies.map((p) => p.intent))]
    .filter((i) => !(INTENTS as readonly string[]).includes(i))
    .sort();
  const categories = [...INTENTS, ...extras];

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      {/* Pinned so "← Front desk" is one tap away from anywhere in a long
          handbook — no scrolling back to the top. The negative margins let the
          blurred bar span the page padding edge-to-edge. */}
      <header className="sticky top-0 z-20 -mx-5 mb-6 flex items-center justify-between gap-3 border-b border-border bg-background/85 px-5 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark logo={center?.logo} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{center?.name ?? "Family"} — Family Handbook</h1>
            <p className="text-xs text-muted">The answers behind our front desk.</p>
          </div>
        </div>
        <Link
          href="/"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-brand-strong transition hover:border-brand"
        >
          ← Front desk
        </Link>
      </header>

      {categories.map((intent) => {
        const group = policies.filter((p) => p.intent === intent);
        if (group.length === 0) return null;
        return (
          <section key={intent} className="mb-8">
            <h2 className="mb-3 border-b border-border pb-1 text-sm font-semibold uppercase tracking-wide text-muted">
              {categoryLabel(intent)}
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

      <PoweredByBrightwheel />
    </main>
  );
}
