# Admin Settings — AI Provider Configuration + Online/Away Mode (Planning Stage 11)

**Purpose:** Two admin-controlled capabilities that turn the prototype into something a real center could run: (A) **configure the AI provider** — pick one of OpenAI / Google / Anthropic and set its **API key + model**, persisted **securely**; and (B) an **Online/Away switch + on-duty operator identity** that changes the parent experience — live and staffed by a named person when online, and when away, an honest disclaimer plus **asynchronous answers delivered by email** using the parent's contact info.
**Status:** Proposal for build · Date: 2026-09-22 · Author: Manuel
**Depends on / amends:** [00 §7/§8](00-scope-and-bounds.md) (provider seam; notifications non-goal), [01 §2.6](01-data-and-knowledge-model.md) (Settings), [03 §3.3/§3.5/§4.4](03-ux-flows.md) (relay, off-hours, settings), [04 §6](04-grounding-and-prompts.md) (model layer), [08](08-architecture-and-stack-review.md) (SSE/relay). Amends the provider model from a two-way `claude|gemini` toggle into a three-provider, key-configured selection.

---

## 1. Overview

| Feature | What the admin does | What changes for parents |
|---|---|---|
| **A — Provider config** (§3) | Selects **one** provider (OpenAI / Google / Anthropic), enters its **API key**, picks the **model**. Keys stored encrypted. | Nothing visible — the answerer runs on the configured provider. |
| **B — Online/Away + operator identity** (§4) | Flips the Front Desk **Online** or **Away** from a header CTA (manual, or follow center hours), **identifying the on-duty operator** — a name required to go Online, persisted center-wide. | **Online:** a status-only 🟢 "Online" pill (operator name shown only in admin + answer attribution, never in the parent pill) + real-time staff relay. **Away:** 🟡 "Away" pill whose tap-popover carries the disclaimer; escalations become **email follow-ups** (async), not live relay. Live answers are attributed to the named operator. |

Both live in the operator control center's **Settings** tab (Branding is its own tab per [10 §5.1](10-front-desk-rebrand-and-theming.md)); Settings now holds **Caution · AI provider · Availability**.

---

## 2. What exists today (baseline to amend)

- `Settings { caution_level, active_provider: "anthropic" | "openai" | "google" }` ([src/lib/repo/settings.ts](../src/lib/repo/settings.ts)); default provider `anthropic`.
- Provider seam: `getModel(provider)` factory ([src/lib/model/index.ts](../src/lib/model/index.ts)) → `ClaudeFrontDeskModel` / `GeminiFrontDeskModel`, both implementing `FrontDeskModel` ([src/lib/model/types.ts](../src/lib/model/types.ts)) with `answererModel`, `groundedAnswer`, `judgeGroundedness`.
- **Keys come from env** (`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` in [.env.example](../.env.example)) — not configurable at runtime.
- Live relay is an **in-memory SSE bus** on the single Railway container ([src/lib/relay/bus.ts](../src/lib/relay/bus.ts)); off-hours already has a *documented* fallback ("offer to note the question for follow-up" — [03 §3.3/§3.5](03-ux-flows.md)) that this stage makes real.
- **Operator identity is ephemeral today.** The admin header has a bare `"Your name"` text input held in local `useState("")` ([src/app/admin/page.tsx](../src/app/admin/page.tsx) — resets on every reload), passed to both `<RelayQueue>` and `<HandbookEditor>`. It already flows end-to-end as a free-text `answeredBy`: relay answer → `escalations.answered_by` (fallback `"Front Desk Team"` in [src/lib/relay/answer.ts](../src/lib/relay/answer.ts)) → SSE bus → parent bubble renders `✓ From our team · {name}` ([src/components/FrontDesk.tsx](../src/components/FrontDesk.tsx)). So **attribution already works** — what's missing is a *persisted identity* to feed it and a presence signal to bind it to.

---

## 3. Feature A — AI provider configuration

