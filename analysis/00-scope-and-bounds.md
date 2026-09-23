# AI Front Desk — Scope & Bounds (Planning Stage 1)

**Project:** Brightwheel take-home — hosted, mobile-first proof of concept of an "AI Front Desk" for an independent early-education center.
**This document defines the *bounds*:** what we are building, what we are deliberately not, and the single mechanism the whole prototype is organized around. Downstream planning artifacts (data model, architecture, UX flows, prompt/grounding design, build sequence) refine within these bounds.

**Status:** Draft for alignment · Date: 2026-09-22 · Author: Manuel

---

## 1. The one-line thesis

> A front desk that answers the routine questions *precisely and warmly*, and — for everything else — **brings in a staff member in real time without leaving the conversation**, then **learns the answer** so it never has to escalate that question again.

Two capabilities, one loop. Precision is table stakes; the **escalation-that-teaches** loop is the differentiator and the reason this compounds instead of plateauing.

---

## 2. Who we're serving (and their emotional state)

| User | State | What "good" feels like |
|---|---|---|
| **Parent** | Anxious, deeply caring, on a phone, often off-hours | Fast, center-*specific*, obviously-trustworthy answer — or an honest "let me get a person on this" that doesn't feel like a dead end. |
| **Operator/Admin** (the buyer) | Busy SMB owner, no IT staff | Front-desk volume drops without quality dropping; a low-effort way to curate truth and see where the system struggled. |

The fictional center is an **independent SMB** (no chain, no IT). Everything should read as "works out of the box."

---

## 3. Focus decision (locked)

- **Depth + Novelty, unified.** A *small* set of intents handled extremely well, plus a first-class escalation → human-answer → knowledge-capture loop.
- **Balanced** investment across Parent (front desk) and Operator (control center) — justified because the escalation loop is the *shared spine* between them, so depth in one deepens the other.
- **No voice** in this iteration. Text chat + guided starters.
- **Trust is the product.** Every answer is grounded in the center's own policies and visibly attributable. When grounding is thin or the topic is sensitive → escalate, never guess.

---

## 4. The core loop (the thing everything serves)

```
Parent asks
    │
    ▼
[Ground] retrieve relevant center policy/knowledge
    │
    ├── confident + not sensitive ──▶ [Answer] grounded, attributed, warm  ──▶ deflected ✔
    │
    └── low grounding OR sensitive ──▶ [Relay] front desk stays in control:
                                       "checking with our team… one moment"
                                            │  (real-time, same thread, one voice)
                                            ▼
                            Staff answer relays into the parent chat, marked
                            "✓ From our team" (control center — live relay queue)
                                            │
                                            ▼
                                [Capture] if general, answer becomes new source of truth
                                            │
                                            ▼
                              next parent with that question is deflected ✔  (loop tightens)
```

**Why this is the bet:** it satisfies all three brief requirements at once — *specific trustworthy answers* (Answer), *handle uncertainty/sensitivity gracefully* (Escalate), and *improve over time* (Capture). The operator's "see what's asked / where it struggled" view is just the escalation queue made visible.

---

## 5. Intents in scope (depth targets)

Handled with real policy logic, edge cases, and attribution. These five are the **seeded defaults, not a closed enum** — `intent` is an open-ended token with no CHECK constraint, so operators can add their own categories; the five are where we invest depth:

1. **Hours & closures** — regular hours, holidays/closures, early-release, weather. (The "Are you open on Veterans Day?" class.)
2. **Tuition & fees** — rates by age group (the center serves four bands: infant/toddler/preschool/pre-K), deposits, late-pickup fees. Billing *disputes* are explicitly escalation, not answer.
3. **Sick-child / health policy** — illness exclusion criteria (fever thresholds, return rules). *Sensitive by design*: answer the **policy**, escalate anything that reads as diagnosis, an incident, or a specific child's medical situation.
4. **Meals & lunch** — what's provided, allergy handling, "I forgot lunch" logistics.
5. **Tours & enrollment** — how to schedule a tour, waitlist basics, what to bring.

**Everything outside these five is a valid input** — the system's job there is to escalate well, not to fake coverage. Breadth is handled *by the loop*, not by pretending to know.

---

## 6. Escalation & sensitivity model (the craft surface)

Escalation triggers (any one fires):
- **Low grounding** — retrieval confidence below threshold / no supporting policy.
- **Sensitive category** — safety/abuse, incidents, health specifics about a child, billing disputes, enrollment/grievance, anything legal/regulatory, custody/pickup-authorization. (The canonical `sensitive_category` set — safety, abuse, incident, health, custody, billing, enrollment, behavior, individual, grievance, legal — lives in [09 §4.1](09-plan-review-and-consistency.md).)
- **Individual / identity-specific** — questions about *a particular child or account* (custody, a child's individual plan) the front desk shouldn't answer without a human.

Graceful escalation here means **staff relay, not a handoff to another channel** ("resolve, don't relay"): the front desk stays one continuous voice, shares whatever general policy helps, and says it's checking with the team. When the center is **online** the staff answer arrives **in the same thread, in real time, marked as human-sourced**. When the center is **Away** (off-hours), the parent leaves a contact and the answer follows up **asynchronously by email** ([11 §4.3](11-admin-settings-provider-config-and-availability.md)) — no dead-end "leave your number and we'll call." No "I'm just a bot — let me get a human" switch (which erodes trust in the AI's answers and trains parents to demand a human first). The parent should feel *helped and still in one conversation*, never *rejected or transferred*. See [03-ux-flows.md](03-ux-flows.md) §3.3.

