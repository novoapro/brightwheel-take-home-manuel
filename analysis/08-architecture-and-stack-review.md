# Architecture & Stack Review (Stage 8, cross-cutting)

**Purpose:** Consolidate the stack decisions made across stages, state the *why* for each, study real alternatives, and surface the genuine forks worth deciding before code.
**Status:** Review · Date: 2026-09-22 · Reviews the stack in [06 §6](06-build-sequence.md).

---

## 1. Decision criteria (from the plan's own constraints)

Every choice is judged against these — not fashion:
1. **Timebox + PoC** — 3 days; working proof of concept, not production.
2. **Hosted URL, trivially** — the deliverable is a *hosted* prototype.
3. **Mobile-first web** — parents on phones.
4. **Less-is-more / minimal deps** — scrappy, right-sized ([00](00-scope-and-bounds.md)).
5. **Model-agnostic** — two providers (Claude default, Gemini test) behind one interface.
6. **Persistence for the compounding loop** — operator edits + captures must survive.
7. **Real-time live relay** — staff answers appear in the parent thread ([03 §3.3](03-ux-flows.md)).
8. **Defensible** — mainstream, explainable choices a panel respects.

---

## 2. Stack at a glance

| Layer | Choice | Why (1-line) | Main alternatives | Verdict |
|---|---|---|---|---|
| Framework | **Next.js (App Router, TS)** | Best-supported React meta-framework; SSR + API in one; runs as a Node server on Railway | React Router 7 (Remix), SvelteKit, Vite SPA + Hono/Express | ✅ Keep |
| Hosting | **Railway (container, always-on)** | Persistent volume + long-lived processes fit our two stateful needs; git-push DX | Render, Fly.io, Vercel (serverless) | ✅ **DECIDED** |
| Persistence | **SQLite via better-sqlite3** (on a Railway volume) | Simplest possible: one local file, real FKs, durable on a persistent disk; ~1 dep, migratable | Turso/libSQL (needed only on serverless), Cloudflare D1, Neon+pgvector | ✅ **DECIDED** — Turso no longer needed |
| Model layer | **hand-rolled provider-agnostic interface** → Claude + Gemini | Full control + provider-specific features (Anthropic caching, thinking); matches `claude-api` guidance | Vercel AI SDK (unified but coarser control), LangChain/LlamaIndex | ✅ **DECIDED** |
| LLM SDKs | `@anthropic-ai/sdk`, `@google/genai` | Official, full provider features (caching, structured output) | Vercel AI SDK wrappers | ✅ Keep |
| Real-time | **SSE (server-sent events)** | Always-on container can hold the stream; clean one-way relay (server→parent), the differentiator | Polling, WebSockets, Ably/Convex/Supabase Realtime | ✅ **DECIDED** — polling dropped |
| UI/styling | **Tailwind (+ shadcn/ui)** | Fast, accessible, own-your-components, warm design | MUI, Chakra, plain CSS | ✅ Keep (add shadcn/ui) |
| Vectors/RAG | **none (structured-only)** | Tiny corpus; deterministic grounding beats vector RAG here ([01](01-data-and-knowledge-model.md)) | pgvector, Pinecone, LangChain RAG | ✅ Keep (deferred) |
| Auth | **mock passcode** | Not a real product; auth is a non-goal | NextAuth/Clerk | ✅ Keep |
| Validation | **golden eval + inline guardrails** | Own the trust proof ([07](07-hallucination-guardrails-review.md)) | RAGAS/DeepEval/Patronus as drop-ins | ✅ Keep, tools as future |