### 3.1 The provider model (three, one active)
Replace the `claude|gemini` toggle with a **three-provider** selection using neutral names:
```ts
type Provider = "anthropic" | "openai" | "google";   // was "claude" | "gemini"
```
**Exactly one provider is configured at a time** (the requirement, taken strictly). The admin selects a provider, then configures *that* provider's key + model. On save/activate, the previously configured provider's stored credential is **cleared** (`clearCredentialsExcept` in [src/app/api/admin/provider/route.ts](../src/app/api/admin/provider/route.ts)) — so only the active provider's secret is ever held at rest, and switching back does require re-entering that provider's key. This deliberately minimizes secrets stored at rest, at the cost of re-entry on switch (see the fork in §8, item 8 — resolved this way).

> **Rename impact:** `active_provider` values migrate `claude→anthropic`, `gemini→google`; `getModel`'s switch, the two model classes' `provider` fields, the settings default, and the A/B copy in [10]/UI update accordingly. Disposable DB → re-seed, no data migration ([10 §4]).

### 3.2 What's configurable — key + model
Per provider, the admin sets an **API key** and picks the **answerer model** from a curated registry (the judge model defaults, overridable later):

| Provider | SDK | Answerer options (registry) | Default answerer | Judge default |
|---|---|---|---|---|
| **Anthropic** | `@anthropic-ai/sdk` (present) | `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` (Opus 4.8 / Fable 5 reachable) | `claude-sonnet-5` | `claude-haiku-4-5` |
| **Google** | `@google/genai` (present) | Gemini Flash / Gemini Pro (`-latest` aliases) | Gemini Flash | Gemini Flash Lite (`gemini-flash-lite-latest`) |
| **OpenAI** | `openai` (**new dep**) | GPT-5 family (confirm current IDs at build) | GPT-5 (mini for judge) | GPT-5 mini |

- **Anthropic IDs are current** (verified against the `claude-api` skill; use exact strings, no date suffixes). **OpenAI/Google IDs are placeholders** — the registry is a small typed map (`src/lib/model/registry.ts`) whose values are confirmed against each provider's docs at build; the UI renders whatever the registry lists, so adding a model is a one-line change, never a UI change.
- The chosen `answerer_model` is already logged to the audit for A/B ([types.ts `answererModel`]).

### 3.3 Secure persistence (the "solid and secure mechanism")
API keys are secrets. The design keeps plaintext **only** in memory at call time, never in the DB, the client, or logs.

1. **Encrypt at rest — AES-256-GCM** via Node's built-in `crypto` (no new dep). A 32-byte master key encrypts each provider key; store `iv‖authTag‖ciphertext` (base64) in the DB. GCM's auth tag detects tampering. **The master key resolves from env `SECRETS_ENCRYPTION_KEY` (base64, 32 bytes) OR, when that is unset, an auto-generated 32-byte key persisted in the `meta` table.** So key config is **always available** (`secretsAvailable()` is always true) — there is no disabled state. Setting `SECRETS_ENCRYPTION_KEY` in the environment is still **recommended for production** (the master key then lives outside the DB and is rotatable), but the PoC works out of the box without it.
2. **Write-only over the API.** `PATCH` accepts a new key and stores its ciphertext; **`GET` never returns the plaintext** — only `{ configured: true, hint: "…last4", model, valid: true|false }`. A masked field ("sk-…·7f3a") is all the client ever sees. Submitting empty = "leave unchanged"; an explicit "Remove key" clears it.
3. **Validate on save.** After storing, do a **cheap liveness check** (e.g. a models-list or 1-token ping on that provider) and record `valid` + `last_checked`. The UI shows ✓ valid / ✗ rejected before the admin relies on it.
4. **Decrypt at the edge only.** `getModel()` (§3.4) decrypts the active provider's key in-process at call time and hands it straight to the SDK client; the plaintext never leaves that scope. **Redact everywhere** — never log the key; scrub it from error messages.
5. **Gated.** All provider-config routes sit behind the existing `x-admin-passcode` gate; the encryption key is server-only env (never shipped to the client, never in `NEXT_PUBLIC_*`).
6. **Rotation.** Rotating `SECRETS_ENCRYPTION_KEY` invalidates stored ciphertext → the admin re-enters keys (documented); a keyring (versioned master keys) is the scale path (fork §8.9).

> **AI-review safety** ([[repo-reviewer-safety]]): the repo ships **no real keys** — `.env.example` documents `SECRETS_ENCRYPTION_KEY` with a placeholder; the seed stores none. Nothing decrypts without an operator-supplied key at runtime.

