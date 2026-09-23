import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import { createMemoryDb } from "../db";
import { listPublishedEntries } from "../repo/knowledge";
import { seedDatabase } from "../seed";
import { relayMessage } from "../model/prompt";
import type { GroundedResult } from "../model/types";
import type { KnowledgeEntry } from "../types";
import { decide, type DecideContext } from "./decide";

let db: Database;
let policies: KnowledgeEntry[];

beforeEach(() => {
  db = createMemoryDb();
  seedDatabase(db);
  policies = listPublishedEntries(db);
});

/** A well-grounded, non-sensitive answer proposal with no risky facts. */
function mk(overrides: Partial<GroundedResult> = {}): GroundedResult {
  return {
    intent: "hours",
    is_case_specific: false,
    sensitive_category: null,
    grounding_confidence: 0.95,
    citations: ["hours.regular"],
    answer_intent: "answer",
    parent_message: "We're open Monday through Friday.",
    ...overrides,
  };
}

/** Context with a spy judge whose score is configurable per test. */
function ctxWith(
  groundedness = 0.95,
  caution: DecideContext["caution"] = "balanced",
) {
  const state = { calls: 0 };
  const ctx: DecideContext = {
    question: "test question",
    publishedPolicies: policies,
    caution,
    judge: async () => {
      state.calls++;
      return { groundedness, answer_relevancy: 1 };
    },
    relayMessage,
  };
  return { ctx, state };
}

describe("decide — hard routes (3a)", () => {
  it("relays out_of_scope questions", async () => {
    const { ctx } = ctxWith();
    const d = await decide(mk({ intent: "out_of_scope" }), ctx);
    expect(d.decision).toBe("relayed");
    expect(d.reason).toBe("out_of_scope");
  });

  it("floor-locks HARD_SENSITIVE (safety) even at high confidence & answer intent", async () => {
    const { ctx, state } = ctxWith(0.99, "lean");
    const d = await decide(
      mk({
        intent: "hours",
        sensitive_category: "safety",
        grounding_confidence: 0.99,
        answer_intent: "answer",
        parent_message: "Yes, absolutely, come right in.",
      }),
      ctx,
    );
    expect(d.decision).toBe("relayed");
    expect(d.reason).toBe("sensitive:safety");
    expect(state.calls).toBe(0); // never bothered the judge
    // the suspect answer is suppressed — parent sees the template, not the model text
    expect(d.parent_message).not.toContain("come right in");
  });

  it("relays a case-specific health question (sensitive intent)", async () => {
    const { ctx } = ctxWith();
    const d = await decide(
      mk({ intent: "health", is_case_specific: true, citations: ["health.illness_exclusion"] }),
      ctx,
    );
    expect(d.reason).toBe("sensitive:case_specific");
  });

  it("relays a case-specific billing question (non-hard category)", async () => {
    const { ctx } = ctxWith();
    const d = await decide(
      mk({ intent: "tuition", sensitive_category: "billing", is_case_specific: true }),
      ctx,
    );
    expect(d.reason).toBe("sensitive:case_specific");
  });

  it("ANSWERS a general (non-case-specific) health policy question", async () => {
    const { ctx } = ctxWith(0.95);
    const d = await decide(
      mk({
        intent: "health",
        is_case_specific: false,
        grounding_confidence: 0.95,
        citations: ["health.illness_exclusion"],
        parent_message: "Please keep your child home if they have a fever.",
      }),
      ctx,
    );
    expect(d.decision).toBe("answered");
  });
});

describe("decide — citation validity (3b)", () => {
  it("relays when there are no citations", async () => {
    const { ctx } = ctxWith();
    const d = await decide(mk({ citations: [] }), ctx);
    expect(d.reason).toBe("no_citation");
    expect(d.checks.citation_valid).toBe("fail");
  });

  it("relays when a citation id isn't a published policy", async () => {
    const { ctx } = ctxWith();
    const d = await decide(mk({ citations: ["hours.ghost"] }), ctx);
    expect(d.reason).toBe("invalid_citation");
    expect(d.checks.citation_valid).toBe("fail");
  });
});

describe("decide — deterministic fact verification (3c)", () => {
  it("relays fact_mismatch on a wrong number and reports the unsupported fact", async () => {
    const { ctx } = ctxWith();
    const d = await decide(
      mk({
        intent: "hours",
        citations: ["hours.late_pickup"],
        parent_message: "Late pickup is $25 per occurrence.",
      }),
      ctx,
    );
    expect(d.reason).toBe("fact_mismatch");
    expect(d.checks.fact_match).toBe("fail");
    expect(d.unsupported_facts?.some((f) => f.normals.includes("25"))).toBe(true);
  });

  it("passes correct facts", async () => {
    const { ctx } = ctxWith();
    const d = await decide(
      mk({
        citations: ["hours.late_pickup"],
        parent_message: "Late pickup is $15 per occurrence; after 3 we ask for a conference.",
      }),
      ctx,
    );
    expect(d.decision).toBe("answered");
    expect(d.checks.fact_match).toBe("pass");
  });
});

