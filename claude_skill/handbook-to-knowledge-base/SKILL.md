---
name: handbook-to-knowledge-base
description: >-
  Parse a childcare/preschool center's family handbook (PDF, or pasted text) into
  valid Front Desk Knowledge Base JSON that imports straight into the system —
  a { entries: [...] } object of citable, grounded policy entries with rich typed
  `structured` payloads. Use this whenever someone wants to turn a handbook,
  policy document, parent guide, enrollment packet, or FAQ into knowledge-base
  entries, seed data, or importable KB JSON — including phrasings like "extract
  policies from this PDF", "convert our handbook into entries", "build the
  knowledge base from this document", "ingest this parent guide", or "make seed
  data from these policies", even when the file format or exact schema isn't named.
---

# Handbook → Knowledge Base

Turn a center's family handbook into **importable Knowledge Base JSON** for the Front
Desk system. The output is the source of truth a parent-facing assistant answers
from, so two things matter above all:

1. **Grounding, not invention.** Every fact must come from the document. Never
   round a number, guess a fee, infer a policy the handbook doesn't state, or
   smooth over a gap. Missing facts are omitted — a thin entry beats a wrong one.
2. **Two payloads per entry.** Each entry carries both warm prose (`body_md`, what
   a parent reads) *and* a typed machine-readable `structured` object (the facts
   the system's deterministic policy logic runs on). The `structured` payload is
   the craft edge — extract it richly, see `references/format-spec.md`.

## Output contract (the short version)

Emit a single JSON object:

```json
{
  "source_document": "Sunrise Montessori Family Handbook 2026",
  "extracted_at": "2026-09-23",
  "entries": [ /* KnowledgeEntryInput objects */ ]
}
```

Each entry:

```json
{
  "id": "hours.late-pickup",
  "intent": "hours",
  "title": "Late Pickup",
  "body_md": "Pickup is by 6:00 PM. A late pickup is **$15 per occurrence** ...",
  "structured": { "late_fee_usd": 15, "per": "occurrence", "grace_minutes": 0 },
  "keywords": ["late", "pickup", "fee", "$15", "after hours"],
  "source": "Family Handbook p.6"
}
```

Required: `id`, `intent`, `title`, `body_md`, `structured` (object), `keywords`
(array). Optional: `source`, `effective_from`, `effective_to`, `status`.
Full field-by-field rules and the per-intent `structured` conventions live in
**`references/format-spec.md`** — read it before extracting. Worked gold examples
across every core intent are in **`references/examples.md`**.

## Workflow

### 1. Read the document
For a PDF, use the Read tool (it renders PDF pages). Read the whole thing first —
handbooks scatter one topic across several pages (e.g. hours on p.3, closures on
p.4, snow days on p.5). Note the page numbers as you go; they become `source`.

### 2. Segment into atomic policies
Break the handbook into the smallest independently-citable units. One entry =
one answerable question. "Hours" is not one entry — it's *regular hours*, *the
closure calendar*, *snow/weather*, *late pickup*, *attendance*, each its own
entry. Splitting finely is what lets the assistant cite precisely and lets an
operator publish/unpublish policies one at a time.

Prefer **depth over breadth**: a handful of policies extracted with complete,
correct `structured` payloads beats fifty shallow prose blobs.

### 3. Pick the intent (category) for each policy
Map each policy to a category. The core taxonomy the system ships with:

| intent    | covers                                                    |
|-----------|-----------------------------------------------------------|
| `hours`   | operating hours, closures/holidays, weather, late pickup, attendance |
| `tuition` | rates, billing, payment, deposits, late-payment, subsidies |
| `health`  | illness exclusion, return-to-care, medication, immunizations, allergies affecting care — **sensitive** |
| `meals`   | meals/snacks provided, menus, outside food, allergies, infant feeding |
| `tours`   | tours, enrollment, required documents, age eligibility, visits |

If a policy genuinely fits none (e.g. transportation, discipline, clothing,
naps), coin a new lowercase single-word `intent` (≤40 chars, e.g.
`transportation`, `discipline`). Don't force a bad fit — a clean new category is
better. Reuse an existing category name exactly when one fits.

### 4. Write each entry
- **`id`**: `<intent>.<short-slug>`, lowercase, **hyphens not underscores**, e.g.
  `tuition.rates`, `health.illness-exclusion`. The first segment must equal the
  `intent`. Add a qualifier segment when useful: `hours.holidays.2026`. Must be unique.
- **`title`**: a short human label, e.g. "Late Pickup", "When to Keep Your Child Home".
- **`body_md`**: warm, plain-spoken markdown — the voice of a caring front-desk
  lead, never a cold IVR. **Bold the key facts** a parent scans for (fees, times,
  temperatures, deadlines). Keep it faithful to the handbook; you may soften tone
  and format as a list, but never change a fact. 1–4 short paragraphs or a tight list.
- **`structured`**: extract every machine-usable fact into typed keys — numbers as
  numbers, booleans as booleans, dates as ISO `YYYY-MM-DD`, times as `"HH:MM"`,
  enumerable facts as arrays/objects. snake_case keys. See the per-intent
  conventions in `references/format-spec.md`. Only include facts the document
  states.
- **`keywords`**: the terms a parent would actually type, plus notable literals
  from the answer ("$15", "100.4", "veterans day"). 5–10 is plenty.
- **`source`**: the attribution chip, e.g. `"Family Handbook p.6"`. Use the real
  page number. This is shown to parents ("per the handbook, p.6") — get it right.
- **`effective_from` / `effective_to`**: only for dated content (a specific
  year's closure calendar, a rate that starts a term). ISO dates. Omit otherwise.
- **`status`**: omit it (defaults to `published`). Use `"draft"` only if the
  handbook itself marks something as tentative/coming-soon.

### 5. Handle the sensitive & the uncertain
- `health` entries are sensitive — be *exact* with medical thresholds
  (temperatures, exclusion windows, medication rules). A wrong number here is the
  worst failure mode. Copy figures verbatim.
- If the handbook is ambiguous or a fact is partially stated, capture what's
  certain in `structured` and describe the nuance in `body_md` — do not fabricate
  the missing piece. When a whole topic is too thin to ground, it's fine to leave
  it out and note it (see step 7).

### 6. Validate before returning
Write the JSON to a file, then run the bundled validator:

```bash
python3 .claude/skills/handbook-to-knowledge-base/scripts/validate_kb.py <path-to-output.json>
```

It checks the import contract (required fields, id/intent format, `structured`
is an object, `keywords` is an array, unique ids, enum values) and flags quality
issues (empty keywords, missing source, prose-only structured). Fix every ERROR;
resolve WARNINGs where you can. Re-run until clean.

### 7. Report
Return the path to the validated JSON and a short summary: how many entries, by
intent, and — importantly — **anything you deliberately left out or couldn't
ground** (e.g. "the handbook mentions a sibling discount but never states the
amount, so I omitted it"). That honesty is what lets the operator fix the source.

## Reference files
- `references/format-spec.md` — full field contract + per-intent `structured` conventions. Read before extracting.
- `references/examples.md` — complete gold entries for every core intent. Pattern-match against these.
- `scripts/validate_kb.py` — the import-contract validator. Always run it on your output.