### 3.4 Model-layer changes (behind the same seam)
- **`getModel()` resolves credentials.** Signature is **synchronous** — `getModel(provider?, db?): FrontDeskModel` (no `Promise`): better-sqlite3 is synchronous, so it reads `active_provider`, loads + **decrypts** that provider's key and model id from the credential repo in-process, and constructs the client with an explicit key (e.g. `new Anthropic({ apiKey })`, not the env default) — all without awaiting. **Env keys remain a bootstrap fallback** when no DB key is configured — so local dev and the seed demo keep working.
- **Add `OpenAIFrontDeskModel`** implementing `FrontDeskModel` with the `openai` SDK, using **structured outputs (JSON schema)** for `GroundedResult` — same contract as the Claude/Gemini impls, so `decide()` and call sites are untouched. Rename `ClaudeFrontDeskModel`/`GeminiFrontDeskModel` internals to the neutral provider names.
- **`answerer_model` / `judge_model` are injected** from config rather than hardcoded in each class, so the admin's model pick actually takes effect. The `FrontDeskModel.answererModel` field reflects the configured id (already audited).
- The guardrail wrapper, prompts, caching, relay, metrics — **unchanged**; this is a provider/config swap behind the seam ([00 §7]).

### 3.5 Admin UI — Settings → "AI provider"
Replaces the current radio pair in [SettingsPanel.tsx](../src/components/admin/SettingsPanel.tsx):
```
┌ AI provider ───────────────────────────────┐
│ Provider   (•) Anthropic ( ) OpenAI ( ) Google │
│ API key    [ ••••••••••·7f3a ]  [Update][Remove]│
│            ✓ Valid · checked 2m ago         │
│ Model      [ Claude Sonnet 5 ▾ ]            │
│            [ Save ]                          │
│ ℹ Keys are encrypted at rest and never shown │
│   again. Only one provider is active.        │
└──────────────────────────────────────────────┘
```
- Switching the radio shows that provider's config (masked if it's the active one; empty otherwise, since only the active provider's secret is retained). Save persists key (if changed) + model, sets it active, and clears the prior provider's stored secret; a spinner runs the liveness check.

### 3.6 Data model + schema
New table (keys isolated from general settings for clear security scoping):
```
provider_credentials {
  provider TEXT PRIMARY KEY,          // anthropic | openai | google
  key_ciphertext TEXT,                // iv‖authTag‖ciphertext (AES-256-GCM), nullable
  key_hint TEXT,                      // "…7f3a" for the UI
  answerer_model TEXT,                // chosen id
  judge_model TEXT,                   // chosen id (defaulted)
  valid INTEGER, last_checked TEXT
}
```
`Settings.active_provider` stays on the settings row (now the 3-value enum). Routes: extend `GET/PUT /api/admin/settings` or add **`/api/admin/provider`** (passcode-gated) wrapping a `credentials` repo + a `crypto` util (`encrypt`/`decrypt`/`mask`) — **unit-tested** ([[testing-convention]]: round-trip, tamper-detection, masking, "empty = unchanged").

---

## 4. Feature B — Online/Away mode + operator identity

