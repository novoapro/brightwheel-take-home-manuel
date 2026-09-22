import type { Database } from "better-sqlite3";
import { upsertPolicy } from "../repo/policies";

/**
 * Seed a realistic week of history (analysis/05 §6 decision) so the operator
 * dashboard, top-gaps, and the compounding-loop story render live in the demo —
 * without needing to run real LLM traffic first.
 *
 * Idempotent: clears its own `hist-*` rows (and the captured demo policy) before
 * re-inserting, so `npm run db:seed` is safe to run repeatedly. Historical audit
 * rows use conversation_id = NULL (allowed) so we don't fabricate full threads.
 */

const DAY_MS = 86_400_000;

interface SeedResultHistory {
  audits: number;
  escalations: number;
  capturedPolicies: number;
}

const ANSWER_TEMPLATES = [
  { intent: "hours", q: "When do you open?", cite: ["hours.regular"] },
  { intent: "hours", q: "Are you open on Veterans Day?", cite: ["hours.holidays.2026"] },
  { intent: "hours", q: "What if I'm late picking up?", cite: ["hours.late_pickup"] },
  { intent: "tuition", q: "How much is tuition?", cite: ["tuition.rates"] },
  { intent: "tuition", q: "When is tuition due?", cite: ["tuition.payment"] },
  { intent: "health", q: "What is your fever policy?", cite: ["health.illness_exclusion"] },
  { intent: "health", q: "When can my child return after being sick?", cite: ["health.return_to_care"] },
  { intent: "meals", q: "Do you provide lunch?", cite: ["meals.provided"] },
  { intent: "meals", q: "Can I bring outside food?", cite: ["meals.outside_food"] },
  { intent: "tours", q: "How do I schedule a tour?", cite: ["tours.scheduling"] },
  { intent: "tours", q: "What documents do I need to enroll?", cite: ["enroll.requirements"] },
] as const;

// Recurring knowledge gaps (add-a-policy candidates) and case-specific relays.
const GAPS = [
  { q: "Do you offer part-time schedules?", intent: "out_of_scope", count: 5, waiting: 1 },
  { q: "Do you have a nut-free classroom?", intent: "out_of_scope", count: 3, waiting: 1 },
  { q: "Do you have webcams in the classrooms?", intent: "out_of_scope", count: 2, waiting: 0 },
] as const;

const CASES = [
  { q: "My son had a fever last night, can he come in?", intent: "health", count: 2 },
  { q: "I want to dispute a late fee on my bill.", intent: "tuition", count: 1 },
] as const;

