# Plan Review & Consistency Pass (Stage 9 — pre-build QA)

**Purpose:** Before writing code, cross-check all nine artifacts for contradictions, gaps, and correctness. Establish the canonical definitions that had drifted, and record what was fixed.
**Status:** Review · Date: 2026-09-22 · Method: read [00](00-scope-and-bounds.md)–[08](08-architecture-and-stack-review.md) fresh, cross-checked every key decision across docs.

---

## 1. Contradictions found → resolved

| # | Where | Contradiction | Resolution |
|---|---|---|---|
| C1 | [08](08-architecture-and-stack-review.md) §8 alignment table | "Persistence for the loop → **Turso** durable relational writes" — but Turso was dropped for better-sqlite3 | ✅ Fixed → better-sqlite3 |
| C2 | [00](00-scope-and-bounds.md) §11 roadmap | Lists a ghost **`02-architecture.md`** that doesn't exist; numbering off; 07/08 described by their *pre-decision* forks | ✅ Rewrote roadmap to the real 00–09 with current descriptions |
| C3 | [01](01-data-and-knowledge-model.md) §2.3 vs §8 | Escalation `status` is `waiting|answered|dismissed` in §2.3 but `open` in the §8 data-flow | ✅ Canonicalized to **`waiting`** everywhere |
| C4 | [04](04-grounding-and-prompts.md) §1 flow diagram | "escalated → **warm handoff + capture** → Escalation(**open**)" — pre-reframe (handoff/contact-capture) + wrong status | ✅ Rewrote to relay language, status `waiting`, no contact-capture |
| C5 | [03](03-ux-flows.md) §4.4 settings | Floor-lock says "**billing** always goes to a person" — but general tuition/fees *is* answerable; only billing **disputes** escalate | ✅ Changed to "billing **disputes**" |
| C6 | [06](06-build-sequence.md) §9 & header | "All **six** stages"; "Depends on 00–**05**" — there are 9 artifacts now | ✅ Updated to 00–09 / "all stages" |
| C7 | [07](07-hallucination-guardrails-review.md) §6 latency table | Lists **self-consistency** running for sensitive — but §8 marks it **deferred (P2, not built)** | ✅ Marked self-consistency "(deferred)" in the table |

## 2. Stale wording swept ("handoff/capture" → relay)

The escalation reframe (live staff relay, one voice, no contact-capture) left residue. Swept to relay language in: [00](00-scope-and-bounds.md) §1/§7/§9, [02](02-seed-source-and-policy-map.md) §3 ("hands off warmly"), [04](04-grounding-and-prompts.md) prompt ("hand off to a person"). Kept the *concept* of graceful escalation; removed "hand off to a human / capture contact" phrasings that contradict [03 §3.3](03-ux-flows.md).

---

## 3. Gaps / missing pieces → added

| # | Gap | Why it matters | Resolution |
|---|---|---|---|
| G1 | **Conversation & Message entities** absent from the data model | The live relay needs a thread the SSE stream writes into, linking parent session ↔ escalation ↔ streamed messages; multi-turn needs message history | ✅ Added `Conversation` + `Message` to [01 §2.5](01-data-and-knowledge-model.md) |
| G2 | **`Settings` entity** referenced ([06](06-build-sequence.md)/[08](08-architecture-and-stack-review.md)) but never defined | caution level + active provider are persisted, operator-editable | ✅ Added `Settings` to [01 §2.6](01-data-and-knowledge-model.md) |
| G3 | **`SENSITIVE_INTENTS` undefined** (used in [04 §3](04-grounding-and-prompts.md) code) | The τ=0.9 branch depends on it; ambiguous which of the 5 intents count | ✅ Defined (§4 below); pinned in [04](04-grounding-and-prompts.md) |
| G4 | **Sensitive-category taxonomy diverged** between [02 §3](02-seed-source-and-policy-map.md) and [04](04-grounding-and-prompts.md) (enum + HARD_SENSITIVE) | The escalation logic keys off it; two lists = bugs | ✅ One canonical list (§4 below), referenced by both |
| G5 | **`decision_reason` vocabulary diverged** across [01](01-data-and-knowledge-model.md)/[04](04-grounding-and-prompts.md)/[05](05-quality-audit-and-metrics.md) | Metrics group by reason; inconsistent strings break grouping | ✅ Canonical reason set (§4 below) |
| G6 | **Pipeline mismatch:** [01 §3](01-data-and-knowledge-model.md) describes classify→filter→retrieve; [04 §1](04-grounding-and-prompts.md) says *all policies in the cached prefix, single call* | Two different runtime designs | ✅ [01 §3](01-data-and-knowledge-model.md) noted: v1 = all-policies-cached (per 04); classify/filter is the scale-up path |

---

## 4. Canonical definitions (single source of truth — end the drift)

