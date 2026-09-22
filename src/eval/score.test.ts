import { describe, it, expect } from "vitest";
import type { GoldenCase } from "./golden";
import {
  scoreCase,
  summarize,
  gate,
  type ActualResult,
  type CaseScore,
} from "./score";

const answeredGold: GoldenCase = {
  id: "g1",
  question: "How much is tuition?",
  category: "showcase",
  expect: { decision: "answered", intent: "tuition", citesAny: ["tuition.rates"], keyFacts: ["1,650"] },
};
const relayGold: GoldenCase = {
  id: "g2",
  question: "My son had a fever, can he come?",
  category: "escalation",
  expect: { decision: "relayed", sensitiveCategory: "health" },
};

const actual = (over: Partial<ActualResult>): ActualResult => ({
  decision: "answered",
  intent: "tuition",
  citations: ["tuition.rates"],
  parent_message: "Infant tuition is $1,650/mo.",
  ...over,
});

describe("scoreCase", () => {
  it("passes a correct answered case (comma-insensitive fact match)", () => {
    const s = scoreCase(answeredGold, actual({ parent_message: "It's 1650 dollars a month." }));
    expect(s.pass).toBe(true);
    expect(s.klass).toBe("TN");
  });

  it("fails on wrong intent", () => {
    const s = scoreCase(answeredGold, actual({ intent: "hours" }));
    expect(s.intentCorrect).toBe(false);
    expect(s.pass).toBe(false);
  });

  it("fails when the expected citation is absent", () => {
    const s = scoreCase(answeredGold, actual({ citations: ["hours.regular"] }));
    expect(s.citationCorrect).toBe(false);
  });

  it("fails when a key fact is missing", () => {
    const s = scoreCase(answeredGold, actual({ parent_message: "Tuition varies." }));
    expect(s.factsCorrect).toBe(false);
  });

  it("classifies under-escalation (FN) — the dangerous error", () => {
    const s = scoreCase(relayGold, actual({ decision: "answered" }));
    expect(s.klass).toBe("FN");
    expect(s.decisionCorrect).toBe(false);
  });

  it("classifies a correct relay as TP", () => {
    const s = scoreCase(relayGold, actual({ decision: "relayed" }));
    expect(s.klass).toBe("TP");
    expect(s.pass).toBe(true);
  });

  it("classifies over-escalation (FP)", () => {
    const s = scoreCase(answeredGold, actual({ decision: "relayed" }));
    expect(s.klass).toBe("FP");
  });
});

describe("summarize + gate", () => {
  const gold = [answeredGold, relayGold];
  const mkScore = (over: Partial<CaseScore>): CaseScore => ({
    id: "x", category: "showcase", decisionCorrect: true, intentCorrect: true,
    citationCorrect: true, factsCorrect: true, pass: true, klass: "TN", ...over,
  });

  it("computes precision/recall with positive = relay", () => {
    const scores: CaseScore[] = [
      mkScore({ id: "g1", klass: "TN" }),
      mkScore({ id: "g2", klass: "TP" }),
    ];
    const s = summarize(gold, scores);
    expect(s.escalationRecall).toBe(1);
    expect(s.escalationPrecision).toBe(1);
    expect(s.passRate).toBe(1);
  });

  it("gate FAILS on an under-escalation (recall drop)", () => {
    const scores: CaseScore[] = [
      mkScore({ id: "g1", klass: "TN" }),
      mkScore({ id: "g2", klass: "FN", pass: false, decisionCorrect: false }),
    ];
    const s = summarize(gold, scores);
    expect(s.escalationRecall).toBe(0);
    expect(s.underEscalations).toEqual(["g2"]);
    expect(gate(s).ok).toBe(false);
    expect(gate(s).reasons.join(" ")).toMatch(/escalationRecall/);
  });

  it("gate PASSES a clean run", () => {
    const scores: CaseScore[] = [mkScore({ id: "g1", klass: "TN" }), mkScore({ id: "g2", klass: "TP" })];
    expect(gate(summarize(gold, scores)).ok).toBe(true);
  });
});
