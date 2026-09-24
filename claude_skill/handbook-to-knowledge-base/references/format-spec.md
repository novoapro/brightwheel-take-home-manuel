# Knowledge Base format spec

The full field contract for a Knowledge Base entry, plus the `structured` payload
conventions per intent. This mirrors the system's `KnowledgeEntryInput` type and
the validation the import endpoint applies.

## Table of contents
- [Envelope](#envelope)
- [Entry fields](#entry-fields)
- [The `structured` payload](#the-structured-payload)
- [Per-intent `structured` conventions](#per-intent-structured-conventions)
- [Common mistakes](#common-mistakes)

## Envelope

```json
{
  "source_document": "string — the handbook's name/title as printed",
  "extracted_at": "YYYY-MM-DD — today's date",
  "entries": [ /* one or more entry objects */ ]
}
```

`source_document` and `extracted_at` are metadata for the importer/operator; the
`entries` array is the payload. `entries` must be non-empty.

## Entry fields

| field | type | required | rules |
|-------|------|----------|-------|
| `id` | string | yes | `<intent>.<slug>`, lowercase. Segments separated by `.`; each segment is `[a-z0-9-]+` — **hyphens only, NO underscores** (underscores belong in `structured` keys, not ids). First segment MUST equal `intent` (enforced by the import). Unique across all entries. e.g. `hours.regular`, `hours.holidays.2026`, `health.illness-exclusion`, `hours.late-pickup`. |
| `intent` | string | yes | Lowercase category token, non-empty, ≤ 40 chars. Prefer a single word (`hours`, `transportation`). No spaces (they break id derivation). |
| `title` | string | yes | Short human label, non-empty. Title Case. e.g. "Late Pickup". |
| `body_md` | string | yes | Warm markdown a parent reads. Non-empty. Bold key facts. Faithful to the source. |
| `structured` | object | yes | Typed machine-readable facts (JSON object; `{}` allowed but discouraged — extract something). Never an array or string at the top level. |
| `keywords` | string[] | yes | Search terms a parent would type, plus literal figures. 5–10 typical. Lowercase mostly; literals like `"$15"` fine. |
| `source` | string \| null | no | Attribution chip, e.g. `"Family Handbook p.6"`. Strongly recommended — it's shown to parents. |
| `effective_from` | string \| null | no | ISO `YYYY-MM-DD`. Only for dated content. |
| `effective_to` | string \| null | no | ISO `YYYY-MM-DD`. Only for dated content. |
| `status` | enum | no | `"published"` (default) \| `"draft"` \| `"unpublished"`. Omit unless the handbook marks it tentative. |

Do **not** emit these — the system sets them: `origin`, `version`, `updated_by`,
`updated_at`.

## The `structured` payload

`structured` is what makes an entry more than a snippet. Deterministic logic in the
system reads these keys to answer precisely ("Is Nov 11 a closure?" "What's the
late fee?") without re-parsing prose. Guidelines:

- **Types matter.** Numbers as JSON numbers (`15`, `100.4`), booleans as booleans
  (`true`), not `"15"` / `"yes"`.
- **Dates** ISO `YYYY-MM-DD`. **Times** 24h `"HH:MM"`.
- **snake_case** keys. Descriptive: `late_fee_usd`, not `fee`.
- **Money**: put the currency in the key (`_usd`) or a sibling `currency` field.
- **Enumerable facts** → arrays or objects, so logic can iterate (closure lists,
  rate tables, exclusion criteria, menus).
- **Only what's stated.** If the handbook doesn't give a number, don't invent a
  key for it. `structured` is a subset of the truth, never a superset.
- It's a free-form object — there's no fixed schema per intent. The conventions
  below are patterns proven to work, not a rigid contract. Adapt to the document.

## Per-intent `structured` conventions

These are the shapes the system's showcase logic expects. Match them when the
handbook supplies the facts.

### hours
- **Regular hours** — a weekday→range map + a closed list:
  ```json
  { "days": { "mon": "07:00-18:00", "tue": "07:00-18:00", "wed": "07:00-18:00",
              "thu": "07:00-18:00", "fri": "07:00-18:00" }, "closed": ["sat", "sun"] }
  ```
- **Closure calendar** — a year + a list of dated closures, each typed:
  ```json
  { "year": 2026, "closures": [
      { "date": "2026-11-11", "name": "Veterans Day", "type": "holiday" },
      { "date": "2026-10-09", "name": "Staff Development Day", "type": "staff_development" }
  ] }
  ```
  `type` ∈ `holiday | staff_development | break | other`. Pair with
  `effective_from`/`effective_to` bounding the year.
- **Weather** — the trigger policy + per-scenario actions:
  ```json
  { "policy": "follows_local_public_schools",
    "delay": { "trigger": "2-hour delay", "open": "10:00", "breakfast_served": false },
    "early_dismissal": { "action": "center_closes" },
    "closure": { "action": "center_closed" } }
  ```
- **Late pickup** — the fee mechanics as numbers:
  ```json
  { "late_fee_usd": 15, "per": "occurrence",
    "late_strikes_before_conference": 3, "unreachable_after_minutes": 30 }
  ```
- **Attendance** — quantified thresholds:
  `{ "full_time_hours_per_day": 6.5, "days_per_week": 5, "notify_if_absent": "daily", "absence_disenroll_weeks": 2 }`

### tuition
- **Rates** — a currency + period + a rate table keyed by age group:
  ```json
  { "currency": "USD", "period": "monthly",
    "rates": [ { "group": "infant", "monthly": 1650 }, { "group": "toddler", "monthly": 1450 } ],
    "includes": ["meals", "snacks", "activities"] }
  ```
  Use the same group tokens as the age bands (`infant`, `toddler`, `preschool`, `prek`).
- **Payment/billing** — booleans + enums:
  ```json
  { "due": "weekly_in_advance", "refundable": false, "prorated": false,
    "methods": ["online"], "late_pickup_fee_added_to_bill": true }
  ```
- **Deposit / registration fee** — `{ "registration_fee_usd": 100, "deposit_usd": 500, "refundable": false }`

### health (sensitive — be exact)
- **Illness exclusion** — the fever threshold as a number + the exclusion list:
  ```json
  { "fever_f": 100.4, "exclude": [
      "fever (100.4F+) now or within last 24h", "vomiting or diarrhea within last 24h",
      "pink eye", "on antibiotics less than 24h" ] }
  ```
- **Return to care** — the clearance windows as numbers:
  `{ "fever_free_hours": 24, "vomit_diarrhea_free_hours": 24, "antibiotics_hours": 24, "doctor_note": "may be required" }`
- **Medication** — the rules as booleans/lists:
  ```json
  { "requires_written_permission": true, "requires": ["child name", "medication", "dosage", "time"],
    "original_container": true, "otc_allowed": ["Tylenol", "sunscreen"] }
  ```
- **Immunizations** — `{ "up_to_date_required": true, "exemptions": ["medical", "religious"], "state": "NM" }`

### meals
- **Provided** — flags + meal times + (if printed) a weekly sample menu:
  ```json
  { "included": true, "family_style": true,
    "times": { "breakfast": "08:00", "lunch": "11:30", "snack": "14:30" },
    "menu_rotates_weekly": true,
    "sample_menu": { "mon": "Pancakes; turkey roll-ups; apple slices" } }
  ```
- **Outside food** — `{ "outside_food": "restricted", "exception": "store-bought, labeled, teacher-approved", "peanut_limited": true }`
- **Allergies** — `{ "allergy_form_required": true, "form": "Nutrition/Allergy Form signed by doctor", "special_meals": "medical only" }`
- **Infant feeding** — `{ "formula_provided": true, "formula_type": "iron-fortified", "breast_milk": "labeled and dated" }`

### tours / enrollment
- **Scheduling** — `{ "steps": ["inquiry_and_tour", "paperwork", "orientation"], "request_channels": ["phone", "in-app"], "info_needed": ["contact", "preferred_time"] }`
- **Required documents** — `{ "required_docs": ["birth certificate", "immunization records", "emergency contacts", "photo ID"] }`
- **Age eligibility** — a cutoff + the age bands:
  ```json
  { "cutoff_date": "Sept 1", "bands": { "infant": "6 weeks-12 months",
    "toddler": "1-2 years", "preschool": "3-4 years", "prek": "4-5 years" } }
  ```

### custom intents
No convention exists — design a clean typed shape from the facts, following the
same rules (numbers as numbers, enumerables as arrays, snake_case). e.g.
`transportation`: `{ "provided": true, "radius_miles": 5, "fee_usd": 40, "car_seats": "parent_provided" }`.

## Common mistakes
- **Inventing facts.** The single worst error. If the page doesn't say it, it
  doesn't go in the JSON. Especially fees, dates, and medical numbers.
- **Stringly-typed structured.** `"late_fee_usd": "15"` or `"refundable": "no"` —
  use real numbers/booleans.
- **One giant "hours" entry.** Split by answerable question.
- **`structured` that just restates `body_md` as one `text` field.** Extract
  discrete typed keys, not a prose dump.
- **Wrong `source` page.** The page number is shown to parents; a wrong cite
  erodes the trust the whole product is built on.
- **id/intent mismatch.** `id`'s first segment must equal `intent` (e.g. intent
  `tours` → id `tours.requirements`, never `enroll.requirements`). The import rejects it.
- **Underscores in `id` or `intent`.** Use hyphens: `hours.late-pickup`,
  `toilet-learning`, not `hours.late_pickup` / `toilet_learning`. (Underscores are
  fine — and expected — in `structured` keys like `late_fee_usd`.)
- **Spaces or capitals in `intent`.** Lowercase, no spaces.
