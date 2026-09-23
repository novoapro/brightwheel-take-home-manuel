# Data & Knowledge Model (Planning Stage 2 — first proposal to iterate)

**Purpose:** Design how the center's source of truth is *represented, grounded, retrieved, attributed, and persisted* — using the current best-known-to-work RAG patterns, right-sized to this system's actual needs.
**Status:** First proposal · Date: 2026-09-22 · Depends on: [00-scope-and-bounds.md](00-scope-and-bounds.md), [05-quality-audit-and-metrics.md](05-quality-audit-and-metrics.md)

> This is a **proposal to iterate on**, not a final spec. §10 lists the open forks.

---

## 1. Research-grounded principles (the "why," so it's defensible)

| Principle | What the current literature says | Our consequence |
|---|---|---|
| **Right-size retrieval to the corpus** | For a small, stable KB (< ~200K tokens), full-context + **prompt caching** often beats retrieval infra; where retrieval helps, the winner is *hybrid* (retrieve a subset → reason over it). | Our handbook is tiny. We don't need heavyweight vector RAG for the 5 core intents — we need **structured grounding + caching**, with retrieval as a lean pre-filter. |
| **Chunking is the #1 RAG failure mode** | Contextual Retrieval exists to re-inject context lost by chunking (−49% failures, −67% w/ reranking). | We **avoid chunking**: the source of truth is **atomic, self-contained policy records**, each independently citable. We get contextual-retrieval's benefit by construction. |
| **Citation precision ≠ vector similarity** | The classic failure is "right concept, wrong citation." Exact-match / full-text anchors citations reliably. | Attribution is anchored to **structured record IDs**, not vector neighbors. A cited policy is *the* policy, verbatim. |
| **Hybrid + RRF when you do retrieve** | BM25 (exact terms) + dense (semantics), fused by **Reciprocal Rank Fusion** (rank-based, scale-safe), optional reranker. | Available as the retrieval layer, but see next row for where it actually earns its cost. |
| **Spend the fancy technique where it pays** | Semantic search shines on open-ended matching, not on a fixed known set. | **Embeddings earn their keep on the escalation side** — dedupe/cluster unknown questions, match a new question to a *previously-captured* answer. Core intents use deterministic structured retrieval. |

