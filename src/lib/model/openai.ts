import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { CacheTtl } from "../types";
import type {
  FrontDeskModel,
  GroundedAnswerInput,
  GroundedResult,
  JudgeInput,
  JudgeResult,
} from "./types";
import {
  GroundedResultSchema,
  JudgeSchema,
  JUDGE_SYSTEM_PROMPT,
  formatJudgeSources,
  formatJudgeUser,
} from "./shared";

/**
 * OpenAI implementation of the FrontDeskModel seam (analysis/11 §3.4). Same §4
 * prompt, same §4.2 output schema, same downstream wrapper — only this adapter
 * differs. Uses structured outputs (JSON schema via `zodResponseFormat`) so the
 * contract matches the Claude/Gemini impls and `decide()` is untouched.
 *
 * Model ids are the GPT-5 family (registry defaults); confirm exact ids against
 * OpenAI's docs at build.
 */
const OPENAI_ANSWERER_MODEL = "gpt-5";
const OPENAI_JUDGE_MODEL = "gpt-5-mini";

export interface OpenAIConfig {
  apiKey?: string;
  answererModel?: string;
  judgeModel?: string;
  /**
   * Accepted for a uniform provider seam (the factory passes the operator's
   * `cache_ttl` to every adapter). OpenAI prompt caching is automatic with no
   * developer-controlled TTL, so this is reserved here — kept so the seam stays
   * symmetric and the value is ready if explicit caching is added.
   */
  cacheTtl?: CacheTtl;
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
    const sources = formatJudgeSources(input.citedPolicies);

    const completion = await this.client.chat.completions.parse({
      model: this.judgeModel,
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: formatJudgeUser(input.question, input.answer, sources),
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
