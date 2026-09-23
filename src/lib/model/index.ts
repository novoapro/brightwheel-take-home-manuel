import type { Database } from "better-sqlite3";
import type { Provider } from "../types";
import { getStoredCredential, resolveApiKey } from "../repo/credentials";
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

  if (db) {
    const cred = getStoredCredential(db, provider);
    if (cred?.answerer_model) answererModel = cred.answerer_model;
    if (cred?.judge_model) judgeModel = cred.judge_model;
    apiKey = resolveApiKey(db, provider) ?? undefined; // null → env fallback
  }

  const config = { apiKey, answererModel, judgeModel };
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