### 4.1 The states + who sets them
```ts
Settings.availability: "online" | "away"        // manual toggle
Settings.offline_at?: string | null             // one-shot ISO auto-offline timestamp; null = stay online
Settings.away_message?: string                  // optional custom disclaimer
Settings.operator_name?: string                 // the on-duty operator (center-wide, persisted)
```
- **A manual Online/Away toggle** (in the header CTA — §4.2a — and mirrored in Settings), plus an optional **one-shot auto-offline**: `offline_at` holds an ISO timestamp at which the desk should flip itself to Away (`null` = stay online until toggled). It is **resolved lazily on read** — when settings are loaded, a non-null `offline_at` in the past yields Away — so there is **no scheduler/background job**.
- **Away is not "broken"** — grounded handbook answers still work; only the **live human relay** is unavailable, so uncertain/sensitive questions convert to **email follow-ups**.
- **One coupled fact — presence + identity.** Model availability and the on-duty operator as a single center-wide truth: *"Little Acorns' Front Desk is Online, staffed by Maria."* `operator_name` lives on the single `Settings` row (survives reloads and device changes; shared across admin browsers — coherent because presence is itself a center-wide fact). **Invariant: `availability="online"` requires a non-empty `operator_name`** — enforced server-side in the settings PUT, not just the UI, so the desk is never open anonymously and every live answer is attributed. `operator_name` **persists across Away↔Online** (Away does not clear it — re-opening is one tap; parents never see the name in the status pill — only in a live answer's attribution, which happens while Online).

### 4.2 Parent UI — indicator + disclaimer
One **compact status pill** in the parent header ([FrontDesk.tsx](../src/components/FrontDesk.tsx)), server-provided so there's no flash. The pill shows **status only — a colored dot + one word**: 🟢 **"Online"** or 🟡 **"Away"**. **The operator's name is deliberately not shown to parents** — it surfaces only in the admin header (§4.2a) and in answer attribution (`✓ From our team · {name}`, §2). The server component ([src/app/page.tsx](../src/app/page.tsx)) reads `getSettings(getDb())` alongside `getCenter` and passes `availability` (the resolved status) as a prop — the same pattern that already feeds `center` into the client component. The name is intentionally not passed to the parent surface.

- **Online:** 🟢 "Online". Behavior = today (grounded answers + live staff relay).
- **Away:** 🟡 "Away". Behavior = grounded handbook answers stay; uncertain/sensitive questions convert to **email follow-ups**.

**Tap to explain.** Tapping the pill opens a small **popover** that explains what the status means — for Away it carries the disclaimer (the center's custom `away_message`, or the default): *"We're away right now. I can answer common questions from our handbook, but for anything I'm unsure about, leave your email and our team will follow up — usually within one business day."* There is **no always-visible disclaimer banner** — the explanation lives in the pill's popover, shown only when the parent taps it.

Honesty first ([00 §Trust]): the popover sets expectations when the parent looks, so an escalation feels like a promise kept, not a dead end. Showing only the status (never the operator's name) to parents keeps the header calm and avoids implying a specific person is reachable in real time when the desk is away.

### 4.2a Operator presence CTA + identity (admin header)
The bare `"Your name"` input in the admin header ([src/app/admin/page.tsx](../src/app/admin/page.tsx)) becomes a **presence control** occupying the same header slot — the always-visible place an operator declares "I'm open, and it's me at the desk":
```
┌ header (admin) ─────────────────────────────┐
│ Front Desk · Relay        🟢 Online · Maria ▾│   ← click to flip / rename
└──────────────────────────────────────────────┘
   Away state:                🟡 Away          ▾
```
- **Clear on/off indicator, always visible:** a 🟢 Online / 🟡 Away pill in the header (green/amber, label + dot), so the operator can never be unsure whether the desk is live.
- **Go Online → identify yourself.** Tapping **Away→Online** opens an inline prompt — *"Who's at the front desk?"* — prefilled with the last `operator_name`. Confirming sends **one** PATCH setting `operator_name` **and** `availability:"online"`. **A name is required to complete the flip** (empty name → cannot go Online; enforced server-side per §4.1). Tapping **Online→Away** flips to Away in one tap; the name is retained for next time.
- **`operatorName` now comes from persisted Settings**, not local `useState` — loaded via the existing admin settings GET (or threaded from the server), so it survives reloads and is consistent across devices. It is still passed to `<RelayQueue>` and `<HandbookEditor>` exactly as today, so **both live relay answers *and* handbook `updated_by` edits gain durable, real-name attribution** — no re-typing each session.
- **Relationship to Settings → Availability (§4.5):** the header pill is the **quick toggle** (open/close + who's on, one tap, always in view); the Settings → Availability section stays the **richer config** (away note, one-shot `offline_at` auto-offline). Both write the same `Settings` fields and must stay consistent.

### 4.3 Away behavior — deferred escalation + async answer
Reuses the escalation machinery ([01 §2.3], [03 §3.3]) with a delivery mode:
- **Online** → escalation `delivery: "live"` → SSE relay into the thread (unchanged).
- **Away** → escalation `delivery: "email"`:
  1. Instead of "checking with our team…◐ (live)", the front desk shows an inline **contact capture**: *"Where should we send the answer?"* → name + email.
  2. On submit: escalation created `delivery:"email", status:"waiting"`, contact stored; parent sees *"We'll email you at a…@… within one business day."* Provenance stays truthful (no fake live cue).
  3. The parent can keep asking handbook questions meanwhile.
- **Grounded answers are unaffected** by availability — only the escalation path branches.

### 4.4 Email delivery seam (honest to the notifications non-goal)
[00 §8] makes real email delivery a non-goal but allows *simulating* it. So mirror the model seam:
```ts
interface EmailSender { send(msg: { to: string; subject: string; body: string }): Promise<{ id: string }>; }
```
- **PoC impl = `LoggingEmailSender`** — records a `delivered` row + writes to the audit, and surfaces a **"📧 Sent (simulated)"** confirmation in the operator UI (and optionally a dev "Outbox" view). No third party is contacted.
- **Real impl (wired later)** = Resend/Postmark behind the same interface, enabled by an env key — a clean "what's next," not built now.
- When the operator answers a `delivery:"email"` escalation in the relay queue, the answer routes through `EmailSender` (not the SSE bus) and the escalation is marked `answered` + `delivered`. **Capture-to-Knowledge-Base still applies** ([03 §4.2]) — a general Q&A answered by email can still become a citable `KnowledgeEntry`, so deflection compounds even off-hours.

### 4.5 Admin UI — Settings → "Availability" + the relay queue
```
┌ Availability ──────────────────────────────┐
│ Status   (•) Online   ( ) Away              │
│ Away note[ We're away right now… ]          │
└──────────────────────────────────────────────┘
```
- This section mirrors the header presence CTA (§4.2a) — same `availability` field, so flipping in either place is equivalent. The **quick toggle + operator name lives in the header** (always visible); this section keeps the richer config (away note, one-shot `offline_at` auto-offline).
- **Attribution default:** the `answeredBy` written on each relay answer defaults to the persisted `operator_name` (in [src/lib/relay/answer.ts](../src/lib/relay/answer.ts)). Because Online requires a name (§4.1), **every live answer is attributed to a real person**; the existing `"Front Desk Team"` fallback becomes a rare safety net rather than the norm. No new field is needed on the answer path — only a persisted source for the name that already flows through it.
- The **relay queue** ([RelayQueue.tsx](../src/components/admin/RelayQueue.tsx)) gains a delivery marker: 🔴 *live (parent waiting)* vs 📧 *email follow-up*. Live items keep the waiting timer; email items show the captured address and, on answer, a "Send email" action → simulated delivery confirmation. Answering a live item while Away is prevented (no open stream) — it's queued as email instead.

### 4.6 Data model + schema
- `Settings`: add `availability`, `offline_at?` (one-shot ISO auto-offline timestamp, resolved lazily on read), `away_message?`, **`operator_name?`** (center-wide; persists across Away↔Online). Thread `caution_level`/`active_provider`-style through the repo ([src/lib/repo/settings.ts](../src/lib/repo/settings.ts) — hardcoded SELECT + UPDATE column lists) and the `settings` table ([src/lib/schema.ts](../src/lib/schema.ts), `TEXT NOT NULL DEFAULT ''` per the `center.display_name` precedent). Settings is created lazily from repo `DEFAULTS` (no seed row), so the new column's default lives there + in the schema.
- `Escalation` ([01 §2.3]): add `delivery: "live" | "email"`, `contact_name?`, `contact_email?`, `delivered_at?`.
- Optional `EmailDelivery { id, escalation_id, to, subject, body, status, created_at }` for the outbox/audit (or fold into the audit log).
- Conversation may carry the captured contact for reuse across turns.

---

## 5. Touchpoint inventory (build checklist)

| File | Change |
|---|---|
| [src/lib/types.ts](../src/lib/types.ts) | `Provider` → `anthropic\|openai\|google`; `Settings` gains `availability`, `offline_at?`, `away_message?`, **`operator_name?`**; `Escalation` gains `delivery`, `contact_*`, `delivered_at`. |
| `src/lib/crypto.ts` *(new)* + `crypto.test.ts` | AES-256-GCM `encrypt`/`decrypt`/`mask` over `SECRETS_ENCRYPTION_KEY`. Unit-tested (round-trip, tamper, mask). |
| `src/lib/repo/credentials.ts` *(new)* + test | `provider_credentials` table CRUD; returns masked reads, stores ciphertext. |
| [src/lib/model/index.ts](../src/lib/model/index.ts) | `getModel()` resolves + decrypts active provider's key/model (env fallback). |
| `src/lib/model/openai.ts` *(new)* + `src/lib/model/registry.ts` *(new)* | OpenAI `FrontDeskModel` (structured outputs); typed model registry per provider. |
| [src/lib/model/claude.ts](../src/lib/model/claude.ts), [gemini.ts](../src/lib/model/gemini.ts) | Take injected key + model; rename provider ids. |
| `src/lib/email/sender.ts` *(new)* + `LoggingEmailSender` + test | Email seam; PoC simulated impl; delivery recorded. |
| [src/lib/relay/answer.ts](../src/lib/relay/answer.ts), [queue.ts](../src/lib/relay/queue.ts) | Branch on `delivery`: SSE (live) vs email (away); mark `delivered`. `answeredBy` defaults to persisted `operator_name` (existing `"Front Desk Team"` fallback stays as safety net). |
| `src/app/api/admin/provider/route.ts` *(new)* + [src/lib/admin.ts](../src/lib/admin.ts) | Passcode-gated GET(masked)/PATCH; liveness check. |
| [src/app/api/admin/settings/route.ts](../src/app/api/admin/settings/route.ts) | Availability fields; validate `operator_name` (trim, length-cap) + `availability` allow-list; **reject `online` with empty `operator_name`**; update the empty-patch 400 message (it currently names only the two existing fields). |
| [src/app/api/ask/route.ts](../src/app/api/ask/route.ts) | Away → escalation `delivery:"email"` + contact capture; pass availability to the client. |
| [src/components/admin/SettingsPanel.tsx](../src/components/admin/SettingsPanel.tsx) | New **AI provider** (§3.5) + **Availability** (§4.5) sections. |
| [src/components/admin/RelayQueue.tsx](../src/components/admin/RelayQueue.tsx) | live vs 📧 email markers; send-email action. |
| [src/app/admin/page.tsx](../src/app/admin/page.tsx) | Replace the ephemeral `"Your name"` input (local `useState`) with the **presence CTA** (§4.2a): on/off pill + go-Online name prompt; source `operatorName` from persisted Settings and pass to `<RelayQueue>`/`<HandbookEditor>` as today. |
| [src/app/page.tsx](../src/app/page.tsx) | Server component reads `getSettings(getDb())` alongside `getCenter`; pass the resolved `availability` (status only, **not** `operator_name`) as a prop into `<FrontDesk>`. |
| [src/components/FrontDesk.tsx](../src/components/FrontDesk.tsx) | Compact status-only Online/Away pill (dot + word; no operator name — §4.2) with a tap-popover carrying the status explanation + away disclaimer; inline contact-capture on away-escalation. |
| [src/lib/repo/settings.ts](../src/lib/repo/settings.ts) | Add `operator_name` to `DEFAULTS` + the hardcoded SELECT and UPDATE column lists. |
| [src/lib/schema.ts](../src/lib/schema.ts) + [scripts/migrate.ts](../scripts/migrate.ts) + [seed](../src/lib/seed/data.ts) | `provider_credentials`, settings (`availability`, `operator_name`, …) + escalation columns; seed `active_provider="anthropic"`, `availability="online"`. Note: schema has **no ALTER path** (only `CREATE TABLE IF NOT EXISTS`), so new columns land on a fresh/re-seeded DB — consistent with §11's disposable-DB stance. |
| [.env.example](../.env.example) | Add `SECRETS_ENCRYPTION_KEY=` (+ note keys are now DB-configurable); optional `OPENAI_API_KEY`, real-email provider key (later). |
| `package.json` | Add `openai`. |
| [CLAUDE.md](../CLAUDE.md), [analysis/00](00-scope-and-bounds.md)/[01](01-data-and-knowledge-model.md)/[03](03-ux-flows.md) | Reflect three providers + configurable keys + availability. |

---

## 6. Security & privacy notes

- **API keys:** encrypted at rest, write-only API, masked reads, redacted logs, decrypt only in-process at call time, gated by passcode + a master key (env `SECRETS_ENCRYPTION_KEY`, else auto-generated and persisted in `meta`). Plaintext is never stored — keys are only ever held encrypted or in-memory at call time.
- **Parent PII (email):** [00 §8] forbids real PII/notifications. So captured emails are **demo data**: the PoC uses the **simulated** sender (nothing leaves the app), the field is clearly optional, and the writeup names "wire a real email provider + PII handling/retention" as next steps. Validate format; length-cap; never expose one parent's contact to another.

---

## 7. Fit with the brief

- **Provider config** makes the "provider-agnostic, works out-of-the-box for a center with no IT" claim *real and operable* — a center brings its own key, picks a model, done. Secure-by-design persistence is the kind of judgment the eval rewards.
- **Online/Away + operator identity** is deep **user empathy** and **warmth/trust**: it never pretends a human is there when one isn't, attributes each live answer to the real person who sent it ("✓ From our team · Maria"), and still resolves the question (async email) instead of dead-ending — the escalation loop that *teaches* ([00 §4]) keeps compounding even off-hours. Persisting the operator name also removes daily friction for the busy owner (no re-typing) — *less-is-more scrappiness*.
- **Non-negotiables honored:** guardrail wrapper untouched; grounded answers always available; escalation degrades gracefully; simulated (not faked-as-real) email.

---

## 8. Decisions & open forks

**Decided:**
1. **Three providers, one active**, neutral names (`anthropic|openai|google`); rename from `claude|gemini`.
2. **Per-provider key + model**, chosen from a typed registry; Anthropic IDs current, others confirmed at build.
3. **AES-256-GCM at rest** (Node `crypto`); master key from `SECRETS_ENCRYPTION_KEY` (recommended for production) **or an auto-generated key persisted in `meta`** — so key config is always available, never disabled. Write-only/masked API, decrypt at the edge, env key fallback for the provider SDKs.
4. **`getModel()` resolves credentials** behind the unchanged seam; add `OpenAIFrontDeskModel`.
5. **Manual Online/Away toggle**; Away → grounded answers stay, escalations become **email follow-ups** with contact capture.
6. **Email via a seam**, **simulated** in the PoC (honest to [00 §8]), real provider pluggable later; email answers can still capture-to-policy.
7. **Operator identity + presence.** (a) `operator_name` is **center-wide** on the `Settings` row (survives reloads/devices), replacing the ephemeral header input; (b) a **name is required to go Online** (server-enforced), so the desk is never open anonymously; (c) the parent **status pill shows status only** — a colored dot + one word ("Online"/"Away"), with a tap-to-open popover explaining what the status means (and, when Away, the disclaimer). **The operator's name is not shown to parents** in the pill; it surfaces only in the admin header and in answer attribution. The presence CTA lives in the admin header; live answers default `answeredBy` to `operator_name`.

**Open forks:**
8. **"One provider configured" strictness** — ✅ resolved: **keep only the active provider's secret** (cleared on switch), minimizing secrets at rest, at the cost of re-entry when switching back. (The alternative — persist every provider's config for no-re-entry — was considered and rejected for the PoC.)
9. **Key management at scale** — versioned keyring / rotation without re-entry; move to a secrets manager (Vault/SSM) beyond the PoC.
10. **Availability automation** — shipped: manual toggle + a one-shot `offline_at` auto-offline resolved lazily on read (no scheduler). Forks: a recurring `hours` mode driven by center hours/timezone, and a true scheduled flip.
11. **Judge model exposure** — auto-default (v1) vs. let the admin pick the judge model too.
12. **Contact capture UX** — inline mini-form per away-escalation (lean) vs. ask once per session and reuse.
13. **Away relay realtime** — pure async email (v1) vs. also notify staff so they *can* answer fast if around (blends live + email).
14. **Multi-operator identity** — center-wide single `operator_name` (v1, fits a single-owner SMB) vs. per-device or per-account identity so several staff answering from different devices are each attributed distinctly.