Sources: [Anthropic — Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) · [RAG vs Long Context 2026](https://tianpan.co/blog/2026-04-09-long-context-vs-rag-production-decision-framework) · [Hybrid search + RRF reference 2026](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026) · [Citations/grounding](https://medium.com/@richardhightower/stop-the-hallucinations-hybrid-retrieval-with-bm25-pgvector-embedding-rerank-llm-rubric-rerank-895d8f7c7242) · [Best DB for Next.js 2026](https://layerbase.com/blog/best-database-for-nextjs-vercel)

**One-sentence thesis:** *A small, structured, atomic source of truth — grounded with caching + lightweight hybrid retrieval, cited by ID, with embeddings reserved for the escalation/curation loop.*

---

## 2. The knowledge model

Everything is built from a few atomic entities. The **KnowledgeEntry is the source of truth** — the citable unit, persisted in the `knowledge_entries` table. The **parent-facing Knowledge Base is a read-only view *derived from* KnowledgeEntries** (DECIDED), so there is exactly one source of truth and the "per the Knowledge Base" trust cue can't drift from what the assistant cites.

### 2.1 `Center` (one row for the fictional center — invented below)
Identity + globally-relevant facts the assistant always needs: name, location, phone, age groups served, general hours, timezone, tone/persona notes. Small enough to always include in context.

Plus per-center **brand / white-label** fields (see [10 §4](10-front-desk-rebrand-and-theming.md)): `display_name`, `brand_color` (default `#6c4ee8` — the Brightwheel accent; Little Acorns seeds `#4f7a5b`), `logo` (data URI), `welcome_message`.

**Invented center (v1 seed):**
> **Little Acorns Early Learning Center** — a single-location, owner-operated independent center in **Albuquerque, NM** (ties loosely to the brief's Albuquerque handbook reference; all data fictional). ~60 children, no IT staff — the archetype SMB the AI Front Desk is "out-of-the-box" for.
> - **Hours:** Mon–Fri 7:00 AM – 6:00 PM (timezone America/Denver).
> - **Age groups:** Infant (6 wks–12 mo), Toddler (1–2 yr), Preschool (3–4 yr), Pre-K (4–5 yr).
> - **Persona/voice:** warm, plain-spoken, reassuring — a caring front-desk lead, never a cold IVR.
>
> Exact schedules, tuition numbers, holiday calendar, illness thresholds, and lunch menu are authored as KnowledgeEntries during the seed stage.

### 2.2 `KnowledgeEntry` — the atomic, citable source of truth
Each record answers one coherent thing, self-contained (no chunking needed).

```
KnowledgeEntry {
  id                 // stable, human-readable e.g. "hours.holidays.2026"
  intent             // open-ended token; hours | tuition | health | meals | tours
                     //   are seeded defaults, NOT an enum — no CHECK constraint;
                     //   operators add their own categories
  title              // "2026 Holiday Closures"
  body_md            // the authoritative prose, parent-friendly
  structured         // typed payload for logic, e.g.
                     //   hours: {mon:"7:00-18:00", ...}
                     //   closures: [{date:"2026-11-11", name:"Veterans Day"}]
                     //   tuition: [{group:"infant", monthly:1650, ...}]
                     //   illness: {fever_f:100.4, return_rule:"24h fever-free"}
  keywords           // for BM25 / exact-match anchoring
  sensitivity        // none | sensitive  (drives escalation, per §00 §6)
  effective_from/to  // time-awareness ("open on Veterans Day?")
  source             // "Family Handbook p.4" — shown in attribution
  status             // published | draft | unpublished
                     //   (unpublished = complete but withdrawn from service)
  origin             // seed | captured   (captured = born from an escalation)
  version, updated_by, updated_at
  embedding          // vector(1536) — nullable; used for semantic matching
}
```

**Why `structured` alongside `body_md`:** prose is what the parent reads; the typed payload is what *policy logic* runs on (e.g. "is 2026-11-11 a closure?", "infant tuition?"). This is what lets us handle edge cases deterministically instead of hoping the model reads a paragraph correctly — the depth the brief rewards.

### 2.3 `Escalation` — an unknown/sensitive question relayed to staff
```
Escalation {
  id, interaction_id, question, detected_intent|"out_of_scope",
  reason (canonical decision_reason set — see [09 §4.4](09-plan-review-and-consistency.md)), status (waiting|answered|dismissed),
  operator_answer, answered_by, answered_at,   // relayed into the parent thread
  delivery ('live'|'email'), contact_name, contact_email, delivered_at,
                         //   'live' = staff answers in real time; 'email' = Away
                         //   off-hours follow-up sent to contact_email (see [11 §4.3](11-admin-settings-provider-config-and-availability.md))
  promoted_entry_id      // set when the answer becomes a KnowledgeEntry (capture)
  question_embedding     // to dedupe/cluster incoming unknowns
}
```
When the center is **online**, the staff answer relays into the same parent conversation in real time (one voice — see [03 §3.3](03-ux-flows.md)). When **Away** (off-hours), the parent leaves a contact and the answer follows up **asynchronously by email** ([11 §4.3](11-admin-settings-provider-config-and-availability.md)) — the deferred path added after the original live-only design.

### 2.3b Message provenance
Every assistant-side chat message carries `provenance: "grounded" | "staff"` — `grounded` = AI answered from cited KnowledgeEntries (📎), `staff` = a person answered/confirmed in real time (👤). This is the trust spine of the parent UI and lets metrics ([05](05-quality-audit-and-metrics.md)) distinguish AI-deflected from staff-answered.

### 2.4 `InteractionAudit` — every parent turn (from Stage 05)
The immutable log defined in [05-quality-audit-and-metrics.md](05-quality-audit-and-metrics.md) §2. It **records cited entry IDs as a JSON array (`cited_sources`) — not a foreign key**; the only real FKs are `conversation_id` and `Escalation.interaction_id`, which FKs back to the audit row. This is what all metrics compute over.

### 2.5 `Conversation` & `Message` — the chat thread (powers the live relay)
The parent chat is multi-turn, and the SSE relay must write a staff answer **into a specific thread**. So we persist the thread:
```
Conversation { id, session_id, started_at, active_provider }
Message {
  id, conversation_id, role: "parent" | "frontdesk",
  provenance: "grounded" | "staff" | null,   // §2.3b; null for parent messages
  text, citations: [policy_id],              // for grounded messages
  escalation_id?,                            // links a relay-pending/staff message
  created_at
}
```
- Each parent turn → a `parent` Message + a `frontdesk` Message (grounded answer *or* the relay holding message), and one `InteractionAudit`.
- A staff relay reply is appended as a `frontdesk` Message with `provenance:"staff"` and the `escalation_id`; the conversation's **SSE stream pushes it to the parent** ([03 §3.3](03-ux-flows.md)).
- `Escalation.interaction_id` → the audit row; the audit row → its `conversation_id`, so the relay knows which thread to stream into.

### 2.6 `Settings` — operator-controlled, single row
```
Settings {
  caution_level: "cautious" | "balanced" | "lean",         // → τ presets ([04 §2](04-grounding-and-prompts.md))
  active_provider: "anthropic" | "openai" | "google",      // three providers, neutral ids; default "anthropic" ([11 §3](11-admin-settings-provider-config-and-availability.md))
  availability: "online" | "away",                         // presence — drives live relay vs. email follow-up ([11 §4](11-admin-settings-provider-config-and-availability.md))
  operator_name,                                           // durable real-name attribution for relay + KB edits
  away_message,                                            // shown to parents while Away
  offline_at                                               // when the center went Away
}
```
HARD_SENSITIVE floor-lock is **not** part of Settings — it is code-fixed and cannot be tuned down.

### 2.7 `provider_credentials` — per-provider key + model config (see [11 §3.6](11-admin-settings-provider-config-and-availability.md))
One row per provider (`anthropic` | `openai` | `google`) holding an **AES-256-GCM-encrypted API key**, the chosen **answerer** and **judge** model ids, and a **validity** flag (whether the key last verified OK). `Settings.active_provider` points at whichever row is live.

### 2.8 `parent_sessions` — persisted parent identity (see [11 §6](11-admin-settings-provider-config-and-availability.md))
Persists a returning parent's identity **keyed by email**, linked to a `conversation_id`, with `status` (`open` | `closed`) and `closed_reason` (`agent` | `inactivity` | `parent`). Sessions auto-close after **30 minutes of inactivity**.

### Entity relationships
```
Center 1─┐
         └─* KnowledgeEntry ─cited_by─* InteractionAudit *─raises─0..1 Escalation
                    ▲                                                   │
                    └──────────────── promoted_to (capture) ───────────┘
```
The loop is literally an edge in the schema: an `Escalation.operator_answer` becomes a new `KnowledgeEntry(origin="captured")`, which then gets `cited_by` future interactions. **The compounding-deflection story is a foreign key.**

---

## 3. Grounding & retrieval pipeline

> **v1 reality (per [04 §1](04-grounding-and-prompts.md)):** because the corpus is tiny (~15–25 records), v1 **skips separate classify + retrieve** and passes **all published policies in the prompt-cached prefix**, doing grounding in **one call**. The classify → structured-filter → keyword-rank pipeline below is the **scale-up path** for when the corpus outgrows a single cached prefix. Kept here as the design that generalizes.

Deterministic-first, semantic-assist. For a parent question (scale-up form):

```
1. Classify intent  → one of the 5, or out_of_scope   (cheap model call / rules)
2. Candidate select:
     a. Structured filter: KnowledgeEntries WHERE intent = X AND status=published
        AND (effective window covers "now")           ← deterministic, exact  [v1]
     b. Keyword rank within candidates: SQLite FTS5 (BM25) on keywords/body
                                                       ← only if >N candidates [v1]
     c. [DEFERRED] add vector(embedding) + RRF fusion + reranker  ← migration step
3. Ground: pass the (few) candidate records + Center facts into the model,
   with the stable prefix (persona + Center + published policies) PROMPT-CACHED
4. Answer or escalate (grounding-confidence + sensitivity gate — Stage 04)
5. Attribution: cite the KnowledgeEntry.id(s) the answer used → render source chip
6. Log InteractionAudit (+ Escalation if raised)
```

**Why this shape:**
- Steps 1–2a are **deterministic and time-aware** — they're what correctly answers "open on Veterans Day?" by *checking a date against a closures array*, not by vibes.
- Step 2b keyword ranking uses **SQLite FTS5**, which provides **BM25 natively** — exact-term precision (the citation-anchoring win) with zero extra dependency. Only matters when an intent has many records; at seed scale it's often a no-op, which is fine.
- Step 2c (**vector + RRF + reranker**) is **deferred** — the honest, scalable design, documented as the migration step, built only if time allows.
- Step 3's **prompt caching** is the performance lever the research points to for a small stable corpus: the persona + center + policy prefix is stable across every parent, so cache it and pay only for the question.
- **Embeddings** (`KnowledgeEntry.embedding`, `Escalation.question_embedding`) would power the *curation* side — cluster top gaps, dedupe repeat unknowns, check for near-duplicate policies on capture. **Reserved in schema, unpopulated in v1;** in v1 the curation view uses intent + keyword grouping instead.

---

## 4. Attribution model (trust is the product)

- Every answer carries **explicit citations to KnowledgeEntry ids**, surfaced as a "per the handbook: … (Family Handbook p.4)" chip.
- Because citations are record IDs, they are **verifiable and exact** — we can render the *actual* source text, not a paraphrase.
- **No citation ⇒ no confident answer.** If the model can't ground a claim in a cited record, that's a low-grounding signal → escalate. This wires the "never hallucinate a policy" rule directly to the data model.

---

## 5. Persistence — DECIDED: SQLite (better-sqlite3), structured-only for v1

**Decision:** a **SQLite** relational store — no vector DB, no Postgres service — sized to a scrappy, right-sized PoC (defended on *timebox + "less-is-more"*, not on a brief mandate; the brief only asks for a working PoC within the timebox). We can state the migration path (→ Postgres/pgvector) if scale demands it.

**Driver/hosting — settled by the Railway hosting decision ([08](08-architecture-and-stack-review.md)):**
- ✅ **`better-sqlite3` on a Railway persistent volume.** One local SQLite file, real FKs, durable writes — the simplest possible option. The always-on container has a real disk, so the earlier "Vercel ephemeral FS" problem is gone, and we no longer need Turso/libSQL.
- The "migratable as we scale" story is unchanged: SQLite → Postgres/pgvector when scale demands (named migration target).

**Relational integrity is why SQLite, not JSON/in-memory:** policies, escalations, audit log, and the **capture edge** are relational and must persist for the loop to demonstrably compound. SQLite gives us real FKs and durable writes with essentially one dependency.

**Vectors: deferred (structured-only v1).** The `embedding` columns stay in the schema as **reserved/nullable but unpopulated** in v1. Semantic retrieval (hybrid/RRF) and the embeddings-powered curation layer are a **documented next step**, not built now — structured grounding already demos the entire loop.

*Not chosen:* Neon/Postgres + pgvector (correct at scale, but more infra than a timeboxed PoC needs — named as the migration target); dedicated vector DBs (Pinecone/Qdrant/Weaviate) — overkill, extra service, no relational integrity for the loop.

---

## 6. Seed dataset plan (the fictional center)

- **One invented independent center** — Little Acorns Early Learning Center, Albuquerque NM (§2.1).
- **~15–25 KnowledgeEntries** across the 5 intents, each with real `structured` payloads (a holiday calendar, a tuition table, illness thresholds, a lunch menu + allergy policy, a tour process).
- **A seeded week of `InteractionAudit`** + a few open/answered `Escalations`, so the operator dashboard and metrics (Stage 05) render live and the "loop tightens" story is visible immediately.
- **Grounded in the real Albuquerque handbook**, adapted (not copied) into Little Acorns — the concrete policy facts, structured payloads, and sensitive-topic taxonomy are mapped in [02-seed-source-and-policy-map.md](02-seed-source-and-policy-map.md).

---

## 7. How this satisfies the earlier stages

- **Trust/grounding (§00):** atomic records + ID-anchored citations + "no citation → escalate."
- **Escalation loop (§00 §4):** the capture edge is a first-class FK; embeddings dedupe/cluster the queue.
- **Quality/audit (§05):** `InteractionAudit` is the atomic log; groundedness is checkable because citations are exact record IDs.
- **Depth over breadth (§00 §3):** `structured` payloads enable *deterministic policy logic* (dates, prices, thresholds) — the edge-case handling the brief rewards.

---

## 8. Data-flow of the compounding loop (in data terms)

```
parent asks unknown Q
  └─ InteractionAudit{decision: escalated} ─raises→ Escalation{status: waiting}
        └─ staff answers (relayed live) → Escalation{status: answered, operator_answer}
              └─ promote     → KnowledgeEntry{origin: captured}   (embedding deferred in v1)
                    └─ next similar Q → structured retrieval HITS it
                          └─ InteractionAudit{decision: answered, cites captured record}
                                → containment ↑, gap ↓   (measured in Stage 05)
```

---

## 9. Tech implications forwarded to Stage 03/04/06

- Model layer stays **provider-agnostic** (Stage 00): intent-classify + ground+answer + (optional) LLM-judge all go through one interface; Claude is the default impl.
- **No embedding provider in v1** (structured-only). If the deferred vector layer is built later, its embedding provider sits behind the same abstraction (Voyage/Gemini rated best in research).
- Data access via **better-sqlite3** behind a thin repository layer, so a later swap to Postgres/pgvector touches one module.

---

## 10. Decisions & remaining forks

**Decided this iteration:**
1. **Persistence:** ✅ **SQLite via better-sqlite3** on a Railway persistent volume (one local file; [08](08-architecture-and-stack-review.md)). Migration target named: Postgres/pgvector.
2. **Embeddings:** ✅ **Structured-only for v1.** `embedding` columns reserved but unpopulated; FTS5/BM25 covers keyword ranking; vector+RRF is the documented migration step.
3. **Handbook:** ✅ **Derived read-only view from KnowledgeEntries** — single source of truth.
4. **Center identity:** ✅ **Little Acorns Early Learning Center, Albuquerque NM** (see §2.1). Exact numbers authored at seed stage.

**Still open (later stages):**
5. **Intent classification:** LLM call vs. lightweight rules/keywords for the 5 intents — resolve in Stage 04 (leaning LLM for robustness, cached).
6. **Embedding provider/dim** — only relevant if/when we build the deferred vector layer (Voyage/Gemini rated best in research). Schema reserves an unpopulated `embedding` blob.
7. ~~libSQL vs. better-sqlite3~~ — ✅ resolved: **better-sqlite3 on Railway** ([08](08-architecture-and-stack-review.md)).