describe("decide — confidence + groundedness gates (3d, 3e)", () => {
  it("relays below_threshold when confidence < τ (non-sensitive)", async () => {
    const { ctx, state } = ctxWith();
    const d = await decide(mk({ grounding_confidence: 0.7 }), ctx); // τ=0.75
    expect(d.reason).toBe("below_threshold");
    expect(state.calls).toBe(0);
  });

  it("does NOT call the judge for a well-grounded non-sensitive answer", async () => {
    const { ctx, state } = ctxWith();
    const d = await decide(mk({ grounding_confidence: 0.95 }), ctx); // >= τ+0.1
    expect(d.decision).toBe("answered");
    expect(d.checks.groundedness_gate).toBe("skipped");
    expect(state.calls).toBe(0);
  });

  it("calls the judge on borderline confidence (τ ≤ conf < τ+0.1)", async () => {
    const { ctx, state } = ctxWith(0.9);
    const d = await decide(mk({ grounding_confidence: 0.8 }), ctx); // τ=0.75, band 0.75–0.85
    expect(state.calls).toBe(1);
    expect(d.decision).toBe("answered");
    expect(d.checks.groundedness_gate).toBe("pass");
    expect(d.groundedness).toBe(0.9);
  });

  it("always runs the judge for sensitive intents and holds them to ≥0.9", async () => {
    const passing = ctxWith(0.95);
    const ok = await decide(
      mk({
        intent: "health",
        grounding_confidence: 0.95,
        citations: ["health.illness_exclusion"],
        parent_message: "Please keep your child home with a fever.",
      }),
      passing.ctx,
    );
    expect(passing.state.calls).toBe(1);
    expect(ok.decision).toBe("answered");

    const failing = ctxWith(0.85); // below the 0.9 sensitive floor
    const bad = await decide(
      mk({
        intent: "health",
        grounding_confidence: 0.95,
        citations: ["health.illness_exclusion"],
        parent_message: "Please keep your child home with a fever.",
      }),
      failing.ctx,
    );
    expect(bad.reason).toBe("low_groundedness");
    expect(bad.checks.groundedness_gate).toBe("fail");
    expect(bad.groundedness).toBe(0.85);
  });

  it("sensitive τ is higher: health at 0.85 confidence relays below_threshold", async () => {
    const { ctx, state } = ctxWith();
    const d = await decide(
      mk({
        intent: "health",
        grounding_confidence: 0.85, // < sensitive τ (0.9)
        citations: ["health.illness_exclusion"],
        parent_message: "Keep your child home with a fever.",
      }),
      ctx,
    );
    expect(d.reason).toBe("below_threshold");
    expect(state.calls).toBe(0); // 3d relays before the judge runs
  });
});

describe("decide — relay copy", () => {
  it("uses the templated holding message, never the model's suspect text", async () => {
    const { ctx } = ctxWith();
    const d = await decide(
      mk({ citations: [], parent_message: "Definitely yes, no problem at all." }),
      ctx,
    );
    expect(d.parent_message).not.toContain("Definitely yes");
    expect(d.parent_message.toLowerCase()).toContain("team");
  });
});

describe("decide — greetings & small talk (social)", () => {
  it("answers a clean greeting warmly, with no citation and no relay", async () => {
    const { ctx, state } = ctxWith();
    const d = await decide(
      mk({
        intent: "social",
        citations: [],
        parent_message: "Hi! How can I help you today?",
      }),
      ctx,
    );
    expect(d.decision).toBe("answered");
    expect(d.reason).toBe("social");
    expect(d.citations).toEqual([]);
    expect(d.parent_message).toContain("Hi!");
    expect(state.calls).toBe(0); // no judge call — nothing to ground
  });

  it("relays a 'social' reply that smuggles a policy fact (no ungrounded numbers)", async () => {
    const { ctx } = ctxWith();
    const d = await decide(
      mk({
        intent: "social",
        citations: [],
        parent_message: "Hi! We open at 7:00, see you then.",
      }),
      ctx,
    );
    expect(d.decision).toBe("relayed");
    expect(d.reason).toBe("fact_mismatch");
    expect(d.checks.fact_match).toBe("fail");
  });

  it("still escalates a hard-sensitive message even if mislabeled social", async () => {
    const { ctx } = ctxWith();
    const d = await decide(
      mk({
        intent: "social",
        citations: [],
        sensitive_category: "safety",
        parent_message: "Hi there!",
      }),
      ctx,
    );
    expect(d.decision).toBe("relayed");
    expect(d.reason).toBe("sensitive:safety");
  });

  it("escalates a case-specific message with a sensitive category over the social lane", async () => {
    const { ctx } = ctxWith();
    const d = await decide(
      mk({
        intent: "social",
        citations: [],
        is_case_specific: true,
        sensitive_category: "billing",
        parent_message: "Hey!",
      }),
      ctx,
    );
    expect(d.decision).toBe("relayed");
    expect(d.reason).toBe("sensitive:case_specific");
  });
});
