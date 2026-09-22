# UX Flows (Stage 3 — the experience, both sides)

**Purpose:** Design the two experiences — the **parent front desk** and the **operator control center** — that render everything the earlier stages produce: grounded answers + attribution, warm escalation, the capture loop, the quality panel, the caution-level control, and the provider toggle. Mobile-first (a parent is on a phone).
**Status:** First proposal (wireframe-level) · Date: 2026-09-22
**Depends on:** [00](00-scope-and-bounds.md), [01](01-data-and-knowledge-model.md), [02](02-seed-source-and-policy-map.md), [04](04-grounding-and-prompts.md), [05](05-quality-audit-and-metrics.md)

---

## 1. Design principles — two emotional states

| | Parent (front desk) | Operator (control center) |
|---|---|---|
| **State** | Anxious, caring, on a phone, often off-hours | Busy SMB owner, low time, no IT |
| **Feels good when** | Fast, specific-to-*my*-center, obviously trustworthy; never a dead end | Low-effort curation; the work *is* the queue; sees value (hours saved) |
| **Design response** | Warmth + speed + visible attribution; escalation feels like *help*, not rejection | One-tap capture; a dashboard a busy person actually reads; a simple safety dial |

Non-negotiables carried from scope: **mobile-first**, **trust cues on every answer**, **graceful live relay over confident-wrong**, **warm not IVR**.

---

## 2. Information architecture

Two surfaces, one codebase:
- **`/`  — Parent front desk.** Anonymous, no login. Chat + guided starters. This is the polished, phone-first centerpiece.
- **`/admin` — Operator control center.** Behind a **mock passcode** (not real auth — a non-goal). Tabs: **Dashboard · Live relay · Handbook · Settings**.
- **Real-time link parent ↔ operator.** Escalations relay live over **SSE** (the Railway always-on container holds the stream open; [08](08-architecture-and-stack-review.md)): the parent's "checking with our team…" thread receives the staff reply in real time. This powers the two-pane live demo.
- **`/handbook` — derived read-only handbook** (rendered from PolicyRecords, [01](01-data-and-knowledge-model.md)); linked from parent attribution chips *and* editable via `/admin`.

---

## 3. Parent front desk

### 3.1 Landing + guided starters
Warm, center-branded, immediately useful. Starters map to the 5 intents' high-confidence paths so no one faces a blank box.

```
┌────────────────────────────┐
│ 🌰 Little Acorns · Front Desk│
│                            │
│ Hi! I can help with hours, │
│ tuition, sick-day policy,  │
│ meals, and tours — answers │
│ straight from our center.  │
│                            │
│ ┌ Common questions ───────┐│
│ │ 🕐 Hours & closures     ││
│ │ 💵 Tuition & fees       ││
│ │ 🤒 Sick child policy    ││
│ │ 🍎 Meals & lunch        ││
│ │ 🚸 Schedule a tour      ││
│ └─────────────────────────┘│
│                            │
│ [ Type your question…   ▷] │
└────────────────────────────┘
```

### 3.2 Grounded answer (the trust moment)
Lead with the answer, in specifics, with a **tappable attribution chip** → opens the source policy in the handbook view. Thumbs feed CSAT ([05](05-quality-audit-and-metrics.md)).

```
┌────────────────────────────┐
│ You                        │
│ Are you open Veterans Day? │
│                            │
│ 🌰                          │
│ We're closed Veterans Day, │
│ Tue Nov 11 2026. We reopen │
│ Wed Nov 12 at 7:00 AM.     │
│                            │
│ 📎 per our Handbook —      │
│    Holiday Closures     ›  │
│                            │
│ Helpful?  👍  👎           │
└────────────────────────────┘
```
*Craft:* the answer uses the **actual date** from the `structured` closure array — deterministic, not paraphrased. The chip makes the source **visible and verifiable**.

