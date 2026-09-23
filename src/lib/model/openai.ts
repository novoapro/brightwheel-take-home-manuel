import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
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
 * OpenAI implementation of the FrontDeskModel seam (analysis/11 §3.4). Same §4
 * prompt, same §4.2 output schema, same downstream wrapper — only this adapter
 * differs. Uses structured outputs (JSON schema via `zodResponseFormat`) so the
 * contract matches the Claude/Gemini impls and `decide()` is untouched.
 *
 * Model ids are the GPT-5 family (registry defaults); confirm exact ids against
 * OpenAI's docs at build.
 */
export const OPENAI_ANSWERER_MODEL = "gpt-5";
export const OPENAI_JUDGE_MODEL = "gpt-5-mini";

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

export interface OpenAIConfig {
  apiKey?: string;
  answererModel?: string;
  judgeModel?: string;
  client?: OpenAI;
}

export class OpenAIFrontDeskModel implements FrontDeskModel {
  readonly provider = "openai" as const;
  readonly answererModel: string;
  private readonly judgeModel: string;
  private client: OpenAI;

  constructor(config: OpenAIConfig = {}) {
    // Explicit key from decrypted DB creds; else env OPENAI_API_KEY (fallback).
    this.client =
      config.client ?? (config.apiKey ? new OpenAI({ apiKey: config.apiKey }) : new OpenAI());
    this.answererModel = config.answererModel ?? OPENAI_ANSWERER_MODEL;
    this.judgeModel = config.judgeModel ?? OPENAI_JUDGE_MODEL;
  }

  async groundedAnswer(input: GroundedAnswerInput): Promise<GroundedResult> {
    const completion = await this.client.chat.completions.parse({
      model: this.answererModel,
      messages: [
        { role: "system", content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      response_format: zodResponseFormat(GroundedResultSchema, "grounded_result"),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      throw new Error("OpenAI answerer returned no parseable structured output");
    }
    return parsed;
  }

  async judgeGroundedness(input: JudgeInput): Promise<JudgeResult> {
    const sources = input.citedPolicies
      .map(
        (p) =>
          `[${p.id}] ${p.title}\n${p.body_md}\ndata: ${JSON.stringify(p.structured)}`,
      )
      .join("\n\n");

    const completion = await this.client.chat.completions.parse({
      model: this.judgeModel,
      messages: [
        {
          role: "system",
          content:
            "You grade whether an assistant's answer is fully supported by the provided policy sources. " +
            "groundedness = the fraction of the answer's factual claims that are directly supported by the SOURCES (0..1); " +
            "an answer that states any fact not in the sources scores low. " +
            "answer_relevancy = how well the answer addresses the QUESTION (0..1).",
        },
        {
          role: "user",
          content: `QUESTION:\n${input.question}\n\nANSWER:\n${input.answer}\n\nSOURCES:\n${sources}`,
        },
      ],
      response_format: zodResponseFormat(JudgeSchema, "judge_result"),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) {
      throw new Error("OpenAI judge returned no parseable structured output");
    }
    return parsed;
  }
}
