/**
 * Client-side mirrors of the relay JSON the admin API returns. Kept here so the
 * queue and the thread view share one definition instead of each redeclaring it.
 * These track the server shapes in src/lib/relay (queue.ts / thread.ts).
 */

/** One unanswered question within a session — a still-waiting escalation. */
export type PendingQuestion = {
  escalationId: string;
  question: string;
  intent: string | null;
  reason: string;
  isCaseSpecific: boolean;
  aiReferenced: string[];
  captureDefault: boolean;
  waitingSince: string;
};
