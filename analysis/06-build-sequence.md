# Build Sequence (Stage 6 — plan → shippable)

**Purpose:** Order everything into a build path that fits the 3-business-day timebox, stays **shippable at every step**, de-risks the differentiators first, and ends in a hosted URL + a <1-page writeup (or <2-min video).
**Status:** Plan close-out · Date: 2026-09-22
**Depends on:** all prior artifacts ([00](00-scope-and-bounds.md)–[05](05-quality-audit-and-metrics.md)); reviewed in [09](09-plan-review-and-consistency.md).

---

## 1. Build philosophy

- **Deploy on day one.** Push an empty app to Railway first; prove the hosted-URL pipeline before building features. The deliverable is a *hosted* prototype — never let deploy be the last risk.
- **Walking skeleton, then thicken.** Get one thin end-to-end slice (ask → grounded answer → deployed) working, then add depth. Every milestone leaves a deployable, demoable app.
- **Risk-first ordering.** The differentiators — grounded answer + escalation decision + **live relay loop** — come before polish, so the hard parts are proven early.
- **Claude-first, structured-only.** Sonnet 5 answerer, no embeddings, SQLite via better-sqlite3. The additional providers (OpenAI, Google) are a *later toggle*, not a blocker — Anthropic stays the default.
- **The loop is the money shot.** Prioritize the end-to-end compounding demo (ask → relay → staff answers → capture → same question now AI-answered) over breadth.

---

## 2. Milestones (each is shippable)

### M0 — Walking skeleton (deploy pipeline proven)  · MUST
- `create-next-app` (TS, App Router, Tailwind CSS — shadcn/ui was considered but not adopted), deploy to **Railway** (git-push, persistent volume attached) → **live URL**.
- better-sqlite3 wired to the volume; one table + a health-check page reading it.
- **Shippable state:** a deployed page that reads the DB from a durable disk. Deploy + persistence risk = zero from here.

### M1 — Data + seed (the source of truth exists)  · MUST
- Schema: `KnowledgeEntry`, `Escalation`, `InteractionAudit`, `Conversation`, `Message`, `Settings` ([01 §2](01-data-and-knowledge-model.md), [05](05-quality-audit-and-metrics.md)).
- Seed script writes the **Little Acorns policy set** from the handbook map ([02](02-seed-source-and-policy-map.md)) — real `structured` payloads (holiday calendar, tuition, illness thresholds, snow rules, meals, tours).
- **Shippable:** DB seeded; a raw JSON debug route lists policies.

### M2 — Grounding engine + inline guardrails (the trust core)  · MUST
- Provider-agnostic `FrontDeskModel` interface + **Claude impl** (Sonnet 5): cached system prefix (persona + center + policies), structured output ([04](04-grounding-and-prompts.md) §4).
- **Deterministic wrapper + inline verification** ([04 §3](04-grounding-and-prompts.md), [07](07-hallucination-guardrails-review.md)): policy=answer / case=escalate, citation validity, **deterministic fact verification** (numbers/dates ∈ cited record), τ thresholds, and the **inline groundedness gate** (Haiku; sensitive → ≥0.9). Any failure → **live staff relay**.
- **Shippable:** a POST endpoint returning `{decision, parent_message, citations, checks{…}}`; a wrong number can't reach a parent. Test against the [02 §4](02-seed-source-and-policy-map.md) showcases (Veterans Day, snow, fever, late pickup, lunch).

