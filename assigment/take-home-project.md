# Assignment
Thank you for your time and interest in brightwheel. This exercise is a chance for you to engage with the kinds of challenges we’re solving. We are looking for engineers who can bridge the gap between "what is technically possible with AI" and "what is actually valuable for users."

Time limit: You have 3 business days to submit your exercise. We keep the window short to respect your time and to observe how you explore, iterate, and ship under scope constraints.

## Format 
Hosted URL for a prototype and explanation as a doc (<1 page) or video (< 2 mins)

Tools: We encourage you to use  AI acceleration tools (Claude Code, Cursor, V0, Replit, etc.) and free-tier large language models of your choice to rapidly explore, iterate, and create prototype software. We are not looking for production-ready code; we are looking for a "working proof of concept" that demonstrates your vision, problem understanding, taste, and technical judgment.

# Brightwheel Context

Brightwheel is the operating system for early education. While we don’t expect a deep understanding of our market (high level primer ([https://docs.google.com/document/d/1aLMQ77r2rQNsQdZ-U9VXpje1pWKZYJxtyJwCJ3H1TPc/edit?tab=t.0]), we do expect you to learn about  our customers: daycares/pre-Ks and the admin, teachers, and families they serve. Operators are busy small business owners and app users are anxious, deeply caring parents.

Problem Context: The "Front Desk" Bottleneck

School administrators spend hours every day answering very similar questions via phone, email, and text:

"Are you open on Veterans Day?"

"What is the tuition for infants?"

"My child has a fever, can they come in?"

“I forgot to pack lunch. Can you provide lunch today and what is it?”

“How can I schedule a tour?”

Parents want fast, accurate answers. Operators are busy and can’t always respond in real time. Handbooks are hard to search on a phone, and voicemail tags are frustrating. If brightwheel could provide an out-of-the-box AI Front Desk that correctly handles the majority of inquiries, it could save hours of admin time each week and meaningfully improve the parent experience.

# Task
Build a lightweight, mobile-friendly experience of a functional "AI Front Desk" prototype with two perspectives:

1) Parent experience (front desk):

Let a parent ask a question (text, voice, guided flow - your choice)

Provide an answer that is specific to the center and feels trustworthy

When uncertain or the question is sensitive, handle it gracefully

2) Operator experience (control center):

Give staff a way to provide or edit the source of truth

Show what questions are being asked and where the system struggled

Make it easy to improve the system over time (even if it’s simple)

Don’t use real personal data. Feel free to invent a fictional center and policies.

## Data / Grounding

Use any approach that fits your timebox:

Create a small structured dataset with policies and schedules

Build a tiny “handbook” page and ground answers from it

Optionally, use a public handbook as inspiration (no need to build perfect ingestion). Example: Albuquerque handbook.

We care more about response quality and trustworthiness than about document parsing.

# How you can spend your time

You have creative freedom to pick one area of focus:

Breadth: Parent chat + operator view + simple knowledge editing

Depth: A smaller set of intents, handled extremely well (edge cases, policy logic, escalation)

Novelty: A surprising interface or workflow based on real parent/operator pain

# What we’ll evaluate

Scope & completeness: Did you pick a realistic scope and finish it well?

Persuasiveness: Would this excite a team to fund and build for real?

User empathy: Does it reduce friction and make good decisions on behalf of users?

Uniqueness: Any insight, craft, or implementation detail that stands out?