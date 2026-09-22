# Little Acorns AI Front Desk

A mobile-first proof-of-concept **AI Front Desk** for an independent early-education center. Parents get fast, **grounded, attributed** answers about hours, tuition, sick-day policy, meals, and tours; when a question is uncertain or case-specific, the front desk **relays to staff in real time** (one voice, in-thread) rather than guessing — and a staff answer can be captured into the source of truth so deflection compounds.

Two surfaces, one codebase:

- **`/` — Parent front desk.** Anonymous chat with guided starters, attribution chips, and 👍/👎.
- **`/admin` — Operator control center.** Dashboard (hours saved, containment, groundedness, top gaps), live-relay queue, source-of-truth editor, and settings (caution dial + provider toggle). Gated by a mock passcode.
- **`/handbook` — Read-only family handbook**, derived from the published policies the assistant cites.

The full design lives in [`analysis/`](analysis/) (stages 00–09); [`CLAUDE.md`](CLAUDE.md) is the working brief.

## Stack

- **Next.js** (App Router, TypeScript) · **Tailwind CSS**
- **SQLite** via `better-sqlite3` (one file on a persistent disk)
- **LLM:** a provider-agnostic `FrontDeskModel` seam — **Claude Sonnet 5** answerer + **Haiku 4.5** judge (`@anthropic-ai/sdk`) by default, **Gemini Flash** (`@google/genai`) as the A/B toggle
- **Real-time relay:** Server-Sent Events

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in the keys below
npm run db:migrate             # apply the schema
npm run db:seed                # seed Little Acorns policies + a week of history
npm run dev                    # http://localhost:3000
```

Open `/` for the parent chat and `/admin` for the operator (passcode = `ADMIN_PASSCODE`).

### Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude answerer + judge (required for live answers) |
| `GOOGLE_API_KEY` | Gemini provider (optional A/B toggle) |
| `DATABASE_PATH` | SQLite file location (defaults to `./data/app.db`; point at the mounted volume in production) |
| `ADMIN_PASSCODE` | Mock operator gate for `/admin` (defaults to `change-me`) |

## Commands

```bash
npm run dev         # local dev server
npm run build       # production build
npm run start       # run the built app
npm run lint        # lint
npm run test        # unit tests (guardrails, escalation gate, fact-checker, repos, metrics)
npm run eval        # golden regression suite (needs ANTHROPIC_API_KEY; EVAL_PROVIDER=claude|gemini)
npm run db:migrate  # apply the SQLite schema
npm run db:seed     # seed policies + historical interactions (idempotent)
```

The graded `npm run eval` and the live-model integration test (`RUN_LLM_IT=1 npm test`) call the real models and require an API key.

## Deployment

The app is a standard Next.js server with two stateful needs — **durable SQLite writes** and a **long-lived SSE stream** — so it runs on any **always-on Node host with a persistent volume** (it is *not* a fit for ephemeral serverless functions). Point `DATABASE_PATH` at the mounted volume, set the environment variables above, and run `npm run build && npm run start`. See [`analysis/08-architecture-and-stack-review.md`](analysis/08-architecture-and-stack-review.md) for the hosting rationale.

All data is fictional (the invented Little Acorns Early Learning Center); no real personal data is used.