_Sources for the fast-moving layers:_ [Vercel realtime limits](https://ably.com/vercel/websockets-on-vercel) · [WS vs SSE vs polling 2026](https://pristren.com/blog/websockets-sse-polling-guide/) · [SQLite edge 2026](https://www.sitepoint.com/sqlite-edge-production-readiness-2026/) · [Turso vs Cloudflare](https://www.buildmvpfast.com/compare/turso-vs-cloudflare) · [Next.js hosting 2026](https://dev.to/nayankyada/nextjs-hosting-cost-in-2026-vercel-vs-netlify-vs-railway-vs-vps-431a)

---

## 3. Deep dive — the settled choices

### 3.1 Framework: Next.js ✅
- **Why:** one codebase for the mobile-first UI *and* the server logic (route handlers/server actions calling the LLM); RSC keeps the client light; the largest ecosystem; and it's the credible, mainstream pick for an interview deliverable.
- **Alternatives:** *React Router 7 (Remix)* — excellent, but less Vercel-default and smaller mindshare. *SvelteKit* — lighter/faster runtime but smaller ecosystem and a bet on team familiarity. *Vite SPA + Hono API* — simplest mental model, but you hand-build routing/SSR/deploy plumbing we'd get free.
- **Verdict:** Keep. Running Next as a long-lived Node process on Railway (not serverless) is what lets us hold the SSE relay open (§3.3).

### 3.2 Persistence: SQLite via better-sqlite3 (on a Railway volume) ✅
- **Why:** the compounding loop needs *durable, relational* writes; SQLite gives real FKs with ~1 dependency. On Railway's **persistent volume** it's just **one local file** — the simplest option, no hosted DB service at all. (`better-sqlite3` is synchronous and fast — ideal for a single-container app.) The "scrappy, migratable" framing holds: SQLite now, Postgres later.
- **Alternatives studied:**
  - *libSQL/Turso* — the right choice **only if we'd stayed on serverless** (Vercel's ephemeral FS); moot on a container with a real disk. One fewer dependency by dropping it.
  - *Cloudflare D1* — GA, global replicas, but pulls the app toward Cloudflare Workers; not our host.
  - *Neon/Postgres + pgvector* — the right call *at scale* and for real vector search, but more infra than a timeboxed PoC needs; our named migration target.
- **Verdict:** better-sqlite3 on a Railway volume.

### 3.3 Real-time relay: SSE on the always-on container ✅
- **Why:** the live relay is a *cross-request* channel (operator writes → parent reads). On a **Railway always-on container** the process can **hold an SSE stream open** — clean, one-way (server→parent), no polling, no third-party service. This is the natural fit once we're off serverless. (On Vercel this wasn't possible — functions can't hold long-lived connections, which is why the earlier plan used polling.)
- **Alternatives:** *Polling* — the serverless-era fallback; simple but chattier and higher-latency, unnecessary now. *WebSockets* — bidirectional; overkill for a one-way relay. *Managed realtime (Ably, Convex, Supabase Realtime, Pusher)* — the answer at scale/multi-instance, adds a service we don't need for one container.
- **Verdict:** SSE; managed-realtime is the multi-instance upgrade.

### 3.4 UI: Tailwind + shadcn/ui ✅ (recommend adding shadcn/ui)
- **Why:** Tailwind is fast and consistent; **shadcn/ui** (copy-in Radix primitives) gives accessible, own-your-code components (dialogs, inputs, tabs) that accelerate the warm, polished UI without a heavy dependency. Fits "own your components," accessibility, and the mobile-first design.
- **Alternatives:** MUI/Chakra (heavier, opinionated look — harder to make feel "warm, not corporate"); plain CSS (slower).
- **Verdict:** Keep Tailwind; add shadcn/ui.

### 3.5 No vector DB (structured-only) ✅
- Consciously rejecting LangChain/LlamaIndex/pgvector RAG: our corpus is tiny and structured, so deterministic grounding + prompt caching *beats* vector RAG here ([01](01-data-and-knowledge-model.md)), and heavy RAG frameworks would add abstraction we'd fight. Vectors are the documented later step.

---

## 4. Fork A — hosting (the key one): does Vercel actually fit us?

Our app has **two stateful needs** — durable SQLite writes (the loop) and a **real-time relay** — and Vercel's serverless model *fights both*, which is why we needed Turso (for the ephemeral FS) and polling (for the no-long-sockets limit). That's the signal to seriously weigh alternatives that accommodate stateful apps natively.

**Evaluated against our real needs** (persistent SQLite · real-time relay · trivial deploy + Next DX):

