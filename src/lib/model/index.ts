import type { Database } from "better-sqlite3";
import { DEFAULT_CACHE_TTL, type Provider } from "../types";
import { getStoredCredential, resolveApiKey } from "../repo/credentials";
import { getSettings } from "../repo/settings";
import { PROVIDER_REGISTRY } from "./registry";
import { ClaudeFrontDeskModel } from "./claude";
import { GeminiFrontDeskModel } from "./gemini";
import { OpenAIFrontDeskModel } from "./openai";
import type { FrontDeskModel } from "./types";

/**
 * Provider factory (analysis/11 §3.4). Resolves the active provider's credentials
 * behind the unchanged seam: when a `db` is given, it loads that provider's model
 * ids and **decrypts** its stored key in-process, handing an explicit key to the
 * SDK client. Env keys remain the bootstrap fallback (no DB key configured), so
 * local dev and the seed demo keep working. Anthropic is the default provider.
 */
export function getModel(
  provider: Provider = "anthropic",
  db?: Database,
): FrontDeskModel {
  const reg = PROVIDER_REGISTRY[provider];
  let apiKey: string | undefined;
  let answererModel = reg.defaultAnswerer;
  let judgeModel = reg.defaultJudge;
  // The prompt-cache TTL is an operator setting (Settings ▸ AI Assistant); it's
  // passed to every adapter for a uniform seam. Claude honors it; OpenAI/Gemini
  // cache automatically with no TTL knob, so it's reserved there (analysis/04 §4.1).
  let cacheTtl = DEFAULT_CACHE_TTL;

  if (db) {
    const cred = getStoredCredential(db, provider);
    if (cred?.answerer_model) answererModel = cred.answerer_model;
    if (cred?.judge_model) judgeModel = cred.judge_model;
    apiKey = resolveApiKey(db, provider) ?? undefined; // null → env fallback
    cacheTtl = getSettings(db).cache_ttl;
  }

  const config = { apiKey, answererModel, judgeModel, cacheTtl };
  switch (provider) {
    case "openai":
      return new OpenAIFrontDeskModel(config);
    case "google":
      return new GeminiFrontDeskModel(config);
    case "anthropic":
    default:
      return new ClaudeFrontDeskModel(config);
  }
}

export type { FrontDeskModel } from "./types";
