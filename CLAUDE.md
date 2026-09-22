# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **take-home interview project for Brightwheel**: build a hosted, mobile-friendly proof-of-concept of an **"AI Front Desk"** for early-education centers (daycares / pre-Ks). Deliverable is a hosted URL + a <1-page doc (or <2-min video). This is a *working proof of concept*, not production code — optimize for demonstrating vision, judgment, and taste over completeness or hardening.

Full brief: [take-home-project.md](take-home-project.md). Business domain primer: [business-primer.md](business-primer.md).

## Domain context (from the primer — use it to make sharper product calls)

- **Brightwheel is vertical SaaS for early childhood** (the years before kindergarten): daycare / preschool / nursery / after-school. Same playbook as Toast, ServiceTitan, MINDBODY — replacing paper + spreadsheets + a tangle of 15+ disconnected systems with one integrated product.
- **The market is huge and fragmented:** 850k+ providers in the U.S., ~$175B industry, and **~90% are independent providers** — small businesses, not big chains. Global footprint. So our fictional center should read as an *independent SMB*, and the AI Front Desk's value prop is "out-of-the-box, works for a center that has no IT staff."
- **Three user groups, each with a distinct stake:**
  - **Owner/Administrator** — runs the day-to-day, *usually the buyer*. This is who the operator control center serves; frame ROI as hours saved and load lifted off a busy owner.
  - **Teachers** — heaviest daily mobile users; interact with everyone.
  - **Parents** — the end customer. Childcare is the **#1–2 household expense** for families with kids under 6 and a must for working families → their questions carry real financial and emotional weight. This is why trust and warmth are non-negotiable.
- **What makes Brightwheel unique, and what our prototype should echo:** (a) it's essentially a *consumer product* with daily emotional touchpoints; (b) **customer love** — teachers and parents genuinely love it. The Front Desk must feel warm and delightful, not like an IVR phone tree or a cold chatbot.
- **The provider's world is uniquely hard:** every center juggles the classroom, *strict government licensing/regulations*, and running a business at once. Time saved at the front desk is time returned to any of these — lead with that in the pitch.
- **Relevant leadership principles to echo in craft:** *Deliver Value for Customers* (earn trust through service), *Less-is-more scrappiness* ("accomplish more with less"), and a strong **bias for action**.

## The problem being solved

Center admins lose hours daily answering repetitive parent questions by phone/email/text — hours, closures, tuition, sick-child policy, lunch, tour scheduling. Parents want fast, accurate, trustworthy answers; handbooks are unsearchable on a phone. The prototype must **absorb the majority of routine inquiries** so the front desk handles less volume without losing quality or warmth.

Two user types, with opposite emotional states — design for both:
- **Parents**: anxious, deeply caring. Need answers that feel fast, specific to *their* center, and trustworthy.
- **Operators/admins**: busy small-business owners. Need low-effort ways to curate the source of truth and see where the system struggles.

## Scope (two perspectives — build both, but pick a depth focus)

1. **Parent experience (the front desk):** ask a question (text / voice / guided flow — our choice); get a center-specific, trustworthy answer; **degrade gracefully when uncertain or when the question is sensitive** (health, safety, billing disputes, incidents) by escalating to a human rather than guessing.
2. **Operator experience (the control center):** edit the source of truth; see what's being asked and where the system struggled; make it easy to improve over time.

Evaluation axes: **scope & completeness, persuasiveness (would a team fund this?), user empathy, uniqueness/craft.**

## Guiding principles for our decisions

- **Less is more.** A smaller set of intents handled *extremely* well beats broad-but-shallow. Prefer depth and edge-case handling (policy logic, escalation) — this is our chosen edge unless we deliberately change it.
- **Trust is the product.** Answers must be *grounded* in the center's own policies and visibly attributable ("per the handbook: …"). Never hallucinate a policy. When grounding is thin or the topic is sensitive, escalate — a graceful handoff beats a confident wrong answer.
- **Minimize human effort, keep quality high.** Every feature should measurably reduce front-desk load while preserving the warmth parents expect. The operator's curation loop (see struggles → fix source of truth) is what makes deflection compound over time — treat it as core, not a dashboard afterthought.
- **Mobile-first, web.** Parents ask from a phone. Design and test at phone widths first.
- **Fictional data only.** Invent a center, its policies, and schedules. No real personal data. A small structured policy dataset / tiny "handbook" is enough grounding — response quality matters more than document-ingestion sophistication.

## Tech stack & commands

Not yet chosen — the workspace currently contains only the brief and an empty `analysis/` folder. When we scaffold the app, record the run / build / test / lint / deploy (hosting) commands here so future sessions can build, run a single test, and ship the hosted URL. Bias toward a stack that deploys to a public URL trivially (the deliverable is a *hosted* prototype).

## Claude API usage

The grounded-answer + escalation logic is LLM-driven. Before writing or changing any model-integration code, consult the `claude-api` skill for current model IDs, tool-use, and grounding/caching patterns — default to the latest capable Claude model.