### 3.3 Escalation — live staff relay (the empathy moment)
**"Resolve, don't relay" — one voice, one thread.** The front desk never says "let me connect you to a human." When it isn't certain, it *stays in control* of the conversation, gives whatever *general policy* helps, and says it's checking with the team — **in real time, in the same thread**. The staff answer comes back relayed by the front desk, **marked as human-sourced**. No channel switch, no "leave your number," no async wait.

The fever example — states the policy, then relays the case:

```
┌────────────────────────────┐        ┌────────────────────────────┐
│ You                        │        │ You                        │
│ My son had a fever last    │        │ My son had a fever last    │
│ night — can he come in?    │        │ night — can he come in?    │
│                            │        │                            │
│ 🌰 Little Acorns           │        │ 🌰 Little Acorns           │
│ In general, kids need to   │        │ In general, kids need to   │
│ be fever-free 24 hrs (under│  ▶▶▶   │ be fever-free 24 hrs …     │
│ 100.4°F) before returning. │        │ 📎 Illness Policy ›        │
│ 📎 Illness Policy ›        │        │                            │
│                            │        │ ✓ From our team · Maria    │
│ Let me check with our team │        │ Since he was 101 last night│
│ on your specific case —    │        │ he needs one more fever-   │
│ one moment… ◐              │        │ free day. Bring him Thu!   │
│                            │        │                            │
└────────────────────────────┘        └────────────────────────────┘
     pending (real-time)                 staff answer, relayed in-thread
```
*Craft:* the front desk **stays in control** ("let me check… one moment") instead of deferring the conversation. The specific-case answer is **added by a person in real time** and **marked `✓ From our team`** — provenance that *builds* trust (you can see when a human weighed in). The parent never leaves the thread or the front-desk voice.

**Provenance on every message** (the trust spine):
- 📎 **handbook-grounded** (AI answered from a cited policy), or
- 👤 **✓ From our team** (a staff member answered/confirmed in real time).

**Off-hours degradation (edge, not the focus):** if no staff responds within a short window, the front desk gracefully offers to note the question for follow-up — a fallback, not the primary experience.

### 3.4 Parent flow (state machine)
```
Landing ──tap starter / type──▶ Thinking… ──▶ ┌ AI answer (📎 chip, 👍/👎)
                                              │   └─follow-up──▶ Thinking…
                                              └ Relay: policy + "checking with our team…◐"
                                                    └─staff replies (real-time)──▶
                                                       ✓ From our team, in-thread
```
Multi-turn is natural: a thread can start general (AI answer) and turn case-specific (relay to staff) — the [04](04-grounding-and-prompts.md) wrapper re-decides each turn, and the front desk stays one continuous voice throughout.

### 3.5 States
Loading ("Checking our handbook…"), AI-answered, **relay-pending** ("checking with our team…◐"), **staff-answered** (`✓ From our team`), relay-timeout fallback (off-hours), error ("I'm having trouble — let me get our team on this" = a *safe* fallback that relays), offline.

---

## 4. Operator control center

### 4.1 Dashboard — a busy owner's 10-second read
Hero = **hours saved** (the ROI number). Then trust, then the actionable gaps and the queue.

```
┌─────────────────────────────┐
│ Little Acorns · Control Ctr │
│ Dashboard·Escalations·Handbook·Settings│
│                             │
│ ┌ This week ───────────────┐│
│ │  ⏱ 6.4 hrs saved         ││
│ │  84% handled  ·  16% → you││
│ └──────────────────────────┘│
│                             │
│ Trust                       │
│  Groundedness      97%      │
│  Answers with source 100%   │
│                             │
│ Top gaps (add a policy →)   │
│  • "Do you offer part-time?"│
│      asked 5×   [Add]       │
│  • "Nut-free classroom?"    │
│      asked 3×   [Add]       │
│                             │
│  ⚠ 3 escalations waiting  › │
└─────────────────────────────┘
```
*This view is [05](05-quality-audit-and-metrics.md) made human:* containment, groundedness, top gaps, hours saved — no wall of charts. "Top gaps" turns the metric into a one-tap action.

