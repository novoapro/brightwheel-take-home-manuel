import type { KnowledgeEntry } from "../types";

/**
 * Deterministic structured-fact verification (analysis/04 §3c, analysis/07 §3).
 *
 * The differentiator: because the source of truth is structured, we can verify
 * — with no model call — that every number/money/temperature/time/date the
 * answer states actually appears in the cited records. This catches the
 * "right source, wrong number" failure (e.g. a fever threshold of 101 while
 * citing the 100.4 policy) that text-only faithfulness checks miss.
 *
 * A fact is "supported" if its normalized form appears in the union of the cited
 * records' structured payloads AND their authored prose (body_md). Indexing the
 * prose too is a deliberate widening beyond §3c's structured-only wording: the
 * prose is authored ground truth, and it removes the false-positive blocks that
 * analysis/09 N1 warned about — while a genuinely fabricated number still
 * appears in neither source and is blocked.
 */

export type FactKind = "money" | "temp" | "time" | "percent" | "date" | "number";

export interface Fact {
  kind: FactKind;
  raw: string;
  /** Canonical comparable form(s). A fact passes if ANY normal is in the source. */
  normals: string[];
}

const MONTHS: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

/** Strip thousands separators and a trailing decimal-zero: "1,650.00" -> "1650". */
function normalizeNumber(n: string): string {
  let s = n.replace(/,/g, "");
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** "HH:MM" 24h-ish; pad hour so "7:00" -> "07:00". */
function normalizeTime(h: string, m: string): string {
  return `${h.padStart(2, "0")}:${m}`;
}

/** ISO date -> ["2026-11-11", "11-11"]. */
function isoDateNormals(y: string, mo: string, d: string): string[] {
  const day = d.padStart(2, "0");
  return [`${y}-${mo}-${day}`, `${mo}-${day}`];
}

/**
 * Extract the checkable facts a parent would act on from free text.
 * Order matters: match the most specific patterns (money/temp/time/date) before
 * falling back to bare numbers, and consume matched spans so a "$15" isn't also
 * counted as the bare number 15.
 */
export function extractFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  // We blank out matched spans in a working copy so later, looser patterns
  // don't re-match the same characters.
  let work = text;

  // Run `re` over the working copy; for each match build a [match, ...groups]
  // array, let `fn` turn it into a Fact, then blank the matched span so looser
  // later patterns can't re-match the same characters. Optional capture groups
  // may be `undefined` at runtime — callbacks guard them with truthiness checks.
  const take = (re: RegExp, fn: (m: string[]) => Fact | null) => {
    work = work.replace(re, (...args) => {
      const match = args[0] as string;
      // String.replace passes (match, ...groups, offset, string); drop the
      // trailing offset + full-string args to isolate the capture groups.
      const groups = args.slice(1, args.length - 2) as string[];
      const f = fn([match, ...groups]);
      if (!f) return match; // rejected (e.g. "for 24" isn't a date) — leave it for later patterns
      facts.push(f);
      return " ".repeat(match.length);
    });
  };

  // Money: $1,650  $15
  take(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/g, (m) => ({
    kind: "money",
    raw: m[0].trim(),
    normals: [normalizeNumber(m[1])],
  }));

  // Temperature: 100.4°F  100.4 F  100.4°
  take(/(\d+(?:\.\d+)?)\s?°?\s?F\b|(\d+(?:\.\d+)?)\s?°(?!\w)/g, (m) => {
    const n = m[1] ?? m[2];
    return { kind: "temp", raw: m[0].trim(), normals: [normalizeNumber(n)] };
  });

  // ISO date: 2026-11-11
  take(/(\d{4})-(\d{2})-(\d{2})/g, (m) => ({
    kind: "date",
    raw: m[0],
    normals: isoDateNormals(m[1], m[2], m[3]),
  }));

  // Month-name date: "November 11" / "Nov 11, 2026"
  take(
    /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/g,
    (m) => {
      const mo = MONTHS[m[1].toLowerCase()];
      if (!mo) return null;
      const day = m[2].padStart(2, "0");
      const normals = [`${mo}-${day}`];
      if (m[3]) normals.unshift(`${m[3]}-${mo}-${day}`);
      return { kind: "date", raw: m[0].trim(), normals };
    },
  );

  // Time: 11:30  7:00
  take(/\b(\d{1,2}):(\d{2})\b/g, (m) => ({
    kind: "time",
    raw: m[0],
    normals: [normalizeTime(m[1], m[2])],
  }));

  // Percent: 50%
  take(/(\d+(?:\.\d+)?)\s?%/g, (m) => ({
    kind: "percent",
    raw: m[0].trim(),
    normals: [normalizeNumber(m[1])],
  }));

  // Bare numbers (incl. decimals). These carry the high-stakes thresholds
  // ("24 hours", "3 late pickups"), so we do extract them — the rich source
  // index keeps false positives low.
  take(/\b(\d+(?:\.\d+)?)\b/g, (m) => ({
    kind: "number",
    raw: m[0],
    normals: [normalizeNumber(m[1])],
  }));

  return facts;
}

/**
 * Build the set of normalized values that appear in the cited records — from
 * both structured payloads (walked recursively) and body_md prose. Every
 * checkable token found is normalized with the SAME extractors used on the
 * answer, so comparison is apples-to-apples.
 */
export function buildSourceIndex(citedPolicies: KnowledgeEntry[]): Set<string> {
  const index = new Set<string>();
  const addFrom = (text: string) => {
    for (const f of extractFacts(text)) {
      for (const n of f.normals) index.add(n);
    }
  };

  const walk = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "number") {
      addFrom(String(v));
    } else if (typeof v === "string") {
      addFrom(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (typeof v === "object") {
      // keys can carry facts too (e.g. { "2026-11-11": ... }); values matter most
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        addFrom(k);
        walk(val);
      }
    }
  };

  for (const p of citedPolicies) {
    walk(p.structured);
    addFrom(p.body_md);
  }
  return index;
}

export interface FactCheck {
  ok: boolean;
  /** Facts whose value wasn't found in any cited source (the blockers). */
  unsupported: Fact[];
}

/**
 * Verify every extracted fact against the cited-source index. A fact passes if
 * any of its normalized forms is present. Returns the unsupported facts so the
 * audit/debug surface can show exactly what tripped the block.
 */
export function verifyFacts(
  answer: string,
  citedPolicies: KnowledgeEntry[],
): FactCheck {
  const index = buildSourceIndex(citedPolicies);
  const facts = extractFacts(answer);
  const unsupported = facts.filter((f) => !f.normals.some((n) => index.has(n)));
  return { ok: unsupported.length === 0, unsupported };
}