### 4.1 `sensitive_category` (the one list both [02](02-seed-source-and-policy-map.md) and [04](04-grounding-and-prompts.md) use)
```
safety     — child safety, emergencies, missing child, lock-down
abuse      — suspected abuse/neglect (mandatory report; never confidential)
incident   — injuries, accidents, hospitalization
health     — a specific child's medical / allergy / medication judgment
custody    — custody, pickup authorization, restraining orders
billing    — billing disputes, fees in arrears
enrollment — disenrollment / termination
behavior   — behavioral concerns / expulsion risk for a specific child
individual — special-needs / IFSP / IEP / toilet-learning plans
grievance  — complaints about staff
legal      — legal / regulatory matters
```
Plus the cross-cutting flag `pii` (identity-specific about a particular child/account).

### 4.2 `HARD_SENSITIVE` (always escalate, floor-locked — never operator-lowered)
```
{ safety, abuse, incident, custody, legal }
```
(missing-child folds into `safety`; restraining-order into `custody`.) Everything else in 4.1 escalates via the **case-specific** rule (sensitive_category + is_case_specific), not a hard floor — so *general* fee/enrollment/behavior *policy* stays answerable, while the *specific case* relays.

### 4.3 `SENSITIVE_INTENTS` (of the 5, which carry the higher τ=0.9)
```
{ health }
```
Only `health` is intrinsically sensitive as an *intent*. `tuition` is answerable in general; its billing-dispute subcase is caught by `sensitive_category=billing` + case-specific, **not** by making the whole intent sensitive. All non-health sensitivity flows through `sensitive_category`, independent of intent.

### 4.4 `decision_reason` (canonical set logged on every interaction)
```
answered:  "grounded"
relayed:   "no_citation" | "invalid_citation" | "fact_mismatch" |
           "below_threshold" | "low_groundedness" |
           "sensitive:<category>" | "sensitive:case_specific" | "out_of_scope"
```
Matches the [04 §3](04-grounding-and-prompts.md) wrapper exactly; [01](01-data-and-knowledge-model.md)/[05](05-quality-audit-and-metrics.md) reference this set.

---

## 5. Correctness notes (correct, but flag for the build)

| # | Note |
|---|---|
| N1 | **Deterministic fact-check needs a normalizer.** `source.contains(f)` ([04 §3c](04-grounding-and-prompts.md)) must normalize before comparing — `$1,650`↔`1650`, `Nov 11`↔`2026-11-11`, `100.4°F`↔`100.4`. Build a small `normalizeFact()` or it will false-positive-block. Tracked as a build task. |
| N2 | **Cache invalidation on policy edits is expected.** Operator edits/captures change the cached policy prefix → next request re-warms the cache. Correct behavior; just don't expect a cache hit immediately after a curation edit. |
| N3 | **Audit `retrieval` block** ([05 §2](05-quality-audit-and-metrics.md)) assumes scored retrieval; v1 passes all policies and logs *cited* records instead. Kept the field for the deferred retrieval layer; in v1 `cited_sources` is the real signal. Acceptable — noted. |
| N4 | **`embedding` column type.** In SQLite it's a nullable BLOB (not pgvector's `vector(1536)`); the doc's `vector(1536)` is illustrative of the deferred target. Reserved/unpopulated in v1. Acceptable — noted. |
| N5 | **Tour-request contact capture is fine** and not in tension with "no contact-capture on escalation" — a tour request is a legitimate lead form, a *task*, not an uncertainty handoff. |

---

## 6. Consistency matrix (post-fix)

| Key decision | Docs referencing | Consistent? |
|---|---|---|
| Hosting = Railway | 00, 01, 03, 06, 08 | ✅ |
| Persistence = better-sqlite3 (volume) | 01, 06, 08 | ✅ (after C1) |
| Real-time = SSE | 03, 06, 08 | ✅ |
| Model layer = hand-rolled, three providers (Anthropic + OpenAI + Google) | 00, 04, 06, 08, 11 | ✅ |
| Escalation = live staff relay (one voice) | 00, 02, 03, 04, 05 | ✅ (after C4/§2 sweep) |
| Answerer Sonnet 5 / judge Haiku | 04, 05, 06, 08 | ✅ |
| 5 intents | 00, 02, 03, 04 | ✅ |
| Sensitive taxonomy / HARD_SENSITIVE / τ | 02, 03, 04 | ✅ (after §4) |
| Inline guardrails + golden eval | 04, 05, 06, 07 | ✅ |
| Structured-only v1 (embeddings deferred) | 01, 02, 08 | ✅ |

---

## 7. Verdict

After the fixes above, the nine artifacts are internally consistent and the design is buildable. No open contradiction blocks scaffolding. The remaining items are **build-time tasks** (N1 normalizer) and **acceptable deferrals** (N3/N4), not plan defects. **Ready to build.**