### 4.2 Live relay queue → answer → capture (the compounding loop)
The queue is the **real-time** "a parent is waiting" view — the parent sees "checking with our team…◐" while this sits here. The operator's reply **relays straight into the live parent thread**, marked `✓ From our team`. Answering **doubles as labeling** ([05](05-quality-audit-and-metrics.md)). Capture is smart about policy-vs-case.

```
┌─────────────────────────────┐
│ ‹ Live relay (1 waiting · 2) │
│                             │
│ 🔴 Ana is waiting · 0:40    │
│ 🤒 Health · case-specific   │
│ "My son had a fever last    │
│  night, can he come in?"    │
│  AI already shared: Illness │
│  Policy (fever-free 24h)    │
│                             │
│ ┌ Reply (relays to Ana now)┐│
│ │ [                       ]││
│ └──────────────────────────┘│
│  [ Send to Ana's chat ]     │
│                             │
│  ☐ Save as a policy         │
│    (off — specific child's  │
│     case, not general)      │
└─────────────────────────────┘
```
*The waiting timer + "AI already shared" context* let staff answer fast and without repeating what the front desk already said. Sending drops the reply into Ana's thread in real time.
```
┌─────────────────────────────┐
│ 💤 Out-of-scope · general    │
│ "Do you offer part-time      │
│  schedules?" · asked 5×      │
│                             │
│ ┌ Answer ─────────────────┐ │
│ │ Yes — 3 half-days/wk…   │ │
│ └──────────────────────────┘│
│  ☑ Save as policy           │
│     Intent [Hours ▾]        │
│     ↳ becomes citable; the  │
│       front desk answers    │
│       this next time.       │
│  [ Send + Publish ]         │
└─────────────────────────────┘
```
*Craft:* the **capture toggle is context-aware** — defaulted **off** for case-specific/sensitive (a fever reply must never become an auto-answer), **on** for general knowledge gaps. That single behavior *is* "policy = answer, case = escalate," enforced in the operator UX. On publish, a small line confirms the compounding: "This will now help future families."