---

## 7. What's in scope

**Parent front desk**
- Mobile-first text chat with tappable guided starters for the 5 intents.
- Grounded answers with **visible attribution** ("per the handbook: …" / source chip).
- Live staff-relay UX (one voice, in-thread, provenance-marked — see [03 §3.3](03-ux-flows.md)).

**Operator control center**
- Edit the **source of truth** (the **Knowledge Base** — a small structured set of KnowledgeEntries).
- **Escalation queue** — the "where the system struggled" view; operator answers here.
- **Answer → knowledge capture** — resolving an escalation can promote the answer into the source of truth.
- Light **activity view** — what's being asked, deflected vs. escalated.

**Audit & quality (cross-cutting)**
- Every parent ↔ front-desk interaction produces a structured **audit record**.
- A **quality panel** measures answer trustworthiness (groundedness/attribution) *and* handoff quality (escalation precision/recall), rolling up to **admin hours saved**.
- Metrics are chosen to be **industry-defensible**, not invented — see [05-quality-audit-and-metrics.md](05-quality-audit-and-metrics.md).

**Grounding data**
- Small **structured** Knowledge Base (policy/schedule entries) for one invented center. Response quality > ingestion sophistication.

**Platform**
- Next.js on **Railway** (always-on container), mobile-first — see the stack review [08-architecture-and-stack-review.md](08-architecture-and-stack-review.md). **Provider-agnostic model interface** (thin hand-rolled abstraction) with **three concrete implementations behind it, neutral ids `anthropic` (default) | `openai` | `google`** — so we can A/B grounding and escalation behavior across providers, not just claim portability. See [04-grounding-and-prompts.md](04-grounding-and-prompts.md) §6.

---

## 8. What's explicitly out of scope (non-goals)

- Voice / telephony.
- Real auth, real parent accounts, real PII, real payments.
- Live document ingestion / PDF parsing pipelines (a handbook page is enough grounding).
- Multi-center / multi-tenant management, org hierarchy.
- Real-time SMS / push notifications — live escalations surface *in-app*. (Exception, now shipped: an **Away off-hours escalation** captures the parent's email and sends an **async email follow-up** with the staff answer — see [11 §4.3](11-admin-settings-provider-config-and-availability.md). Other channels remain out.)
- Production hardening: rate limiting, abuse, full accessibility audit, i18n. (Note: a *lightweight* audit log + computed quality metrics are **in** scope — see §7; only heavy analytics *infrastructure* is out.)
- Fine-tuning / training a model. Grounding is retrieval + prompt, not weights.

These are non-goals *for the prototype*; several are natural "what's next" talking points for the writeup.

---

## 9. How this maps to the evaluation axes

| Axis | How the bounds above earn it |
|---|---|
| **Scope & completeness** | Deliberately small intent set, both perspectives finished, one loop that closes end-to-end. |
| **Persuasiveness** | The escalation-that-teaches loop is a fundable insight: deflection **compounds**, ROI grows with use. |
| **User empathy** | Two opposite emotional states designed for explicitly; graceful live relay over confident-wrong. |
| **Uniqueness / craft** | Grounding+attribution, the human-in-the-loop capture mechanism, and an **industry-defensible quality/audit layer** — not a generic chatbot. |

---

## 10. Open questions to resolve in later stages (not now)

- Fictional center identity (name, location, age groups, exact schedule) — decided during **data-model** stage.
- Knowledge representation: structured policy records vs. handbook chunks vs. hybrid, and how retrieval + attribution work — **grounding-design** stage.
- Confidence/threshold mechanism for "low grounding" — **prompt/grounding** stage.
- Persistence for the demo (in-memory seed vs. lightweight store) so operator edits + escalation captures survive a session — **architecture** stage.
- Whether knowledge capture is one-click-promote vs. operator-edits-then-saves — **UX** stage.

---

## 11. Planning roadmap (artifacts in this folder)

- **00-scope-and-bounds.md** ← *this doc* — thesis, users, focus, the loop, in/out of scope, eval mapping.
- **01-data-and-knowledge-model.md** — center, KnowledgeEntry/Escalation/Conversation/Settings schema, grounding, attribution, persistence.
- **02-seed-source-and-policy-map.md** — real ABQ handbook → Little Acorns KnowledgeEntries + sensitive-topic taxonomy.
- **03-ux-flows.md** — parent chat + starters, live staff relay, operator relay queue + context-aware capture, quality panel, caution dial + provider toggle, mobile-first.
- **04-grounding-and-prompts.md** — single cached grounded call, escalation decision + inline verification safety net, prompts, model roles.
- **05-quality-audit-and-metrics.md** — audit record, industry-defensible metric framework, escalation-as-classifier.
- **06-build-sequence.md** — always-shippable milestones (M0–M7 + M2.5), MoSCoW, risk register, commands, demo script.
- **07-hallucination-guardrails-review.md** — guardrail/validation audit vs. 2026 industry standard; inline grounding gate + deterministic fact-check + golden eval.
- **08-architecture-and-stack-review.md** — stack rationale + alternatives; hosting=Railway, better-sqlite3, SSE, hand-rolled model layer (decided).
- **09-plan-review-and-consistency.md** — pre-build QA: contradictions/gaps found + resolved, canonical definitions (sensitive taxonomy, τ, decision_reason).