### M2.5 — Golden eval + regression suite (the validation mechanism)  · MUST
- **~60–120 case golden set** labeled with expected `{decision, intent, cited policy, key facts, sensitive?}` — showcases + paraphrases + **adversarial** (jailbreak, leading, out-of-scope) + every escalation category ([07 §3](07-hallucination-guardrails-review.md)).
- **Automated scorer**: groundedness/faithfulness, correct decision, **escalation precision/recall**, fact-accuracy (via the M2 checker), abstention correctness. Runs via `npm run eval`.
- **Judge-vs-human agreement** computed against operator dispositions.
- **Shippable:** `npm run eval` gates regressions on every prompt/model/**provider** change and is how we tune τ and compare Claude vs. Gemini. This is the panel's "how do you validate?" answer.

### M3 — Parent front desk (the polished centerpiece)  · MUST
- Chat UI + guided starters + grounded answer + **attribution chips** + 👍/👎 ([03](03-ux-flows.md) §3).
- Escalation → **relay-pending** state ("checking with our team…◐").
- Audit logging on every turn.
- **Shippable:** a real parent can ask the 5 intents and get grounded, attributed answers on a phone.

### M4 — Live relay + capture loop (the differentiator)  · MUST
- Operator `/admin` (mock passcode) → **live-relay queue**; staff reply **relays into the parent thread in real time** (SSE), marked `✓ From our team` ([03](03-ux-flows.md) §3.3, §4.2).
- **Capture:** general staff answer → one-tap promote to `KnowledgeEntry` (context-aware default off for case-specific).
- **Shippable:** the two-pane loop demo works end-to-end — the money shot.

### M5 — Operator curation + quality panel  · SHOULD
- Source-of-truth **editor** (list, edit prose + structured, publish/draft) ([03](03-ux-flows.md) §4.3).
- **Dashboard**: hours saved, containment vs. relay, groundedness, top gaps ([05](05-quality-audit-and-metrics.md)).
- Seed a **week of historical interactions** so the dashboard renders live.
- Derived **read-only handbook** view (attribution chips link here).
- **Shippable:** operator can curate the source of truth and see where the system struggled.

### M6 — Quality depth + settings  · SHOULD
- Async **Haiku groundedness judge** → `judge_scores` → dashboard.
- **Caution-level** setting (τ presets) + per-category sensitivity tiers incl. always-escalate ([04](04-grounding-and-prompts.md) §2, [01 §2.2b](01-data-and-knowledge-model.md)).
- **Shippable:** self-evaluating system + owner-tunable safety dial.

### M7 — Additional providers + polish  · COULD
- **OpenAI + Google impls** behind the interface (Anthropic stays default; Google via **Gemini Flash (`gemini-flash-latest` alias)**) + provider toggle + A/B slice in dashboard ([04](04-grounding-and-prompts.md) §6.1, [05](05-quality-audit-and-metrics.md), [11](11-admin-settings-provider-config-and-availability.md)).
- Mobile/warmth polish, empty/error states, accessibility pass, copy tuning.
- **Shippable:** provider-portability you can *see*; demo-ready finish.

---

## 3. MoSCoW summary

| Priority | Scope | Why |
|---|---|---|
| **MUST** (M0–M4, incl. M2.5) | Deploy, seed, grounding engine **+ inline guardrails + golden eval**, parent chat, **live relay + capture loop** | The fundable core: grounded trust, *verified* (guardrails + eval), plus the compounding differentiator, hosted. |
| **SHOULD** (M5–M6) | Curation editor, quality dashboard + seeded history, judge, caution dial | Proves the operator loop and the "measure trust" story ([05](05-quality-audit-and-metrics.md)). |
| **COULD** (M7) | Gemini toggle + A/B, deep polish | Strengthens portability/craft; safe to cut under time pressure. |

**If time runs short:** ship MUST + the dashboard from SHOULD (it carries the ROI pitch). Drop Gemini and the judge first — both are additive, not core.

---

## 4. Critical path & dependencies

```
M0 deploy ─▶ M1 data/seed ─▶ M2 grounding+guardrails ─▶ M2.5 golden eval ─▶ M3 parent chat ─▶ M4 live-relay loop ─▶ demo-ready
                                    │                        │                                    │
                                    └──────── M5 curation/quality ──────────────────────────────┘ (parallelizable after M2/M3)
                                                       │
                                                M6 judge + caution
                                                       │
                                                M7 Gemini + polish
```
M2 is the linchpin; **M2.5 rides on it** (the golden suite validates the guardrails and pins behavior before UI work). M5/M6 can begin once M2+M3 exist. M7 is fully optional and isolated behind the provider interface.

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| SQLite persistence | Low | **better-sqlite3 on a Railway volume** ([08](08-architecture-and-stack-review.md)) — durable disk on an always-on container; the Vercel ephemeral-FS problem is gone. |
| Real-time relay complexity | Low-Med | **SSE** on the always-on container — no polling, no 3rd-party realtime service. |
| Parent-facing latency | Med | Cache the prefix, Sonnet 5, low/med effort; judge is async ([04](04-grounding-and-prompts.md)). |
| Two providers eat the timebox | Med | Gemini is **COULD** (M7), fully isolated behind the interface. |
| Over-scoping breadth | Med | Depth on 5 intents + the loop; breadth handled *by* the loop, not faked. |
| Model mis-escalates | Low-Med | Deterministic wrapper + operator-owned always-escalate category tier ([04 §3](04-grounding-and-prompts.md)); measured by escalation recall ([05](05-quality-audit-and-metrics.md)). |

---

## 6. Tech stack & commands (to record in CLAUDE.md at scaffold)

**Stack (decided across stages; see [08](08-architecture-and-stack-review.md), [11](11-admin-settings-provider-config-and-availability.md)):** Next.js (App Router, TS) · **Tailwind CSS** (shadcn/ui was considered but not adopted) · **SQLite via better-sqlite3** (Railway persistent volume) · **Railway** hosting (always-on container) · three first-class LLM providers behind a hand-rolled provider seam — **`@anthropic-ai/sdk`** (Claude Sonnet 5 answerer, Haiku judge; default), **`openai`** (GPT-5 family, optional) and **`@google/genai`** (Gemini Flash, optional) · real-time via **SSE**.

**Intended commands** (finalize once scaffolded — the CLAUDE.md "Tech stack & commands" placeholder gets filled here):
```
npm run dev            # local dev
npm run build          # production build
npm run start          # run built app
npm run lint           # lint
npm run test           # unit tests (grounding wrapper, escalation gate, fact-checker)
npm run eval           # golden regression suite (groundedness, decision, escalation P/R, facts)
npm run db:migrate     # apply schema
npm run db:seed        # seed Little Acorns policies + historical interactions
git push (Railway)     # deploy to hosted URL (auto-build on push)
```
Env: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (GPT-5 family, optional provider), `GOOGLE_API_KEY` (Gemini, optional provider), `DATABASE_PATH` (points at the Railway volume), `ADMIN_PASSCODE`.

---

## 7. Demo script (the money shots)

The writeup/video should walk these, in order:
1. **Grounded trust** — "Open on Veterans Day?" → exact date + 📎 handbook chip. "It snowed — are you open?" → the delay/closure logic. (Deterministic, cited.)
2. **Depth/edge** — "What if I'm late picking up?" → $15 + 3-lates→conference. "I forgot lunch" → reassurance + meal info.
3. **The empathy + relay moment** — "My son had a fever last night, can he come in?" → states the 100.4°F/24h policy, then *"let me check with our team…"* → (operator pane) staff answers → it lands in the parent thread `✓ From our team`. One voice, real time.
4. **The compounding loop** — ask something not in the handbook ("Do you offer part-time?") → relay → operator answers **+ one-tap capture** → ask again → now the **AI answers it instantly**, cited. Deflection compounding, live.
5. **The owner's view** — dashboard: **hours saved**, containment vs. relay, groundedness, top gaps; the **caution dial**; (optional) **flip to Gemini** and compare.

---

## 8. Definition of done

- [ ] Hosted URL, mobile-friendly, both surfaces reachable (`/` + `/admin`).
- [ ] 5 intents answered grounded + cited; the [02 §4](02-seed-source-and-policy-map.md) showcases all work.
- [ ] Inline guardrails live (fact-check + groundedness gate); a wrong number/date is blocked → relayed, never shown.
- [ ] `npm run eval` green on the golden set; escalation recall on sensitive categories ≥ target.
- [ ] Live-relay loop demonstrable end-to-end, with capture compounding.
- [ ] Operator can edit the source of truth and see quality/struggles.
- [ ] <1-page writeup **or** <2-min video walking §7.
- [ ] CLAUDE.md "Tech stack & commands" filled in (§6).

---

## 9. Plan complete

All stages are drafted in `analysis/` (00–09) and cross-checked for consistency in [09](09-plan-review-and-consistency.md). The plan is internally consistent: scope → data → seed → grounding → quality → UX → build, with the escalation-that-teaches loop as the spine and "trust is the product" enforced from schema to prompt to UI. Ready to scaffold on approval.
