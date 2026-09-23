import { GoogleGenAI } from "@google/genai";
import { SENSITIVE_CATEGORIES, type SensitiveCategory } from "../types";
import type {
  FrontDeskModel,
  GroundedAnswerInput,
  GroundedResult,
  JudgeInput,
  JudgeResult,
} from "./types";
import { formatJudgeSources, formatJudgeUser } from "./shared";

/**
 * Gemini implementation of the FrontDeskModel seam (analysis/04 §6.1) — the A/B
 * provider. Same §4 prompt, same §4.2 output schema, same downstream wrapper;
 * only this thin adapter differs. Uses @google/genai structured output
 * (responseMimeType + responseJsonSchema) — verified against Google's SDK docs.
 *
 * Model ids are env-overridable since Gemini's Flash aliases move; defaults are
 * the current fast/flash-lite aliases.
 */
const GEMINI_ANSWERER_MODEL = process.env.GEMINI_ANSWERER_MODEL ?? "gemini-flash-latest";
const GEMINI_JUDGE_MODEL = process.env.GEMINI_JUDGE_MODEL ?? "gemini-flash-lite-latest";

// JSON Schema (OpenAPI subset) mirroring the §4.2 output. sensitive_category
// uses a "none" sentinel instead of null (cleaner for schema validators); the
// adapter maps it back to null.
const GROUNDED_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["hours", "tuition", "health", "meals", "tours", "out_of_scope"] },
    is_case_specific: { type: "boolean" },
    sensitive_category: { type: "string", enum: [...SENSITIVE_CATEGORIES, "none"] },
    grounding_confidence: { type: "number" },
    citations: { type: "array", items: { type: "string" } },
    answer_intent: { type: "string", enum: ["answer", "escalate"] },
    parent_message: { type: "string" },
  },
  required: [
    "intent",
    "is_case_specific",
    "sensitive_category",
    "grounding_confidence",
    "citations",
    "answer_intent",
    "parent_message",
  ],
  propertyOrdering: [
    "intent",
    "is_case_specific",
    "sensitive_category",
    "grounding_confidence",
    "citations",
    "answer_intent",
    "parent_message",
  ],
};

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    groundedness: { type: "number" },
    answer_relevancy: { type: "number" },
  },
  required: ["groundedness", "answer_relevancy"],
  propertyOrdering: ["groundedness", "answer_relevancy"],
};

export interface GeminiConfig {
  apiKey?: string;
  answererModel?: string;
  judgeModel?: string;
  ai?: GoogleGenAI;
}

export class GeminiFrontDeskModel implements FrontDeskModel {
  readonly provider = "google" as const;
  readonly answererModel: string;
  private readonly judgeModel: string;
  private ai: GoogleGenAI;

  constructor(config: GeminiConfig = {}) {
    // Explicit key from decrypted DB creds; else env GOOGLE_API_KEY (fallback).
    this.ai =
      config.ai ?? new GoogleGenAI({ apiKey: config.apiKey ?? process.env.GOOGLE_API_KEY });
    this.answererModel = config.answererModel ?? GEMINI_ANSWERER_MODEL;
    this.judgeModel = config.judgeModel ?? GEMINI_JUDGE_MODEL;
  }

  async groundedAnswer(input: GroundedAnswerInput): Promise<GroundedResult> {
    const contents = input.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await this.ai.models.generateContent({
      model: this.answererModel,
      contents,
      config: {
        systemInstruction: input.system,
        responseMimeType: "application/json",
        responseJsonSchema: GROUNDED_SCHEMA,
      },
    });

    const raw = parseJson(response.text);
    const category = raw.sensitive_category as string | null | undefined;
    return {
      intent: raw.intent as GroundedResult["intent"],
      is_case_specific: Boolean(raw.is_case_specific),
      sensitive_category:
        category && category !== "none"
          ? (category as SensitiveCategory)
          : null,
      grounding_confidence: Number(raw.grounding_confidence ?? 0),
      citations: Array.isArray(raw.citations) ? (raw.citations as string[]) : [],
      answer_intent: raw.answer_intent === "answer" ? "answer" : "escalate",
      parent_message: String(raw.parent_message ?? ""),
    };
  }

  async judgeGroundedness(input: JudgeInput): Promise<JudgeResult> {
    const sources = formatJudgeSources(input.citedPolicies);

    const response = await this.ai.models.generateContent({
      model: this.judgeModel,
      contents: [
        { role: "user", parts: [{ text: formatJudgeUser(input.question, input.answer, sources) }] },
      ],
      config: {
        systemInstruction:
          "You grade whether an assistant's answer is fully supported by the provided policy SOURCES. " +
          "groundedness = fraction of the answer's factual claims supported by the sources (0..1). " +
          "answer_relevancy = how well the answer addresses the QUESTION (0..1).",
        responseMimeType: "application/json",
        responseJsonSchema: JUDGE_SCHEMA,
      },
    });

    const raw = parseJson(response.text);
    return {
      groundedness: Number(raw.groundedness ?? 0),
      answer_relevancy: Number(raw.answer_relevancy ?? 0),
    };
  }
}

function parseJson(text: string | undefined): Record<string, unknown> {
  if (!text) throw new Error("Gemini returned an empty response");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Gemini returned non-JSON output");
  }
}
