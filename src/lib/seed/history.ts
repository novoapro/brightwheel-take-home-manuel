import type { Database } from "better-sqlite3";
import { upsertEntry } from "../repo/knowledge";
import { createConversation } from "../repo/conversations";
import { appendMessage } from "../repo/messages";
import { insertDebugEnvelope } from "../repo/debug";
import { recomputeMetrics } from "../repo/metrics_rollup";
import { updateSettings } from "../repo/settings";

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
  capturedEntries: number;
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

/**
 * A few fully-realized demo sessions for the Audit surface (analysis/05 §5) —
 * real threads with a session rating + (for the non-👍 ones) a retained "what we
 * sent / what we expected" envelope. Built by *promoting existing* history rows
 * into sessions (re-pointing their session_id/conversation_id), so the metric
 * totals stay unchanged. Envelopes are seeded only for sessions that did not get
 * a 👍 — exactly what `flagged` retention would leave behind.
 */
const DEMO_SESSIONS = [
  {
    sid: "hist-sess-1",
    conv: "hist-conv-1",
    name: "Jordan Rivera",
    email: "jordan.rivera@example.com",
    closed_reason: "parent",
    rating: "up" as const,
    review: null as string | null,
    turns: [
      { auditId: "hist-a-0", intent: "hours", q: "When do you open?", a: "We're open Monday–Friday, 7:00 AM to 6:00 PM.", answered: true, citations: ["hours.regular"] },
      { auditId: "hist-a-1", intent: "hours", q: "Are you open on Veterans Day?", a: "We're closed on Veterans Day (November 11).", answered: true, citations: ["hours.holidays.2026"] },
    ],
  },
  {
    sid: "hist-sess-2",
    conv: "hist-conv-2",
    name: "Priya Shah",
    email: "priya.shah@example.com",
    closed_reason: "parent",
    rating: "down" as const,
    review: "I still wasn't sure whether my son could come in — it took a while.",
    turns: [
      { auditId: "hist-a-5", intent: "health", q: "What is your fever policy?", a: "Children must be fever-free (under 100.4°F) for 24 hours, without medication, before returning.", answered: true, citations: ["health.illness_exclusion"] },
      { auditId: "hist-case-0-a", intent: "health", q: "My son had a fever last night, can he come in?", a: "Let me check with our team on your specific case.", answered: false, citations: ["health.illness_exclusion"] },
    ],
  },
  {
    sid: "hist-sess-3",
    conv: "hist-conv-3",
    name: "Marcus Lee",
    email: "marcus.lee@example.com",
    closed_reason: "inactivity",
    rating: null as "up" | "down" | null,
    review: null as string | null,
    turns: [
      { auditId: "hist-a-3", intent: "tuition", q: "How much is tuition?", a: "Infant care is $1,650/month; each age group has its own rate — see the tuition schedule.", answered: true, citations: ["tuition.rates"] },
    ],
  },
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
  const insertSession = db.prepare(
    `INSERT INTO parent_sessions
       (id, name, email, status, conversation_id, created_at, last_active_at,
        closed_at, closed_reason, rating, review, rated_at)
     VALUES
       (@id, @name, @email, 'closed', @conversation_id, @created_at, @last_active_at,
        @closed_at, @closed_reason, @rating, @review, @rated_at)`,
  );
  const repointAudit = db.prepare(
    `UPDATE interaction_audit SET session_id = @sid, conversation_id = @conv WHERE id = @auditId`,
  );
  const insertEsc = db.prepare(
    `INSERT INTO escalations
       (id, interaction_id, question, detected_intent, reason, status,
        operator_answer, answered_by, answered_at, promoted_entry_id, created_at)
     VALUES
       (@id, @interaction_id, @question, @detected_intent, @reason, @status,
        @operator_answer, @answered_by, @answered_at, @promoted_entry_id, @created_at)`,
  );

  const run = db.transaction(() => {
    // Clear prior history so re-seeding doesn't duplicate. FK-safe order:
    // children (messages, debug, escalations) before the audit rows they
    // reference, then the conversations/sessions those hang off.
    db.prepare(`DELETE FROM messages WHERE id LIKE 'hist-%'`).run();
    db.prepare(`DELETE FROM interaction_debug WHERE interaction_id LIKE 'hist-%'`).run();
    db.prepare(`DELETE FROM escalations WHERE id LIKE 'hist-%'`).run();
    db.prepare(`DELETE FROM interaction_audit WHERE id LIKE 'hist-%'`).run();
    db.prepare(`DELETE FROM parent_sessions WHERE id LIKE 'hist-%'`).run();
    db.prepare(`DELETE FROM conversations WHERE id LIKE 'hist-%'`).run();
    db.prepare(`DELETE FROM knowledge_entries WHERE id LIKE 'captured.seed.%'`).run();

    // Demo fixture: turn on developer mode + `flagged` retention so the Audit tab
    // is populated and coherent out of the box (the product defaults are off).
    updateSettings(db, { developer_mode: true, audit_mode: "flagged" });

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
    upsertEntry(db, {
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
      promoted_entry_id: "captured.seed.summer-camp",
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
          promoted_entry_id: null,
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
          promoted_entry_id: null,
          created_at: ts(k % 7, c),
        });
        escalations++;
        c++;
      }
    }

    // Promote a few history rows into fully-realized, rated demo sessions so the
    // Audit surface renders live (analysis/05 §5). No new audit rows → totals hold.
    for (let i = 0; i < DEMO_SESSIONS.length; i++) {
      const s = DEMO_SESSIONS[i];
      const when = ts(0, DEMO_SESSIONS.length - i); // recent, distinct per session
      createConversation(db, { id: s.conv, session_id: s.sid, active_provider: "anthropic" });
      insertSession.run({
        id: s.sid,
        name: s.name,
        email: s.email,
        conversation_id: s.conv,
        created_at: when,
        last_active_at: when,
        closed_at: when,
        closed_reason: s.closed_reason,
        rating: s.rating,
        review: s.review,
        rated_at: s.rating ? when : null,
      });
      for (const turn of s.turns) {
        repointAudit.run({ sid: s.sid, conv: s.conv, auditId: turn.auditId });
        appendMessage(db, {
          id: `hist-msg-${turn.auditId}-q`,
          conversation_id: s.conv,
          role: "parent",
          text: turn.q,
        });
        appendMessage(db, {
          id: `hist-msg-${turn.auditId}-a`,
          conversation_id: s.conv,
          role: "frontdesk",
          provenance: turn.answered ? "grounded" : null,
          text: turn.a,
          citations: turn.answered ? [...turn.citations] : [],
        });
        // `flagged` retention keeps detail only for sessions without a 👍.
        if (s.rating !== "up") {
          insertDebugEnvelope(db, {
            interaction_id: turn.auditId,
            system_prompt:
              "[seeded] Little Acorns Front Desk system prefix — persona, center facts, and all published policies (prompt-cached).",
            messages: [{ role: "user", content: turn.q }],
            raw_proposal: {
              intent: turn.intent,
              is_case_specific: !turn.answered,
              sensitive_category: turn.answered ? null : "health",
              grounding_confidence: turn.answered ? 0.95 : 0.4,
              citations: [...turn.citations],
              answer_intent: turn.answered ? "answer" : "escalate",
              parent_message: turn.a,
            },
          });
        }
      }
    }

    // Build the Dashboard rollup from everything just seeded (the live fold path
    // isn't exercised during seeding).
    recomputeMetrics(db);

    return { audits, escalations, capturedEntries: 1 };
  });

  return run();
}
