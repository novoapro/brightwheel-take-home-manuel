# Seed Source & Policy Map (Stage 2 — grounding the seed data)

**Purpose:** Turn the real Albuquerque family handbook (the one the brief pointed to) into the concrete seed **PolicyRecords** and **escalation taxonomy** for Little Acorns — grounded in real policy so the demo is realistic, adapted (not copied) into our fictional independent SMB.
**Status:** Draft · Date: 2026-09-22 · Depends on: [01-data-and-knowledge-model.md](01-data-and-knowledge-model.md)
**Source:** City of Albuquerque, Division of Child & Family Development — *2019 Family Handbook* (public document, cabq.gov). Read locally, pp. 1–58.

---

## 1. Provenance & adaptation stance

- **Public document, used as factual inspiration** — not reproduced verbatim. Little Acorns PolicyRecords are **reworded and adapted** into our own voice and center. (The brief explicitly invites using this handbook as inspiration; we invent the center.)
- **Key adaptation — city program → independent SMB.** The source is a *city-run Head Start / NM Pre-K* program: income-based **graduated fees, state subsidies, CACFP-funded meals, APS-linked closures**. Little Acorns is an **independent, owner-operated SMB**, so:
  - We keep **operational policies faithful** (hours structure, illness exclusion, late-pickup, closures logic, meals-provided, enrollment/tour flow, safety escalations) — these are realistic and transferable.
  - We **replace income-based fees with invented flat published tuition by age group** — what an independent center actually posts on its site. (Rationale noted in §5.)
  - We drop program-specific artifacts (Head Start Policy Council, NM Pre-K funding, ASQ) that wouldn't appear at an independent SMB.

---

## 2. Intent → PolicyRecord candidate map

Each row is a candidate `PolicyRecord` (per [01 §2.2](01-data-and-knowledge-model.md)). "Grounded fact" = from the handbook; "Structured payload" = the typed data that powers deterministic logic; "Invent" = what we fabricate for Little Acorns.

### 2.1 HOURS & CLOSURES  (`intent: hours`)
| Candidate record | Grounded fact (source) | Structured payload | Invent |
|---|---|---|---|
| `hours.regular` | Centers operate ~7:00 am–5:30/6:00 pm; program vs. extended-care windows | `hours: {mon–fri: "7:00-18:00"}`, `program_core`, `extended_care` | Little Acorns single schedule 7:00–18:00 |
| `hours.holidays` | "Closure dates for city holidays, staff development, maintenance… may vary year to year" | `closures: [{date, name, type}]` | A concrete **2026 closure calendar** (Veterans Day 11-11, Thanksgiving 11-26/27, winter break, etc.) — *this makes "open on Veterans Day?" answerable deterministically* |
| `hours.snow_weather` | Snow-day cascade tied to APS: 2-hr delay → open 10:00am, no breakfast; APS early dismissal → center closes; APS closure → closed | `weather_rule: {delay_open:"10:00", ...}` | Reframe "APS" → "local public schools" for an independent |
| `hours.late_pickup` | "$15.00 per occurrence" after close; **3 late arrivals/pickups → parent conference**; 30 min after close + unreachable → police/CPS | `late_fee_usd: 15`, `late_strikes_before_conference: 3` | keep; the after-close→authorities path is **escalation**, not an answer |
| `hours.attendance` | Full-time = **6.5 hrs/day, 5 days/wk**; notify daily if absent; **2 consecutive weeks no contact → disenrollment** | `absence_disenroll_weeks: 2` | keep |

### 2.2 TUITION & FEES  (`intent: tuition`)
| Candidate record | Grounded fact | Structured payload | Invent |
|---|---|---|---|
| `tuition.rates` | Source uses **graduated income-based fees** (no public $ figures) | `rates: [{group, monthly_usd}]` | **Invent flat published rates** by age band (infant > toddler > preschool > pre-K) |
| `tuition.payment` | Paid **in advance**, **non-refundable**, no pro-rating; pay online; late-pickup fee added to bill | `due:"weekly_in_advance"`, `refundable:false` | keep, simplified |
| `tuition.billing_disputes` | (implicit) | — | **Sensitive → escalation**, never auto-answer a dispute (see §3) |

