import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { SENSITIVE_CATEGORIES } from "../types";
import type {
  FrontDeskModel,
  GroundedAnswerInput,
  GroundedResult,
  JudgeInput,
  JudgeResult,
} from "./types";

/**
 * Claude implementation of the FrontDeskModel seam (analysis/04 §6).
 *   Answerer: Sonnet 5 — grounded call, structured output, cached system prefix.
 *   Judge:    Haiku 4.5 — cheap groundedness score for the inline gate + async.
 *
 * Model choice is a deliberate project decision (CLAUDE.md, analysis/04 §9):
 * Sonnet 5 is latency/cost-right for a grounded FAQ chat; Opus stays reachable
 * via this same seam for hard cases.
 */
export const ANSWERER_MODEL = "claude-sonnet-5";
export const JUDGE_MODEL = "claude-haiku-4-5";

const GroundedResultSchema = z.object({
  intent: z.enum(["hours", "tuition", "health", "meals", "tours", "out_of_scope"]),
  is_case_specific: z.boolean(),
  sensitive_category: z.enum(SENSITIVE_CATEGORIES).nullable(),
  grounding_confidence: z.number().min(0).max(1),
  citations: z.array(z.string()),
  answer_intent: z.enum(["answer", "escalate"]),
  parent_message: z.string(),
});

const JudgeSchema = z.object({
  groundedness: z.number().min(0).max(1),
  answer_relevancy: z.number().min(0).max(1),
});

export class ClaudeFrontDeskModel implements FrontDeskModel {
  readonly provider = "claude" as const;
  readonly answererModel = ANSWERER_MODEL;
  private client: Anthropic;

  constructor(client?: Anthropic) {
    // Zero-arg client resolves ANTHROPIC_API_KEY / auth profile from the env.
    this.client = client ?? new Anthropic();
  }

  async groundedAnswer(input: GroundedAnswerInput): Promise<GroundedResult> {
    const response = await this.client.messages.parse({
      model: ANSWERER_MODEL,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      // Cache the stable prefix; pay input only for the (short) question.
      system: [
        {
          type: "text",
          text: input.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      output_config: {
        effort: "low",
        format: zodOutputFormat(GroundedResultSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error("Claude answerer returned no parseable structured output");
    }
    return parsed;
  }

  async judgeGroundedness(input: JudgeInput): Promise<JudgeResult> {
    const sources = input.citedPolicies
      .map(
        (p) =>
          `[${p.id}] ${p.title}\n${p.body_md}\ndata: ${JSON.stringify(
            p.structured,
          )}`,
      )
      .join("\n\n");

    const response = await this.client.messages.parse({
      model: JUDGE_MODEL,
      max_tokens: 500,
      system:
        "You grade whether an assistant's answer is fully supported by the provided policy sources. " +
        "groundedness = the fraction of the answer's factual claims that are directly supported by the SOURCES (0..1); " +
        "an answer that states any fact not in the sources scores low. " +
        "answer_relevancy = how well the answer addresses the QUESTION (0..1).",
      messages: [
        {
          role: "user",
          content: `QUESTION:\n${input.question}\n\nANSWER:\n${input.answer}\n\nSOURCES:\n${sources}`,
        },
      ],
      output_config: {
        effort: "low",
        format: zodOutputFormat(JudgeSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error("Claude judge returned no parseable structured output");
    }
    return parsed;
  }
}
