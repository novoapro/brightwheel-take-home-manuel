# Quality, Audit & Metrics (Planning — cross-cutting)

**Purpose:** Define how every parent ↔ front-desk interaction is *audited*, and how we turn that audit trail into a **defensible measure of quality** — both the quality of the *answers the system gives* and the quality of the *handoffs to a human*. The metrics here are chosen to be recognizable and defensible to an evaluation panel (they map to established conversational-AI, RAG-evaluation, and customer-support standards), not invented for this demo.

**Status:** Draft · Date: 2026-09-22 · Depends on: [00-scope-and-bounds.md](00-scope-and-bounds.md)

---

## 1. Why this exists (the argument to a panel)

Two claims a funder will challenge:

1. **"How do you know the answers are trustworthy and not hallucinated?"** → We measure **groundedness / faithfulness** against the center's own sources, per the standard RAG-evaluation triad.
2. **"How do you know it hands off to a human at the right moments — and not too often to be useful, nor too rarely to be safe?"** → We treat answer-vs-escalate as a **binary classifier** and report its precision/recall with an explicit, *asymmetric* cost model appropriate to childcare.

Everything below serves those two claims, plus the business claim (**hours saved**) that justifies funding.

---

## 2. The audit record (what we log per interaction)

Every interaction produces one immutable, structured **audit record**. This is the atomic unit everything else is computed from. (Schema is finalized in the data-model stage; sketch here to lock the *shape*.)

```
InteractionAudit {
  id, session_id, timestamp
  parent_question            // raw text
  detected_intent            // one of the 5, or "out_of_scope"
  retrieval {
    sources: [{doc_id, snippet, score}]   // what grounding was found
    top_score, coverage_flag              // was grounding thin?
  }
  decision: "answered" | "escalated"
  decision_reason            // canonical set ([09 §4.4](09-plan-review-and-consistency.md)):
                             //   "grounded" | "fact_mismatch" | "low_groundedness" |
                             //   "below_threshold" | "sensitive:<category>" | "out_of_scope" | …
  confidence                 // model/self-reported grounding confidence
  provider                   // "anthropic" | "openai" | "google"  — which impl handled it (enables A/B)
  model                      // e.g. "claude-sonnet-5" | "gpt-5" | "gemini-flash-latest"
  response_text              // what the parent saw
  cited_sources: [doc_id]    // attribution actually shown
  latency { first_response_ms, human_response_ms? }
  // --- labels attached later, by humans or judge ---
  checks: {                  // inline guardrail results ([04 §3](04-grounding-and-prompts.md), [07](07-hallucination-guardrails-review.md))
    citation_valid, fact_match, groundedness_gate  // pass|fail|skipped
    // self_consistency      // future work — not implemented in v1
  }
  parent_feedback: "up" | "down" | null
  operator_disposition: {    // set when an operator reviews/answers
    escalation_was_appropriate: bool,
    answer_was_correct: bool | null,       // if it answered
    would_have_been_safe: bool | null,     // if it answered, was that safe?
    captured_to_kb: bool
  }
  judge_scores?: { groundedness, answer_relevancy }  // optional LLM-as-judge
}
```

**Key design point:** operators *label as a byproduct of their normal work*. When an operator resolves an escalation, they implicitly confirm "yes this needed a human" and, on capture, produce ground-truth. We get an evaluation dataset for free from the curation loop.

---

## 3. The metric framework (four tiers)

### Tier 1 — Operational (automatic, no labels needed)
The customer-support industry standards. Computed directly from audit records.

| Metric | Definition | Established as |
|---|---|---|
| **Containment / Deflection rate** | answered_without_handoff ÷ total | The headline chatbot/CS metric (Gartner, Zendesk, Intercom, Ada). |
| **Escalation rate** | escalated ÷ total | Inverse of containment. |
| **Coverage / knowledge-gap rate** | out_of_scope ÷ total | Where the handbook is missing. |
| **Time-to-first-response** | bot latency | Speed = parent-perceived quality. |
| **Time-to-staff-relay** | relay opened → staff answered in-thread | How fast the live relay resolves (parent is waiting). |
| **Repeat-question rate** | same intent asked again after a capture | Feeds the "loop tightens" claim. |

### Tier 2 — Answer quality / trust (needs judgment)
Directly measures "never hallucinate a policy." Maps to the **RAG-evaluation triad** (RAGAS / TruLens: *context relevance → groundedness → answer relevance*).

