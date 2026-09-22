# Front Desk — Rebrand as a Brightwheel Component + Per-Center Theming (Planning Stage 10)

**Purpose:** Reposition the prototype from a one-off "Little Acorns AI Front Desk" into **Front Desk — an embeddable component Brightwheel ships as part of its platform**, deployed across many independent centers. Two consequences drive this stage: (1) the whole product wears **Brightwheel's base look** (plain background + white cards + blurple), and (2) because one component serves many customers, the admin **configures everything parents see from the control center** — the front-desk name, the business name, an uploaded logo, one accent color, and the welcome copy.
**Status:** Proposal for build · Date: 2026-09-22 · Author: Manuel
**Depends on / amends:** [00-scope-and-bounds.md](00-scope-and-bounds.md), [01-data-and-knowledge-model.md](01-data-and-knowledge-model.md) §2.1/§2.6, [03-ux-flows.md](03-ux-flows.md) §6/§6b. This doc is the source of truth for naming, branding, and theming; where it conflicts with earlier stages, it wins.

---

## 1. The reframe (why this changes anything)

Until now the prototype *was* one center. But Brightwheel is vertical SaaS deployed to **850k+ providers, ~90% independent SMBs** ([CLAUDE.md](../CLAUDE.md) domain context). The Front Desk is not a standalone app — it is **one surface inside the Brightwheel product** that a center turns on. That single framing decision produces everything below:

- **It is a *component*, not a *site*.** It assumes it is mounted inside Brightwheel. So it owns minimal global chrome, ships a "powered by Brightwheel" footprint, and is fully themeable from the outside.
- **It is *multi-tenant by design*.** The same code renders Little Acorns today and "Sunbeam Montessori" tomorrow. Nothing center-specific may be hardcoded — the center name, the label, the color, the brand mark all come from data.
- **Two layers, one canvas** (§3). A fixed **Brightwheel base look** (structure/neutrals) carries a thin **tenant brand layer** (accent color + logo + name + copy). The buyer feels Brightwheel; the parent sees their daycare's mark and color — without a bespoke skin.

**One-line thesis:** *Front Desk is a Brightwheel-based component whose one accent color, logo, name, and copy are set per center from the control center — so it feels like Brightwheel to the buyer and like "my daycare" to the parent, from one codebase.*

---

## 2. Naming (rename pass)

| Concept | Before | After | Where it lives |
|---|---|---|---|
| **The product** (generic, in code/docs/metadata) | "AI Front Desk" / "Little Acorns AI Front Desk" | **Front Desk** (a Brightwheel component) | code identifiers, README, CLAUDE.md, `<title>` default, package name |
| **What a center calls its front desk** (parent-facing) | hardcoded "Little Acorns Front Desk" | **`center.display_name`** — tenant-configured (e.g. "Little Acorns Front Desk", "Ask Sunbeam", "Sunbeam Help Desk") | `Center` row; edited in the control center |
| **The center itself** | "Little Acorns Early Learning Center" | unchanged — still `center.name`, still the seed tenant | `Center` row |

Rules:
- Drop **"AI"** from the user-visible product name. Per [03 §6](03-ux-flows.md) the front desk is "one continuous voice," not a bot; "AI" in the title undercuts that. (Internal/engineering references to the LLM stay as-is.)
- **Never** render a hardcoded center string. Every parent-facing name comes from `display_name` (with a computed fallback, §4). Grep target — these literals must all resolve to data:
  - `src/app/page.tsx:10` `"Little Acorns Front Desk"` fallback
  - `src/app/layout.tsx:16-18` static title/description
  - `src/components/FrontDesk.tsx:185` `"Front Desk"` subtitle + 🌰 avatar
  - `README.md:1` `# Little Acorns AI Front Desk`
  - Comment/prose "AI Front Desk" in `src/lib/schema.ts:4`, `src/lib/types.ts:2` (cosmetic — update for consistency).

---

## 3. The two-layer brand model (the core design decision)

"Adopt Brightwheel's design" **and** "let each center pick their color" resolve into two layers with different jobs. **The base look is Brightwheel everywhere; the tenant controls one accent color + their logo/name/copy.**

