# Front Desk

**Front Desk** — a mobile-first proof-of-concept front desk **Brightwheel ships as a component** for its early-education centers. It's multi-tenant by design: the same code renders any center, and everything a parent sees — the business name, front-desk name, logo, one accent color, and the welcome copy — is configured per center from the control center. So the buyer sees *Brightwheel* and the parent sees *their daycare*, from one codebase.

Parents get fast, **grounded, attributed** answers about hours, tuition, sick-day policy, meals, and tours; when a question is uncertain or case-specific, the front desk **relays to staff in real time** (one voice, in-thread) rather than guessing — and a staff answer can be captured into the source of truth so deflection compounds.

Two surfaces, one codebase (both on the Brightwheel base look — plain background + white cards + blurple, tinted by the tenant's accent):

- **`/` — Parent front desk.** Anonymous chat with guided starters, attribution chips, and 👍/👎; branded per center.
- **`/admin` — Operator control center.** Dashboard (hours saved, containment, groundedness, top gaps), live-relay queue, source-of-truth editor, a **Branding tab** (edit everything parents see, beside a live preview), and settings (caution dial + provider toggle). Gated by a mock passcode.
- **`/handbook` — Read-only family handbook**, derived from the published policies the assistant cites.

The full design lives in [`analysis/`](analysis/) (stages 00–11; stage 10 covers the component reframe + per-center theming, stage 11 the provider config + availability); [`CLAUDE.md`](CLAUDE.md) is the working brief.

## Stack

- **Next.js** (App Router, TypeScript) · **Tailwind CSS** — one codebase for the mobile-first UI and the server logic
- **SQLite** via `better-sqlite3` (one file on a persistent disk; migrations run on connect)
- **LLM:** a provider-agnostic `FrontDeskModel` seam — **Claude Sonnet 5** answerer + **Haiku 4.5** judge (`@anthropic-ai/sdk`) by default, with **OpenAI GPT-5** and **Gemini Flash** as A/B toggles
- **Real-time relay:** Server-Sent Events (SSE), held open by the always-on Node process

The two stateful needs — **durable SQLite writes** and a **long-lived SSE stream** — are why this runs as an always-on Node server with a persistent volume, not on ephemeral serverless. See [`analysis/08`](analysis/08-architecture-and-stack-review.md) for the full rationale.

## Prerequisites

- **Node.js 20+** (uses native `better-sqlite3`; developed on Node 20–25)
- An llm key for live answers. Anthropics, OpenAI or Google.

## Getting started

```bash
npm install
cp .env.example .env.local     # optional — all keys can also be set in the admin UI
npm run db:migrate             # apply the schema (also runs automatically on first connect)
npm run db:seed                # seed Little Acorns policies + a week of history (idempotent)
npm run dev                    # http://localhost:3000
```

- Open **`/`** for the parent chat and **`/admin`** for the operator (passcode = `ADMIN_PASSCODE`, default `change-me`).
- No API key in the environment? The primary path is **Settings → AI provider** in `/admin`: paste a key per provider and it's stored encrypted at rest. The env vars below are only a bootstrap fallback so `npm run dev` answers before you open the UI.
- Health check: **`GET /api/health`** returns DB path, schema version, and entry count.

### Environment variables

All are **optional** — the app boots without them and provider keys can be entered in the admin UI. Set them in the environment for production/CI.

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Sonnet 5 answerer + Haiku 4.5 judge (default provider) | — (bootstrap fallback) |
| `OPENAI_API_KEY` | OpenAI GPT-5 provider (optional A/B toggle) | — |
| `GOOGLE_API_KEY` | Gemini Flash provider (optional A/B toggle) | — |
| `SECRETS_ENCRYPTION_KEY` | Master key (AES-256-GCM, 32-byte base64) for encrypting UI-entered provider keys at rest. Auto-provisions per-install if unset; **set it in production** so the key lives outside the DB. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | auto-provisioned |
| `DATABASE_PATH` | SQLite file location; point at the mounted volume in production (e.g. `/data/app.db`) | `./data/app.db` |
| `ADMIN_PASSCODE` | Mock operator gate for `/admin` (not real auth — a non-goal) | `change-me` |

## Commands

```bash
npm run dev         # local dev server (http://localhost:3000)
npm run build       # production build
npm run start       # run the built app (after npm run build)
npm run lint        # eslint
npm run test        # unit tests (guardrails, escalation gate, fact-checker, repos, metrics)
npm run test:watch  # unit tests in watch mode
npm run eval        # golden regression suite (needs ANTHROPIC_API_KEY; EVAL_PROVIDER=anthropic|google)
npm run db:migrate  # apply the SQLite schema
npm run db:seed     # seed policies + historical interactions (idempotent)
```

### Testing

`npm run test` runs the [Vitest](https://vitest.dev) suite — the business logic (grounding wrapper, escalation/decision gate, deterministic fact-checker, repositories, metrics rollup). Tests are colocated (`*.test.ts`) and use an in-memory SQLite DB, so they need **no API key or network** and run fast.

Two suites do reach the real models and are **opt-in** (they need a provider key):

```bash
npm run eval                            # graded golden suite: groundedness, decision, escalation P/R, facts
                                        #   (requires ANTHROPIC_API_KEY; EVAL_PROVIDER=anthropic|google)
RUN_LLM_IT=1 ANTHROPIC_API_KEY=… npm test   # live-model integration test
```

These require the key **in the environment** (not the admin UI): both run as standalone CLI scripts outside a running server, on a fresh in-memory DB, so there are no UI-stored encrypted credentials for them to read — the key can only come from `ANTHROPIC_API_KEY`. The deployed app is the opposite: it reads the UI-entered key first and treats env as a fallback.

## Deployment

The app is a **standard Next.js server** with two stateful needs — **durable SQLite writes** (the operator's compounding loop) and a **long-lived SSE stream** (the live staff relay). So it runs on any **always-on Node host with a persistent volume**, and is deliberately *not* a fit for ephemeral serverless functions (which lose the SQLite file between invocations and can't hold the SSE connection open).

**What any host needs to provide:**

1. **A long-running Node process** (not per-request functions) — so the SSE relay stream stays open.
2. **A persistent volume** mounted at a stable path — so the SQLite file survives restarts and deploys.
3. **Build + start:** `npm run build` then `npm run start` (Next serves on `$PORT`).
4. **Env vars** from the table above — at minimum `DATABASE_PATH` pointed at the volume, `ADMIN_PASSCODE`, and `SECRETS_ENCRYPTION_KEY`; a provider key via env or the admin UI.
5. **Health check** at `GET /api/health` for the platform's readiness probe.

### Railway (recommended — git-push deploy)

Chosen host ([`analysis/08 §4`](analysis/08-architecture-and-stack-review.md)): near-Vercel DX with the container model this app actually needs.

1. Create a project → **Deploy from GitHub repo** (Railway auto-detects Next.js via Nixpacks; no Dockerfile needed). Build = `npm run build`, start = `npm run start`.
2. Add a **Volume** to the service, mounted at `/data`.
3. Set **Variables**: `DATABASE_PATH=/data/app.db`, `ADMIN_PASSCODE`, `SECRETS_ENCRYPTION_KEY`, and `ANTHROPIC_API_KEY` (or add keys in the admin UI after first boot).
4. Push to the connected branch → Railway builds and deploys automatically. Optionally set the healthcheck path to `/api/health`.
5. First deploy: schema migrates on first DB connect. To load the demo center, run `npm run db:seed` once against the volume (Railway shell / one-off command) — or leave it empty and configure the center from `/admin`.

### Alternative hosts

Same requirements, so the app ports cleanly:

- **Render** — reliability-first equivalent. Create a **Web Service** from the repo, add a **Persistent Disk** mounted at `/data`, set the same env vars, build `npm run build` / start `npm run start`.
- **Fly.io** — most control. `fly launch` (add a `[mount]` volume for `/data`, set `PORT`), `fly secrets set …` for the env vars, deploy via the generated Dockerfile.
- **Any VPS / container platform** (a plain Docker container, ECS, etc.) — run `npm ci && npm run build && npm run start` with `/data` on a mounted volume and the env vars set.

### Migration path at scale

The stack is intentionally scrappy but migratable: SQLite → **Postgres/pgvector**, and the single-process SSE relay → a **managed realtime service** (Ably / Convex / Supabase Realtime) when you outgrow one container. Both are documented in [`analysis/08`](analysis/08-architecture-and-stack-review.md).

---

All data is fictional (the invented **Little Acorns Early Learning Center**); no real personal data is used.