### 2.3 HEALTH & SICK-CHILD  (`intent: health`, `sensitivity: sensitive`)
The richest deterministic + escalation surface. Grounded exclusion criteria:
| Candidate record | Grounded fact | Structured payload |
|---|---|---|
| `health.illness_exclusion` | **Keep home if:** fever or fever within last 24h (**100.4°F**); continuous nap coughing; vomit/diarrhea within 24h; pink eye; cloudy runny nose; on antibiotics <24h; contagious symptoms (ringworm, chicken pox…); undiagnosed rash | `fever_f: 100.4`, `exclude: [...criteria]`, `return_rules: {...}` |
| `health.return_to_care` | Doctor's note may be required to return; **hospitalized/ER → medical release required** | `hospital_return: "medical_release_required"` |
| `health.contagious` | Center must be informed; some diseases reportable to State Licensing/Public Health | flag `reportable: true` |
| `health.medication` | Admin only with written permission (name/med/dosage/time), **original container**; no cough drops (choking); OTC list (Tylenol, sunscreen…) | `requires_form: true` |
| `health.immunizations` | Up-to-date record required to attend; NM exemption law (medical/religious) | — |

**Escalation rule for this intent:** answer the **policy** (e.g. "the fever threshold is 100.4°F, and a child must be fever-free 24h before returning"), but **escalate anything about a specific child's symptoms/diagnosis** ("does *my child's* rash count?", "he threw up once, is that ok?") — that's judgment, not policy. This is the sharp health-safety edge from [00 §6](00-scope-and-bounds.md).

### 2.4 MEALS & FOOD  (`intent: meals`)
| Candidate record | Grounded fact | Structured payload | Invent |
|---|---|---|---|
| `meals.provided` | Meals + snacks provided (source: CACFP/Canteen); **lunch served family-style**; breakfast/lunch/snack times in daily schedule | `meals: {breakfast:"8:00", lunch:"11:30", snack:"14:30"}` | a simple **weekly menu** (source has none public) |
| `meals.outside_food` | **No outside food** except store-bought w/ nutrition label, teacher-approved; peanut-limited; label with name+date | `outside_food: "restricted"` | keep |
| `meals.allergies` | **Nutrition/Allergy Form signed by doctor**; vendor makes medical (not lifestyle) special meals | `allergy_form_required: true` | keep — child-specific allergy handling leans **escalation** |
| `meals.infants` | Formula w/ iron provided; breast milk labeled/dated | — | keep (if we include an infant room) |

### 2.5 TOURS & ENROLLMENT  (`intent: tours`)
| Candidate record | Grounded fact | Structured payload | Invent |
|---|---|---|---|
| `tours.scheduling` | Enrollment starts with a **phone prequalification**, then paperwork, then a **mandatory orientation/mini-tour** at start | `steps: [inquiry, paperwork, orientation]` | a simple **"request a tour" path** (contact + preferred time) |
| `enroll.requirements` | Required docs: **birth certificate, immunization records, emergency contacts, ID**; age eligibility by group | `required_docs: [...]`, `age_bands: {...}` | keep |
| `enroll.age_eligibility` | Preschool 3–5; Pre-K = 4 by Sept 1; Early Pre-K = 3 by Sept 1 | `cutoff: "Sept 1"` | adapt to Little Acorns bands |
| `visits.open_door` | Parents welcome to visit anytime; sign in; ~10-min classroom visits | — | keep (nice warmth cue) |

---

## 3. Sensitive-topic taxonomy → escalation categories

