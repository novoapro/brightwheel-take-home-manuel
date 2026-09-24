import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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
import { type CacheTtl, DEFAULT_CACHE_TTL } from "../types";

/**
 * Claude implementation of the FrontDeskModel seam (analysis/04 §6).
 *   Answerer: Sonnet 5 — grounded call, structured output, cached system prefix.
 *   Judge:    Haiku 4.5 — cheap groundedness score for the inline gate + async.
 *
 * Model choice is a deliberate project decision (CLAUDE.md, analysis/04 §9):
 * Sonnet 5 is latency/cost-right for a grounded FAQ chat; Opus stays reachable
 * via this same seam for hard cases.
 */
const ANSWERER_MODEL = "claude-sonnet-5";
const JUDGE_MODEL = "claude-haiku-4-5";

export interface ClaudeConfig {
  /** Explicit key (from decrypted DB creds); falls back to env when absent. */
  apiKey?: string;
  answererModel?: string;
  judgeModel?: string;
  /**
   * Prompt-cache TTL for the system prefix ("5m" | "1h"). Operator-configured
   * (Settings ▸ AI Assistant → the `cache_ttl` setting); the factory passes the
   * stored value. Defaults to 1h. See {@link CacheTtl} for the rationale.
   */
  cacheTtl?: CacheTtl;
  client?: Anthropic;
}

export class ClaudeFrontDeskModel implements FrontDeskModel {
  readonly provider = "anthropic" as const;
  readonly answererModel: string;
  private readonly judgeModel: string;
  private readonly cacheTtl: CacheTtl;
  private client: Anthropic;

  constructor(config: ClaudeConfig = {}) {
    // An explicit apiKey comes from decrypted DB creds; the zero-arg client
    // resolves ANTHROPIC_API_KEY / auth profile from the env (bootstrap fallback).
    this.client =
      config.client ?? (config.apiKey ? new Anthropic({ apiKey: config.apiKey }) : new Anthropic());
    this.answererModel = config.answererModel ?? ANSWERER_MODEL;
    this.judgeModel = config.judgeModel ?? JUDGE_MODEL;
    // The factory supplies the operator-configured TTL; default to 1h otherwise
    // (zero-arg construction in tests / the integration harness).
    this.cacheTtl = config.cacheTtl ?? DEFAULT_CACHE_TTL;
  }

  async groundedAnswer(input: GroundedAnswerInput): Promise<GroundedResult> {
    const response = await this.client.messages.parse({
      model: this.answererModel,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      // Cache the stable prefix; pay input only for the (short) question. The
      // prefix (persona + center facts + all published policies) is identical
      // across every parent and changes only when the operator edits a policy,
      // so we hold it with an operator-configured TTL (default 1h, vs. the API
      // default of 5m) — front-desk traffic is bursty (clustered at drop-off /
      // pick-up, quiet between), and 1h keeps the cache warm across those gaps.
      // A policy edit changes the prefix bytes and invalidates the cache on its
      // own, so freshness is never traded away (analysis/04 §4.1, analysis/08).
      system: [
        {
          type: "text",
          text: input.system,
          cache_control: { type: "ephemeral", ttl: this.cacheTtl },
        },
      ],
      messages: input.messages,
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
    const sources = formatJudgeSources(input.citedPolicies);

    const response = await this.client.messages.parse({
      model: this.judgeModel,
      max_tokens: 500,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: formatJudgeUser(input.question, input.answer, sources),
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