| | **Layer A — Brightwheel base system (whole app)** | **Layer B — Center brand (tenant)** |
|---|---|---|
| **What it is** | The Brightwheel look-and-feel across **both** surfaces: **plain background with white cards on top**, Brightwheel neutrals, typography, spacing, radii. | The center's one **accent color** + **logo** + **display name** + **welcome copy**. |
| **Source** | Fixed in the codebase (design tokens). | `Center` config, runtime-injected / uploaded. |
| **Scope** | Everywhere — admin *and* parent share the same clean canvas. | Accent-only, applied to both surfaces: header logo/name, buttons, chips, links, brand tints. The **structure stays Brightwheel**. |
| **Rationale** | One coherent product; the buyer sees Brightwheel, the parent sees a clean modern app — not a bespoke skin. | The parent's daycare is present via its **logo + name + color**, layered on the Brightwheel canvas. That's how white-label embeds work. |

Both layers use the **same CSS token names** (`--brand`, `--brand-strong`, `--brand-fg`, neutrals). Only the values differ:
- **Default `:root`** = Brightwheel design tokens (plain-bg/card neutrals + blurple as the *default* accent). Admin uses these as-is (blurple accent).
- **All surfaces** override just the **accent** tokens (`--brand*`) at runtime from `center.brand_color`; the neutral/structure tokens never change. `/handbook` matches the parent surface.

> **Why this is nearly free to build:** every component already styles with the tokens `--brand` / `--brand-strong` / `--brand-fg` / `bg-brand/10` etc. — verified across `FrontDesk.tsx`, all `admin/*`, `handbook`. **No component reads a raw hex.** So theming = (a) reset the token *values* in `globals.css` to Brightwheel's plain-bg/card neutrals, and (b) inject only the accent from `center.brand_color`. Component JSX is essentially untouched.