Straight from the handbook, mapped to the canonical `sensitive_category` set ([09 §4.1](09-plan-review-and-consistency.md)). These are the "never auto-answer" set — the front desk **relays to staff in one voice** (never a channel switch):

| Handbook topic | Escalation reason | Why it must be a human |
|---|---|---|
| Custody / divorced-separated parents, restraining orders, pickup authorization | `sensitive:custody` / `pii` | Legal, child-safety, identity-specific — center is "a neutral party." |
| **Suspected child abuse/neglect** | `sensitive:safety` | Mandatory legal report; explicitly **not confidential**. Never a chatbot topic. |
| Accidents / injuries / hospitalization / incident reports | `sensitive:incident` | Child-specific medical event. |
| Behavioral issues / restraint / expulsion risk | `sensitive:behavior` | Requires a conference, judgment, care. |
| Disenrollment / termination / fees in arrears | `sensitive:billing` / `sensitive:enrollment` | Account-specific, emotionally charged. |
| Billing **disputes** (vs. general fee info) | `sensitive:billing` | Dispute ≠ FAQ. |
| Missing child / lock-down / emergency | `sensitive:safety` | Real-time crisis → humans + 911, not an assistant. |
| Grievances / complaints about staff | `sensitive:grievance` | Route to Head Teacher per grievance process. |
| Child-specific health/allergy/medication judgment | `sensitive:health` | Answer the *policy*, escalate the *case*. |
| Special needs / IFSP / IEP / toilet-learning plans | `sensitive:individual` | Individualized plans, not general policy. |

**Design consequence:** the assistant answers **general policy** confidently; the moment a question is about *this specific child/account/incident*, it escalates. That single rule ("policy = answer, case = escalate") is clean, defensible, and demo-able.

---

## 4. Deterministic-logic showcases (the depth demos)

These are the handbook facts that let us demonstrate *real logic*, not paraphrase — the edge-case handling the brief rewards. Worth featuring in the demo script:

1. **"Are you open on Veterans Day?"** → check date against `hours.holidays.closures[]` → exact yes/no with the date. (Time-aware.)
2. **"It snowed — are you open?"** → the APS-style cascade (delay → 10:00 open, no breakfast / early-dismissal → closed / closure → closed).
3. **"My kid had a fever last night, can he come in?"** → state the **100.4°F / fever-free-24h** *policy*, then **escalate** because it's about a specific child.
4. **"What happens if I'm late picking up?"** → `$15/occurrence`, and **3 lates → a conference** (shows the system knows consequences, not just facts).
5. **"I forgot lunch"** → meals are provided (family-style, 11:30) → reassure + note outside-food/allergy rules.

---

## 5. Gaps to invent (not in the source)

| Gap | Why | Plan |
|---|---|---|
| **Tuition dollar amounts** | Source is income-graduated; independents post flat rates | Invent realistic monthly rates by age band |
| **Concrete 2026 holiday calendar** | Source says "varies, ask office" | Fabricate a specific closure list → enables date logic |
| **Weekly lunch menu** | Source: "provided by Canteen/CACFP," no menu | Fabricate a simple rotating menu |
| **Center identity details** | n/a | Little Acorns, ABQ (from [01 §2.1](01-data-and-knowledge-model.md)) |
| **Tour request mechanism** | Source uses phone prequalification | Simple in-app "request a tour" (contact + time) |

---

## 6. Forwarded to next stages

- **Seed authoring (data stage):** write the ~15–25 PolicyRecords above with real `structured` payloads + the invented gaps.
- **Grounding/prompts (Stage 04):** encode the **"policy = answer, case = escalate"** rule and the sensitive taxonomy in §3 as the escalation decision.
- **Audit seed (Stage 05):** seed interactions that exercise the §4 showcases (some answered, some escalated) so metrics render live.
- **Handbook view (per [01](01-data-and-knowledge-model.md)):** the read-only parent handbook page renders from these records.
