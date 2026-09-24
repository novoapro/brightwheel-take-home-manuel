# Gold examples

Complete, correct entries across every core intent. Pattern-match your output
against these — note how each pairs warm `body_md` with a rich typed `structured`
payload, and how facts (and only stated facts) flow from prose into typed keys.

These are drawn from a fictional center ("Little Acorns"). Your entries will carry
the facts of *your* handbook — the shapes are what to copy.

## hours — closure calendar (dated, list payload)

```json
{
  "id": "hours.holidays.2026",
  "intent": "hours",
  "title": "2026 Holiday & Closure Calendar",
  "body_md": "Little Acorns is closed on the following dates in 2026. We give as much notice as possible for staff-development days.",
  "structured": {
    "year": 2026,
    "closures": [
      { "date": "2026-01-01", "name": "New Year's Day", "type": "holiday" },
      { "date": "2026-05-25", "name": "Memorial Day", "type": "holiday" },
      { "date": "2026-10-09", "name": "Staff Development Day", "type": "staff_development" },
      { "date": "2026-11-11", "name": "Veterans Day", "type": "holiday" },
      { "date": "2026-11-26", "name": "Thanksgiving Day", "type": "holiday" }
    ]
  },
  "keywords": ["holiday", "closed", "closure", "veterans day", "thanksgiving", "calendar", "2026"],
  "effective_from": "2026-01-01",
  "effective_to": "2027-01-01",
  "source": "Family Handbook p.4"
}
```

## hours — late pickup (numeric fee mechanics)

```json
{
  "id": "hours.late-pickup",
  "intent": "hours",
  "title": "Late Pickup",
  "body_md": "Pickup is by 6:00 PM. A late pickup is **$15 per occurrence**, added to your next bill. After **3 late pickups** we'll ask to sit down together for a short parent conference. If a child is still here 30 minutes after close and we can't reach anyone on the contact list, we're required to call the authorities — so please keep your emergency contacts current.",
  "structured": {
    "late_fee_usd": 15,
    "per": "occurrence",
    "late_strikes_before_conference": 3,
    "unreachable_after_minutes": 30
  },
  "keywords": ["late", "pickup", "fee", "$15", "conference", "after hours", "6pm"],
  "source": "Family Handbook p.6"
}
```

## tuition — rates (rate table keyed by age group)

```json
{
  "id": "tuition.rates",
  "intent": "tuition",
  "title": "Tuition Rates",
  "body_md": "Monthly tuition depends on your child's age group:\n\n- **Infant** (6 wks–12 mo): $1,650/mo\n- **Toddler** (1–2 yr): $1,450/mo\n- **Preschool** (3–4 yr): $1,250/mo\n- **Pre-K** (4–5 yr): $1,150/mo\n\nRates cover meals, snacks, and all classroom activities.",
  "structured": {
    "currency": "USD",
    "period": "monthly",
    "rates": [
      { "group": "infant", "monthly": 1650 },
      { "group": "toddler", "monthly": 1450 },
      { "group": "preschool", "monthly": 1250 },
      { "group": "prek", "monthly": 1150 }
    ],
    "includes": ["meals", "snacks", "classroom activities"]
  },
  "keywords": ["tuition", "cost", "price", "rate", "monthly", "how much", "infant", "toddler", "preschool", "prek"],
  "source": "Family Handbook p.9"
}
```

## health — illness exclusion (SENSITIVE — exact thresholds)

Note the fever threshold captured as a **number** (`100.4`) and the exclusion
criteria as an iterable list. Medical figures are copied verbatim from the source.

```json
{
  "id": "health.illness-exclusion",
  "intent": "health",
  "title": "When to Keep Your Child Home",
  "body_md": "Please keep your child home if they have any of the following. A fever means a temperature of **100.4°F or higher** — or any fever in the **last 24 hours**.\n\n- Fever (100.4°F+), now or within the last 24 hours\n- Vomiting or diarrhea within the last 24 hours\n- Pink eye or thick, cloudy nasal discharge\n- On antibiotics for less than 24 hours\n\nIf you're unsure whether your child's specific symptoms mean they should stay home, let us know and a staff member will help you decide.",
  "structured": {
    "fever_f": 100.4,
    "exclude": [
      "fever (100.4F+) now or within last 24h",
      "vomiting or diarrhea within last 24h",
      "pink eye",
      "thick or cloudy nasal discharge",
      "on antibiotics less than 24h"
    ]
  },
  "keywords": ["sick", "fever", "100.4", "keep home", "stay home", "vomit", "diarrhea", "pink eye", "illness"],
  "source": "Family Handbook p.12"
}
```

## meals — provided (times + sample menu)

```json
{
  "id": "meals.provided",
  "intent": "meals",
  "title": "Meals & Snacks",
  "body_md": "We provide **breakfast, lunch, and an afternoon snack** every day, served **family-style**. Breakfast is at 8:00, lunch at 11:30, and snack at 2:30. Our menu rotates weekly — so if you ever forget to pack something, don't worry, your child will eat well.",
  "structured": {
    "included": true,
    "family_style": true,
    "times": { "breakfast": "08:00", "lunch": "11:30", "snack": "14:30" },
    "menu_rotates_weekly": true,
    "sample_menu": {
      "mon": "Whole-grain pancakes; turkey & cheese roll-ups, carrots; apple slices",
      "tue": "Oatmeal & berries; bean & cheese burrito, corn; yogurt"
    }
  },
  "keywords": ["meals", "food", "lunch", "breakfast", "snack", "menu", "forgot lunch", "family style"],
  "source": "Family Handbook p.17"
}
```

## tours — enrollment requirements (document checklist)

Enrollment topics live under the `tours` intent, so the id starts with `tours.`
(the first id segment must equal the intent — the import rejects `enroll.requirements`
under intent `tours`). Note hyphens, never underscores, in ids: `tours.requirements`,
`health.illness-exclusion`.

```json
{
  "id": "tours.requirements",
  "intent": "tours",
  "title": "Enrollment Requirements",
  "body_md": "To enroll we'll need a few documents: your child's **birth certificate**, up-to-date **immunization records**, **emergency contacts**, and a **photo ID** for anyone authorized to pick up. We'll hand you a simple checklist at your tour.",
  "structured": {
    "required_docs": ["birth certificate", "immunization records", "emergency contacts", "photo ID"]
  },
  "keywords": ["enroll", "enrollment", "documents", "paperwork", "birth certificate", "requirements", "sign up"],
  "source": "Family Handbook p.2"
}
```

## A note on splitting

The six examples above would come from just three handbook sections ("Hours",
"Tuition", "Health", "Meals", "Enrollment"). Each answerable question is its own
entry — that granularity is deliberate. A parent asking "what's the late fee?"
should get an answer citing exactly the late-pickup entry, not a wall of hours
policy.