### 3.1 Brightwheel base look to adopt (Layer A, whole app)
From mybrightwheel.com: clean modern sans-serif, **generous roundness**, spacious whitespace, **plain cool-neutral background with white cards** floating on top, blurple accent. Concretely:
- **Plain background + cards:** replace the current warm-cream canvas with a **cool near-white/light-gray page background** (`--background`) and **white cards/surfaces** (`--surface`) with soft borders (`--border`) and subtle shadow — the Brightwheel card idiom. This is the base for **both** parent and admin (supersedes the "warm cream" of [03 §6b](03-ux-flows.md); warmth now comes from copy, roundness, and the tenant's own color/logo, not a beige canvas).
- **Default accent `--brand`:** Brightwheel blurple. Token `--bw-blurple`; **confirm exact hex against brand assets at build** — working default `#6C4EE8`, `--brand-strong` `#5638C9`, `--brand-fg` `#ffffff`. This is the accent the admin sees and the fallback when a tenant sets no color.
- **Neutrals as tokens:** `--background` (page), `--surface` (cards), `--muted`, `--border`, `--radius`, card shadow — one set, used by both surfaces.
- **Radius & spacing:** keep the generous radii (`rounded-2xl`, pill buttons) — already on-brand; formalize as `--radius` tokens.
- **Type:** keep a clean geometric sans (Geist reads Brightwheel-adjacent); option to match Brightwheel's face later.

### 3.2 "Component, not site" chrome + the Powered-by footer
- Admin stays a **panel** feel (light nav, self-contained tabs) — it's a section of Brightwheel, not its own product.
- **"Powered by Brightwheel" footer on *both* surfaces** (parent `/` + `/handbook` **and** the admin console) — the component is a Brightwheel deployment, so it's attributed everywhere. One reusable `<PoweredByBrightwheel />`:
  - Composition: muted `Powered by` · **Brightwheel logo mark (SVG)** · **`brightwheel` wordmark (text)**.
  - **Wordmark font = the website's font.** Brightwheel's site (a WordPress theme) sets its primary family to `"AvenirNext", "Helvetica Neue", helvetica, arial, sans-serif` (confirmed from the live CSS variable `--wp--preset--font-family--primary`). Render the wordmark in exactly that stack. **Avenir Next is a licensed/system font (not on Google Fonts)** — in a PoC we use the *stack* (Avenir Next is present on Apple devices; Helvetica Neue/Arial are faithful fallbacks), we do **not** embed a commercial webfont. Add it as a `--font-brand-wordmark` token so only the wordmark uses it; the rest of the app keeps its UI sans.
  - **The footer is Layer A (Brightwheel), always** — it stays blurple/neutral even on the color-themed parent surface, because it's the *platform's* mark, not the tenant's. It must not pick up `center.brand_color`.
  - Logo asset: drop the Brightwheel mark SVG into [public/](../public/) (e.g. `public/brightwheel-mark.svg`); a plain inline SVG, no script — safe for the AI-review constraint.
- **Favicon (browser tab / bookmark icon).** The stock Next.js icon at [src/app/favicon.ico](../src/app/favicon.ico) must be replaced — it currently ships the framework default. Two options:
  - **Default (lean, recommended):** the **Brightwheel mark** — Layer A, consistent with the Powered-by footer and the "this is a Brightwheel component" framing. Replace `src/app/favicon.ico` (App Router auto-serves it) or add `src/app/icon.svg`.
  - **Optional flourish (per-tenant):** a dynamic `src/app/icon.tsx` using Next's `ImageResponse` to render the center's `brand_emoji` on its `brand_color` — the tab icon then white-labels with the theme. Elegant tie-in to the theming, but more than the PoC needs; note as a fork.
  - Also refresh the `apple-touch-icon` / any PWA icons and the `<title>` favicon coherence so a bookmarked front desk looks intentional.

---

## 4. Data model changes ([01 §2.1](01-data-and-knowledge-model.md))

Branding is **tenant identity** → it belongs on `Center` (the user's "profile configuration"), not on `Settings` (which stays runtime prefs: caution + provider).

The admin edits the **whole parent-facing identity + copy** (§5). All of it lives on `Center`:
```ts
interface Center {
  // …existing: id, name, city, state, phone, timezone, hours_general, age_groups, persona_notes
  // name = the BUSINESS name, e.g. "Little Acorns Early Learning Center" (already exists)
  display_name: string;      // the ASSISTANT/front-desk name parents read, e.g. "Little Acorns Front Desk" / "Ask Acorn"
  brand_color: string;       // the ONE tenant accent hex, e.g. "#4f7a5b"; drives --brand*
  logo?: string;             // uploaded institution logo (data URI, PoC) — takes precedence over emoji
  brand_emoji?: string;      // fallback brand mark when no logo (default "🌰")
  welcome_message?: string;  // the parent greeting (replaces the hardcoded "Hi! I can help with…")
}
```
- **Business name vs assistant name:** `name` is the center ("Little Acorns Early Learning Center"); `display_name` is what they call the front desk ("Little Acorns Front Desk", or a persona like "Ask Acorn"). Parent header leads with the **business name** (h1) and shows the **assistant name** as the subtitle (today the subtitle is a hardcoded literal "Front Desk").
- **`display_name` fallback:** if empty, compute `\`${name} Front Desk\``. Keeps rename safe if a tenant leaves it blank.
- **`brand_color` validation:** must be a valid `#rrggbb`; the derive util (§5) is the guard. Invalid/empty → fall back to Brightwheel blurple.
- **`logo` (institution logo upload):** the admin can upload the center's real logo; it renders as the brand mark in the parent header (and the assistant avatar). **Precedence:** `logo` → else `brand_emoji` → else default 🌰. Storage (PoC): a **data URI in the `logo` column**, size-capped (≈256KB) and constrained to **raster types (PNG/JPEG/WebP)** — SVG upload is disallowed (script-injection surface; matters for the AI-review constraint). No filesystem-serving concerns, works on any host; the scale path is a file on the Railway volume served by a route (fork §9).
- **`brand_emoji`:** the 🌰 is hardcoded in **5 places** (`FrontDesk.tsx:182,292`, `handbook/page.tsx:30`, `admin/page.tsx:39,60`). It's the zero-effort default mark when no `logo` is uploaded. The admin console keeps the Brightwheel mark, not the tenant emoji/logo.
- **`welcome_message`:** the greeting at `FrontDesk.tsx:254-255` is hardcoded — make it editable so a center can set its own voice (fallback = the current copy). The starter chips (`FrontDesk.tsx:30-36`) stay intent-bound for v1; editable starters are a fork (§8), not v1.

**Migration:** add the new columns (`display_name`, `brand_color`, `logo`, `brand_emoji`, `welcome_message`) to the `center` table in [src/lib/schema.ts](../src/lib/schema.ts) + [scripts/migrate.ts](../scripts/migrate.ts); update `upsertCenter`/`getCenter` in [src/lib/repo/center.ts](../src/lib/repo/center.ts) to carry them. This is a PoC on a disposable SQLite file, so **re-seed** rather than write a data migration.

**Seed the story ([src/lib/seed/data.ts](../src/lib/seed/data.ts)):** set Little Acorns' `display_name = "Little Acorns Front Desk"`, `brand_color = "#4f7a5b"` (the *current* sage green), `brand_emoji = "🌰"`. The demo looks familiar — but the green now comes from tenant config, so **changing the color/name live in the control center becomes a one-click white-label demo** (a persuasive "watch this become another center" moment for the writeup).

---

## 5. Theming mechanism (Layer B injection)

A single pure, testable util turns one base hex into the full token set for both light and dark:

```ts
// src/lib/theme.ts  (+ theme.test.ts — business logic, per testing convention)
function deriveTheme(hex: string): {
  brand: string;        // the base (validated)
  brandStrong: string;  // darker for hover/emphasis
  brandFg: string;      // "#fff" or near-black, chosen by WCAG luminance for contrast
  brandDark: string;    // lightened variant for dark mode --brand
  // dark-mode strong/fg as needed
}
```
- **Contrast is computed, not trusted:** `brandFg` is picked by relative luminance so text on the brand fill always meets WCAG AA, whatever color a center picks. Tints (`bg-brand/10`, `ring-brand/30`) already work because Tailwind resolves opacity via `color-mix` on the CSS var — free.
- **Injection (app-wide accent):** the accent applies to **both** surfaces, so inject once at the **root layout** — the server reads `center.brand_color`, calls `deriveTheme`, and sets only the accent tokens as an inline `style` on the wrapper:
  ```tsx
  <body style={{ '--brand': t.brand, '--brand-strong': t.brandStrong, '--brand-fg': t.brandFg }}>
  ```
  The neutral/structure tokens (background, card, border) come from `:root` in `globals.css` and are never overridden. No FOUC (server-rendered), no client flash, no per-tenant CSS bundles. Unset/invalid `brand_color` → the Brightwheel-blurple `:root` default shows through. (The **brand mark** differs by surface — logo/emoji on parent headers, Brightwheel mark in the admin header — but the accent is shared.)
- **Dark mode:** `deriveTheme` also yields the lightened dark-mode `--brand`; emit it in a nested scope or a second inline block guarded by the existing `prefers-color-scheme` approach in [globals.css](../src/app/globals.css).

### 5.1 The admin editing experience (the ask)
**The control center is the one place the admin edits everything parents see** — a dedicated **"Branding" tab** in the admin nav (`Dashboard · Live relay · Handbook · Branding · Settings`), promoted from the earlier "card in Settings" idea because it's now a first-class surface. Settings keeps caution + provider (operator runtime prefs); Branding owns tenant identity + parent-facing copy.

Layout — an **edit form beside a live parent preview** (the moment that sells white-label):

```
┌──────────────── Branding ─────────────────┐
│ Business name   [Little Acorns Early …   ] │   ┌─ Live preview ─────────┐
│ Front-desk name [Little Acorns Front Desk] │   │ [logo] Little Acorns E…│
│ Logo            [⬆ Upload]  (or emoji 🌰)  │   │        Little Acorns F…│
│ Theme color     ● ● ● ● ●  + [#4f7a5b]     │   │ ┌────────────────────┐ │
│ Welcome message [Hi! I can help with …   ] │   │ │ Hi! I can help with│ │
│                                            │   │ └────────────────────┘ │
│                          [ Save changes ]  │   │ [ 🕐 Hours & closures ]│
└────────────────────────────────────────────┘   └────────────────────────┘
```
- **Logo:** upload the institution's logo (drag/file input); shows a thumbnail + "Remove" to fall back to the emoji. Client-side validation (type + size) before it's sent as a data URI. If no logo, the emoji field is the mark.
- **Theme color:** a row of **Brightwheel-curated preset swatches** + a custom hex input; the preview recolors instantly via `deriveTheme` (§5.2) so the owner sees contrast before saving. Presets keep non-designer SMB owners on tasteful, legible colors (less-is-more).
- **Live preview** re-renders the actual parent header + welcome + a bubble + a starter using the pending (unsaved) values — same components, so it's truthful.
- On **Save**, a small line reinforces the model: "Parents now see these changes." Mobile: preview stacks below the form.

### 5.2 Persistence & write path
Persist via a new **`PATCH /api/admin/center`** route + handler in [src/lib/admin.ts](../src/lib/admin.ts) (center is currently seed-only with no write route — this adds one, gated by the same `x-admin-passcode` as the other admin routes). Server-side validation: valid `#rrggbb`; text trimmed + length-capped; **`logo` must be a `data:image/(png|jpeg|webp)` URI under the size cap** (reject SVG and oversized payloads). `upsertCenter` already exists in the repo — the route wraps it. The logo rides in the same JSON PATCH body as a data URI, so no separate multipart upload endpoint is needed for the PoC.

---

## 6. Touchpoint inventory (build checklist)

| File | Change |
|---|---|
| [src/app/globals.css](../src/app/globals.css) | Replace warm-cream/acorn defaults with **Brightwheel plain-bg + white-card neutrals + blurple accent** (keep token *names*); add `--radius` + card shadow. Applies to the whole app. |
| [src/lib/theme.ts](../src/lib) *(new)* + `theme.test.ts` | `deriveTheme`/contrast/hex-validate. Unit-tested. |
| [src/lib/types.ts](../src/lib/types.ts) | Add `display_name`, `brand_color`, `logo?`, `brand_emoji?`, `welcome_message?` to `Center`; tidy "AI Front Desk" comment. |
| [src/lib/schema.ts](../src/lib/schema.ts) + [scripts/migrate.ts](../scripts/migrate.ts) | Add the 5 new `center` columns. |
| [src/lib/repo/center.ts](../src/lib/repo/center.ts) | Carry new columns in upsert/select. |
| [src/lib/seed/data.ts](../src/lib/seed/data.ts) | Seed Little Acorns display_name/green/acorn (§4). |
| [src/app/layout.tsx](../src/app/layout.tsx) | Default metadata → generic **"Front Desk"**; optionally per-center dynamic title. |
| [src/app/page.tsx](../src/app/page.tsx) | Pass the full center identity (`name`, `display_name` + fallback, `brand_emoji`, `welcome_message`) & inject theme from `brand_color`. |
| [src/components/FrontDesk.tsx](../src/components/FrontDesk.tsx) | Header: business `name` (h1) + assistant `display_name` (subtitle) + **brand mark** = logo img → emoji → 🌰 (drop hardcoded 🌰 at :182, :292); `Welcome` greeting from `welcome_message` (drop hardcoded copy at :254). Props widen from `centerName` to a center object. Small reusable `<BrandMark>` (logo-or-emoji). |
| [src/app/handbook/page.tsx](../src/app/handbook/page.tsx) | Accent injection + `<BrandMark>` (drop 🌰 at :30) + name. |
| `src/components/admin/BrandingPanel.tsx` *(new)* + [src/app/admin/page.tsx](../src/app/admin/page.tsx) | New **Branding tab** in the nav (§5.1): edit form (business name, front-desk name, **logo upload**, emoji fallback, theme presets+hex, welcome) beside a **live parent preview**. Admin header keeps the Brightwheel mark (drop 🌰 at :39, :60). |
| `src/app/api/admin/center/route.ts` *(new)* + [src/lib/admin.ts](../src/lib/admin.ts) | `GET`/`PATCH` center identity, mock-passcode gated, hex + text validated; wraps existing `upsertCenter`. |
| `src/components/PoweredByBrightwheel.tsx` *(new)* + `public/brightwheel-mark.svg` | Reusable **Powered-by footer** (logo mark + `brightwheel` wordmark in the Avenir Next stack). Mounted on parent (`/`, `/handbook`) **and** admin. Always Layer A — not center-themed (§3.2). |
| [globals.css](../src/app/globals.css) | Add `--font-brand-wordmark: "AvenirNext","Helvetica Neue",Helvetica,Arial,sans-serif` for the wordmark only. |
| [src/app/favicon.ico](../src/app/favicon.ico) (+ optional `src/app/icon.svg` / `icon.tsx`) | Replace the stock Next.js favicon with the Brightwheel mark (default) or a dynamic per-center icon (fork §8b). |
| [README.md](../README.md), [CLAUDE.md](../CLAUDE.md) | Rename to "Front Desk," describe the component framing + two-layer theming. |
| [analysis/00](00-scope-and-bounds.md), [01](01-data-and-knowledge-model.md), [03](03-ux-flows.md) | Cross-link this stage; update visual-direction notes (03 §6b) to the two-layer model. |

**No change needed:** guardrails, model layer, relay, metrics, eval — branding is presentation-only and touches none of the answer/escalation logic.

---

## 7. How this maps to the evaluation axes

| Axis | How this stage earns it |
|---|---|
| **Persuasiveness** | "One component, every center" is the SaaS story a team funds — the live re-theme demo makes multi-tenant real, not claimed. |
| **User empathy** | Buyer sees *Brightwheel*; parent sees *their daycare*. Each audience gets the brand that reassures them. |
| **Uniqueness / craft** | Computed-contrast theming from one hex, token-only refactor, white-label from data — not a hardcoded skin. |
| **Scope** | Small, well-bounded change (name + color + logo + copy) that unlocks a disproportionately strong product narrative. |

---

## 8. Decisions & open forks

**Decided this stage:**
1. **Product name = "Front Desk"** (Brightwheel component); "AI" dropped from user-visible name.
2. **Brightwheel base look across the whole app** (§3): plain cool-neutral background + white cards + blurple default accent, both surfaces. The tenant controls **one accent color + logo/name/copy**; the structure stays Brightwheel. Same token names throughout.
3. **The admin console is the single place to edit everything parents see** — a dedicated **Branding tab** with a **live preview**, editing the tenant identity + copy (business name, assistant/front-desk name, **logo upload**, theme color, brand emoji, welcome message) on `Center`. `Settings` stays caution + provider.
4. **One tenant accent** → derived `--brand*` tokens with computed WCAG contrast; presets + custom input; **accent-only** (structure/canvas stays Brightwheel on both surfaces).
5. **Little Acorns seeds its current green as its tenant color** — demo continuity + a live white-label moment.
6. **"Powered by Brightwheel" footer on both surfaces**, always Brightwheel-branded (Layer A); wordmark in the site's **Avenir Next** stack, using the stack (not an embedded commercial webfont) in the PoC.

**Open forks (resolve at build):**
7. **Exact Brightwheel blurple hex** — confirm against official brand assets (Brandfetch was 403; working default `#6C4EE8`).
8. **Brightwheel logo mark SVG** — source the official mark for `public/brightwheel-mark.svg` (and the favicon); until then a faithful placeholder wheel mark.
8b. **Favicon** — static Brightwheel mark (recommended) vs. dynamic per-center `icon.tsx` from `brand_emoji` + `brand_color` (§3.2).
9. **Logo storage** — PoC uses a size-capped **raster data URI in the DB** (recommended: simplest, host-agnostic); scale path is a file on the Railway volume served by a route. Confirm the size cap (~256KB) and whether to auto-downscale on upload.
10. **Editable starters** — v1 keeps the 5 intent-bound starters fixed; letting the admin edit starter labels/questions is a natural next step (they're wired to intents, so needs care).
11. **Custom color guardrail** — presets-only vs. allow any hex (clamp with the contrast util). Lean allow-any, since the derive util already guarantees legibility.