export function seedHistory(db: Database): SeedResultHistory {
  const base = Date.now();
  const ts = (daysAgo: number, seq: number) =>
    new Date(base - daysAgo * DAY_MS - seq * 3_600_000).toISOString();

  const insertAuditRow = db.prepare(
    `INSERT INTO interaction_audit
       (id, session_id, conversation_id, timestamp, parent_question,
        detected_intent, decision, decision_reason, confidence, provider, model,
        response_text, cited_sources, checks, latency_first_response_ms,
        parent_feedback, judge_scores)
     VALUES
       (@id, @session_id, NULL, @timestamp, @parent_question,
        @detected_intent, @decision, @decision_reason, @confidence, 'claude',
        'claude-sonnet-5', @response_text, @cited_sources, NULL, @latency,
        @parent_feedback, @judge_scores)`,
  );
  const insertEsc = db.prepare(
    `INSERT INTO escalations
       (id, interaction_id, question, detected_intent, reason, status,
        operator_answer, answered_by, answered_at, promoted_policy_id, created_at)
     VALUES
       (@id, @interaction_id, @question, @detected_intent, @reason, @status,
        @operator_answer, @answered_by, @answered_at, @promoted_policy_id, @created_at)`,
  );

  const run = db.transaction(() => {
    // Clear prior history so re-seeding doesn't duplicate.
    db.prepare(`DELETE FROM escalations WHERE id LIKE 'hist-%'`).run();
    db.prepare(`DELETE FROM interaction_audit WHERE id LIKE 'hist-%'`).run();
    db.prepare(`DELETE FROM policies WHERE id LIKE 'captured.seed.%'`).run();

    let audits = 0;
    let escalations = 0;

    // Answered interactions across the week (containment).
    for (let i = 0; i < 42; i++) {
      const t = ANSWER_TEMPLATES[i % ANSWER_TEMPLATES.length];
      const feedback = i % 6 === 0 ? "down" : i % 2 === 0 ? "up" : null;
      insertAuditRow.run({
        id: `hist-a-${i}`,
        session_id: `hist-s-${i}`,
        timestamp: ts(i % 7, i),
        parent_question: t.q,
        detected_intent: t.intent,
        decision: "answered",
        decision_reason: "grounded",
        confidence: 0.95,
        response_text: t.q,
        cited_sources: JSON.stringify(t.cite),
        latency: 900 + (i % 5) * 120,
        parent_feedback: feedback,
        judge_scores: JSON.stringify({
          groundedness: Number((0.9 + (i % 9) * 0.01).toFixed(2)),
          answer_relevancy: 0.96,
        }),
      });
      audits++;
    }

    // A previously-captured gap (the loop already tightened once): summer camp.
    upsertPolicy(db, {
      id: "captured.seed.summer-camp",
      intent: "hours",
      title: "Do you have a summer camp?",
      body_md:
        "Yes! We run a summer camp for ages 3–5 from June through August, with weekly themes, water play, and field trips. Ask the front desk for this summer's dates and pricing.",
      structured: {},
      keywords: ["summer", "camp", "june", "july", "august"],
      status: "published",
      origin: "captured",
      source: "Added from a family question",
      updated_by: "Maria",
    });

    // Its capture came from an answered escalation.
    insertAuditRow.run({
      id: "hist-cap-0",
      session_id: "hist-cap-s",
      timestamp: ts(6, 3),
      parent_question: "Do you have a summer camp?",
      detected_intent: "out_of_scope",
      decision: "escalated",
      decision_reason: "out_of_scope",
      confidence: 0,
      response_text: "Let me check with our team.",
      cited_sources: "[]",
      latency: 1100,
      parent_feedback: null,
      judge_scores: null,
    });
    audits++;
    insertEsc.run({
      id: "hist-cap-e",
      interaction_id: "hist-cap-0",
      question: "Do you have a summer camp?",
      detected_intent: "out_of_scope",
      reason: "out_of_scope",
      status: "answered",
      operator_answer: "Yes! We run a summer camp for ages 3–5, June–August.",
      answered_by: "Maria",
      answered_at: ts(6, 2),
      promoted_policy_id: "captured.seed.summer-camp",
      created_at: ts(6, 4),
    });
    escalations++;

    // Recurring open gaps (add-a-policy candidates).
    let g = 0;
    for (const gap of GAPS) {
      for (let k = 0; k < gap.count; k++) {
        const id = `hist-gap-${g}`;
        const waiting = k < gap.waiting;
        insertAuditRow.run({
          id: `${id}-a`,
          session_id: `hist-gs-${g}`,
          timestamp: ts(k % 7, g),
          parent_question: gap.q,
          detected_intent: gap.intent,
          decision: "escalated",
          decision_reason: "out_of_scope",
          confidence: 0,
          response_text: "Let me check with our team.",
          cited_sources: "[]",
          latency: 1000,
          parent_feedback: null,
          judge_scores: null,
        });
        audits++;
        insertEsc.run({
          id,
          interaction_id: `${id}-a`,
          question: gap.q,
          detected_intent: gap.intent,
          reason: "out_of_scope",
          status: waiting ? "waiting" : "answered",
          operator_answer: waiting ? null : "Thanks for asking — here's the info…",
          answered_by: waiting ? null : "Maria",
          answered_at: waiting ? null : ts(k % 7, g),
          promoted_policy_id: null,
          created_at: ts(k % 7, g),
        });
        escalations++;
        g++;
      }
    }

    // Case-specific relays (never add-a-policy candidates).
    let c = 0;
    for (const cs of CASES) {
      for (let k = 0; k < cs.count; k++) {
        const id = `hist-case-${c}`;
        insertAuditRow.run({
          id: `${id}-a`,
          session_id: `hist-cs-${c}`,
          timestamp: ts(k % 7, c),
          parent_question: cs.q,
          detected_intent: cs.intent,
          decision: "escalated",
          decision_reason: "sensitive:case_specific",
          confidence: 0.9,
          response_text: "Let me check with our team on your specific case.",
          cited_sources: cs.intent === "health" ? JSON.stringify(["health.illness_exclusion"]) : "[]",
          latency: 1000,
          parent_feedback: null,
          judge_scores: null,
        });
        audits++;
        insertEsc.run({
          id,
          interaction_id: `${id}-a`,
          question: cs.q,
          detected_intent: cs.intent,
          reason: "sensitive:case_specific",
          status: "answered",
          operator_answer: "A staff member followed up directly.",
          answered_by: "Maria",
          answered_at: ts(k % 7, c),
          promoted_policy_id: null,
          created_at: ts(k % 7, c),
        });
        escalations++;
        c++;
      }
    }

    return { audits, escalations, capturedPolicies: 1 };
  });

  return run();
}