| Host | Model | Persistent SQLite | Real-time relay | Next DX / deploy | Cost (PoC) | Fit for us |
|---|---|---|---|---|---|---|
| **Vercel** | Serverless functions | ❌ ephemeral FS → needs **Turso** | ❌ no long sockets → **polling** | ✅✅ best-in-class, zero-config | free tier ok | Turnkey deploy, but fights both stateful needs |
| **Railway** | Always-on container | ✅ **persistent volume → plain better-sqlite3** | ✅ **real SSE/WebSocket** | ✅ git-push, near-Vercel DX | ~$5–10/mo | ★ **Best all-around fit** |
| **Render** | Always-on container | ✅ persistent disk (paid) | ✅ SSE/WebSocket | ✅ "just deploy app + db," very reliable | ~$7/mo | ★ Excellent, reliability-first |
| **Fly.io** | Global VMs | ✅ volumes / LiteFS | ✅ full control | ⚙️ container/ops knowledge | ~$2+/mo | Most control, most ops |
| **Netlify** | Serverless | ❌ like Vercel | ❌ like Vercel | ✅ good | free tier | Same serverless constraints as Vercel |
| **Cloudflare Pages** | Workers | ➖ via **D1** (different stack) | ➖ Durable Objects | ✅ good, but Workers runtime quirks | free tier | Pulls us into the Cloudflare/D1 world |

**Read:** on a **container host (Railway / Render)** both awkward spots *disappear*: a **plain SQLite file on a persistent volume** (drop the Turso dependency entirely — one fewer moving part) and a **real SSE relay** (cleaner than polling, and the relay is our differentiator). The cost is that Vercel's Next.js deploy is a touch more turnkey and its Next-specific polish (ISR, image optimization, edge) is deeper — features we barely use. Railway's DX is close to Vercel's (git-push), Render is prized for reliability.

**DECISION: Railway (container).** Given our two stateful needs and that the **live relay is a headline feature**, the container host is the *better architectural fit* — and it **simplifies the stack**: Turso is gone (plain **better-sqlite3** on a persistent volume) and polling is gone (real **SSE** relay). Render is the reliability-first equivalent if Railway disappoints; Fly if we want global VMs. Vercel is dropped — its serverless model fought both stateful needs.

**Model layer — DECIDED: hand-rolled.** We keep the **official SDKs** (`@anthropic-ai/sdk`, `@google/genai`) behind our own thin `FrontDeskModel` seam ([04 §6](04-grounding-and-prompts.md)) for full control of Anthropic prompt caching and provider-specific behavior. (The Vercel AI SDK was a reasonable option and is host-agnostic, but coarser control over caching tipped it; our two impls + one seam is little code.)

---

## 5. Fork B — the model layer: Vercel AI SDK vs. hand-rolled over official SDKs

This is the reconsideration worth the most attention, because it directly serves the **model-agnostic + Gemini-testing** requirement.

| | **Hand-rolled `FrontDeskModel` over official SDKs** (current plan) | **Vercel AI SDK (`ai`) as the model layer** |
|---|---|---|
| Provider-agnostic | We build the seam ourselves | **Built-in** — swap Claude↔Gemini by changing one provider line |
| Structured output | `output_config.format` (Anthropic) / `responseSchema` (Gemini), two code paths | **`generateObject` + Zod**, one path across providers |
| Streaming | Manual per SDK | `streamText`/`streamObject`, unified |
| Provider-specific features (Anthropic prompt caching, thinking) | **Full access** | Exposed via `providerOptions` — **verify caching passthrough** |
| Code we own | More (two adapters + schema mapping) | Less (the SDK *is* the abstraction) |
| Alignment w/ our guidance | Matches the `claude-api` skill (official SDK) | A legit provider-agnostic layer (not an OpenAI shim), widely used |

**Analysis:** our plan's "provider-agnostic interface with two impls" is *exactly what the Vercel AI SDK is*. Adopting it would **delete the adapter/schema-mapping code**, make the Gemini toggle a one-liner, and unify structured output + streaming — a direct hit on "less-is-more" and the A/B goal. The one thing to confirm is that **Anthropic prompt caching** (our latency/cost lever for the cached policy prefix) is cleanly reachable via `providerOptions.anthropic` — if yes, the AI SDK is the stronger choice; if caching control is too coarse, keep the official SDKs for the Claude answerer and use the AI SDK only for the Gemini toggle.
- **Not chosen either way:** *LangChain/LlamaIndex* — full agent/RAG frameworks; far more than a grounded FAQ over 20 records needs.
**DECISION: hand-rolled over the official SDKs.** Full control of Anthropic prompt caching and provider features won over the AI SDK's convenience — and our seam is little code (two `groundedAnswer` adapters + schema mapping). Our **`decide()` wrapper, prompts, and golden eval stay provider-neutral on top**. Revisit the AI SDK only if maintaining two adapters proves annoying.