| Metric | Definition | Signal source |
|---|---|---|
| **Groundedness / Faithfulness** | share of answer claims supported by cited sources | LLM-as-judge (offline) + spot human check |
| **Answer relevancy** | does the answer address the question asked | judge / parent thumbs |
| **Hallucination rate** | 1 − groundedness (unsupported claims) | derived |
| **Attribution rate** | answers that showed a real source | automatic |
| **Fact-mismatch block rate** | answers blocked by deterministic fact-check ([04 §3c](04-grounding-and-prompts.md)) | automatic |
| **Judge–human agreement** | judge groundedness vs. operator disposition, on a sample | validates the judge ([07 §3](07-hallucination-guardrails-review.md)) |

### Tier 3 — Escalation-decision quality (the safety-critical tier)
Treat answer-vs-escalate as a **binary classifier** against the ground-truth "should this have been escalated?" (from operator disposition). Build the confusion matrix:

|  | **Should answer** | **Should escalate** |
|---|---|---|
| **System answered** | ✅ correct deflection | ❌ **Under-escalation (false negative)** |
| **System escalated** | ⚠️ Over-escalation (false positive) | ✅ correct handoff |

- **Under-escalation (FN)** = answered something it should have handed off. **This is the dangerous, trust-destroying error** — worst on sensitive intents (health/safety/billing). A confident wrong answer to "my child has a fever, can they come in?" is the failure mode we most refuse.
- **Over-escalation (FP)** = handed off something it could have answered. Costs a deflection and some admin time, but is **safe**.

Metrics:
- **Escalation recall** (a.k.a. sensitivity) — of everything that *should* escalate, how much did. **We optimize this near 1.0 for sensitive categories.**
- **Escalation precision** — of everything escalated, how much needed to.
- **Asymmetric cost stance (defensible position):** in a childcare/health context we **explicitly prefer over-escalation to under-escalation** and tune the threshold accordingly. This is the sentence that wins the panel — we made a values-driven, safety-first tradeoff and can prove we hit it.

### Tier 4 — Satisfaction & business outcome
| Metric | Definition | Established as |
|---|---|---|
| **CSAT** | thumbs up/down (or 1–5) post-interaction | Universal support metric |
| **First-Contact Resolution (FCR)** | resolved without follow-up | Universal support metric |
| **Capture rate** | escalations promoted into the knowledge base | Drives compounding deflection |
| **★ Admin hours saved / week** | deflected_count × avg_manual_handle_time | **The ROI north-star** — what the buyer funds. |

---

## 4. Where the labels come from (provenance)

Quality metrics need ground truth. Three sources, in increasing cost:

1. **Automatic** — Tier 1 entirely, attribution, latency. Free.
2. **Human-in-the-loop, zero extra effort** — operator disposition when resolving escalations, and parent thumbs. This is the primary label source and it *comes from the loop we're already building*.
3. **LLM-as-judge (optional depth)** — an offline evaluator scores groundedness/answer-relevancy at scale, so the system **audits itself**. Strong panel flex ("it self-evaluates"), but additive build cost — see decision in §6.

---

## 5. How it surfaces (product, not just a spreadsheet)

- **Operator control center** gains a **Quality panel**: containment vs. escalation trend, top knowledge gaps, escalation-decision health (the confusion-matrix cells), and the hours-saved number.
- The escalation queue *is* the audit trail made actionable — reviewing it is what generates labels.
- Everything stays lightweight (computed over the seed + session data), consistent with the prototype non-goals — **no heavy analytics infrastructure**, just honest metrics over the audit log.
- **Provider A/B (bonus):** since the audit record logs which model provider handled each interaction, the same metrics (containment, escalation precision/recall, groundedness) can be sliced **across configured providers** (Anthropic / OpenAI / Google) — making the provider-agnostic design ([04 §6.1](04-grounding-and-prompts.md)) something you can *measure*, not just assert.

---

## 6. Decisions — RESOLVED

1. **LLM-as-judge for groundedness:** ✅ **Included** — and promoted to an *inline gate* for sensitive/borderline plus an async measurement pass ([04 §3](04-grounding-and-prompts.md), [07](07-hallucination-guardrails-review.md)).
2. **Metrics surface:** ✅ **A tab within the control center** ([03 §4.1](03-ux-flows.md)) — one operator surface, no separate app.
3. **Seed the audit log with fabricated history:** ✅ **Yes** — a pre-seeded week so the dashboard and the compounding story render live in the demo (M5, [06](06-build-sequence.md)).

---

## 7. Panel one-liners (for the writeup)

- "We measure trust the way the RAG-evaluation literature does — **groundedness, answer-relevance, retrieval-relevance** — so 'don't hallucinate a policy' is a number, not a hope."
- "We treat escalation as a **classifier with asymmetric costs** and tune for **high recall on sensitive questions** — we'd rather over-escalate a fever question than ever answer one wrong."
- "Every human handoff **labels the system for free**, so our evaluation set and our knowledge base both grow with use — quality and coverage **compound**."
- "The whole thing rolls up to one number a busy owner cares about: **admin hours saved per week**."