### 4.3 Handbook / source-of-truth editor
List by intent; edit prose **and** structured data; publish/draft; `✎ captured` badge shows loop-born records.

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│ ‹ Handbook (source of truth)│         │ ‹ Edit · 2026 Holiday Closures│
│ [+ New]           [Preview] │         │ Title [2026 Holiday Closures]│
│                             │         │ Intent [Hours▾] Sensitivity[None]│
│ Hours & closures        (5) │         │                             │
│  Regular hours        ✓pub  │         │ What parents see            │
│  2026 Holiday closures ✓pub │   tap   │ [We're closed on these…    ]│
│  Snow / weather       ✓pub  │  ────▶  │                             │
│ Tuition & fees          (3) │         │ Structured data · Closures  │
│  Age-group rates      ✓pub  │         │  [11-11-2026][Veterans Day] │
│ Health                  (5) │         │  [11-26-2026][Thanksgiving] │
│  Illness policy       ✓pub  │         │  [+ add date]               │
│  Return-to-care  ✎captured  │         │ Source label [Family Handbook]│
│                             │         │ [Save draft]     [Publish]  │
└─────────────────────────────┘         └─────────────────────────────┘
```
*Craft:* editing **structured data** (dates, rates, thresholds) — not just prose — is what makes answers deterministic. The editor exposes that directly, which is the depth the brief rewards.

### 4.4 Settings — the safety dial + provider toggle
Two controls from Stage 4, made human.

```
┌─────────────────────────────┐
│ ‹ Settings                  │
│ Front-desk caution level    │
│  ( ) Cautious — hand off more│
│  (•) Balanced (recommended) │
│  ( ) Lean — answer more     │
│  🔒 Safety, abuse, injuries, │
│     custody & billing disputes│
│     always go to a person.   │
│                             │
│ AI provider (for testing)   │
│  (•) Claude · Sonnet 5      │
│  ( ) Gemini · 3.5 Flash     │
│  Compare results → Dashboard │
└─────────────────────────────┘
```
*Craft:* the caution dial gives the **owner ownership of the safety-vs-deflection tradeoff** (Stage 4 τ presets), with a visible floor-lock. The provider toggle makes the model-agnostic design tangible and comparable.

---

## 5. Component inventory (build-reuse)
Message bubble (with provenance marker 📎/👤) · **attribution chip** (source → handbook) · starter chip · thumbs · **relay-pending indicator** ("checking with our team…◐") · stat tile (hours saved) · gap row (question + count + Add) · **relay-queue card** (waiting timer + intent + reason + "AI already shared" + reply + context-aware capture) · policy list row (status badge) · policy editor (prose + structured rows) · caution radio · provider radio.

---

## 6. Identity & voice (decided)
- **Named center front desk** — "Little Acorns Front Desk," one continuous voice. Staff work *behind* it, never presented as a separate/better channel. It never says "I'm just a bot — let me get a human."
- **But provenance is transparent:** answers are marked **📎 handbook-grounded** or **👤 From our team**. Honesty *through attribution* rather than a disclaimer that invites the human-switch mental model. Seeing when a person weighed in **builds** trust and keeps the AI answers credible (it knows its limits).

## 6b. Visual direction (light — real design at build)
- **Warm, human, calm:** rounded, soft palette (acorn/greens from the center persona), generous spacing, friendly copy. The opposite of an IVR.
- Parent chat feels like texting a caring front-desk lead; operator feels like a tidy, reassuring cockpit.
- Theme-aware, accessible contrast, tap targets ≥44px, respects reduced-motion.

---

## 7. Accessibility & mobile notes
Phone widths first (test at 360–390px). Single-column, thumb-reachable input, no horizontal scroll. Semantic roles for chat log (aria-live for new messages), labeled inputs, focus states. Handoff/escalation copy readable at a glance.

---

## 8. How this renders each prior stage
- **[00] escalation loop** → warm handoff (3.3) + queue→capture (4.2).
- **[01] atomic records + derived handbook** → attribution chip → `/handbook`; structured editor (4.3).
- **[02] policy-vs-case + sensitive taxonomy** → context-aware capture toggle (4.2); intents as starters (3.1).
- **[04] escalation engine + caution + provider** → handoff (3.3), settings dial + toggle (4.4).
- **[05] metrics** → dashboard (4.1); thumbs (3.2); answering-labels-for-free (4.2); provider A/B.

---

## 9. Decisions / forks

**Decided:**
1. **Escalation model:** ✅ **Live staff relay — "resolve, don't relay."** Front desk stays in control ("checking with our team…◐"), staff answer relays into the same thread in real time, marked `✓ From our team`. No async callback, no channel switch, no contact-capture. Off-hours degrades to a follow-up offer (edge).
2. **Identity:** ✅ **Named front desk + per-message provenance** (📎 grounded / 👤 from our team). §6.
3. **Operator gate:** ✅ **Mock passcode** (not real auth).
4. **Real-time transport:** ✅ **SSE** on the Railway always-on container ([08](08-architecture-and-stack-review.md)) — powers the two-pane live demo.

**Still open:**
5. **Handbook view placement:** standalone `/handbook` shared by parent chips + operator preview (lean — single source) vs. inline popovers.
6. **Dashboard hero metric:** "hours saved" hero (lean), containment/groundedness secondary — confirm it matches the ROI pitch.
7. **Guided-flow depth:** single-tap starters (lean); optional multi-step guided flows per intent later (novelty).
8. **Relay wait UX:** exact holding-time before the off-hours fallback triggers; whether to show a live "typing/at the desk" cue.
```