---

## 6. System architecture (target)

```
        ┌──────────────── Browser (mobile-first, Tailwind + shadcn/ui) ───────────────┐
        │  Parent  /                         Operator  /admin  (mock passcode)         │
        │  chat + guided starters            dashboard · live relay · handbook · settings│
        └───────────┬──────────────────────────────────┬──────────────────────────────┘
                    │ HTTP  + SSE (relay stream)        │ HTTP  + SSE (relay stream)
        ┌───────────▼──────────────────────────────────▼──────────────────────────────┐
        │              Next.js (App Router) — always-on container on Railway            │
        │  Route handlers / Server Actions  (+ an SSE endpoint held open by the process)│
        │  ┌ Front-desk service ─────────────────────────────────────────────────────┐ │
        │  │  buildPrompt(cached policy prefix)                                        │ │
        │  │     → Model layer  [hand-rolled seam → Claude Sonnet 5 | Gemini 3.5 Flash]│ │
        │  │     → decide() wrapper: citation · deterministic fact-check · groundedness│ │
        │  │        gate  →  answer  OR  relay(reason)                                  │ │
        │  └───────────────────────┬───────────────────────────┬─────────────────────┘ │
        │        repository layer   │                           │ async judge (Haiku)   │
        └───────────────┬───────────┴──────────────┬────────────┴───────────────────────┘
                        │ better-sqlite3            │ LLM providers (API)
              ┌─────────▼──────────┐      ┌─────────▼───────────────────────────────────┐
              │ SQLite file        │      │ Anthropic  ·  Google Gen AI                  │
              │ (Railway volume)   │      └─────────────────────────────────────────────┘
              │ policies·escalations·audit·settings                                       │
              └────────────────────┘
```

---

## 7. One architecture consequence of the guardrails (worth stating)

Because we **verify before we show** ([07](07-hallucination-guardrails-review.md)), we **don't stream raw model tokens to the parent** — a half-generated answer can't be fact-checked. The parent sees a warm "checking our handbook…" state, then the *verified* answer appears at once. Trade: slightly higher perceived latency, bought back by fast Sonnet 5 + the cached prefix + a friendly waiting state. (Streaming is still fine *internally* and for the operator side.) This is a deliberate, defensible consequence of putting trust first.

---

## 8. Alignment check vs. principles

| Principle | How the stack honors it |
|---|---|
| Timebox / PoC | Next on Railway (git-push) = fast hosted URL; plain SQLite file + SSE, no extra services |
| Less-is-more | one SQLite file (no Turso); no vector store; SSE (no realtime service); shadcn = no component-lib weight |
| Model-agnostic | hand-rolled seam → one-line Claude↔Gemini swap |
| Persistence for the loop | better-sqlite3 durable relational writes on a Railway volume |
| Mobile-first | Next RSC + Tailwind + shadcn, phone-first |
| Defensible | Every layer is a mainstream, explainable 2026 choice with named alternatives |

---

## 9. Decisions — RESOLVED

1. **Hosting:** ✅ **Railway** (always-on container). Render = reliability-first fallback; Fly = max control.
2. **Model layer:** ✅ **Hand-rolled** provider-agnostic seam over official `@anthropic-ai/sdk` + `@google/genai`.
3. **UI kit:** ✅ **shadcn/ui on Tailwind**.
4. **Cascades:** persistence = ✅ **better-sqlite3 on a Railway volume** (Turso dropped); real-time = ✅ **SSE** (polling dropped).
5. Everything else in §2 settled.

> **Net simplification:** choosing a container host removed *two* prior workarounds — Turso and polling — leaving a plainer stack (one SQLite file, real SSE). Fewer moving parts, cleaner story.
