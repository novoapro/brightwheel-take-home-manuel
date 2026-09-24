import type { Provider } from "../types";

/**
 * Curated model registry per provider (analysis/11 §3.2). The admin UI renders
 * whatever this lists, so adding a model is a one-line change here — never a UI
 * change. Anthropic ids are current (verified against the `claude-api` skill —
 * exact strings, no date suffixes). OpenAI/Google ids track each provider's fast
 * tiers and are confirmed against their docs at build; Google uses moving
 * `-latest` aliases (matches the existing Gemini adapter).
 */
export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderRegistryEntry {
  label: string;
  answerers: ModelOption[];
  defaultAnswerer: string;
  defaultJudge: string;
}

export const PROVIDER_REGISTRY: Record<Provider, ProviderRegistryEntry> = {
  anthropic: {
    label: "Anthropic",
    answerers: [
      { id: "claude-opus-5", label: "Claude Opus 5" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
    defaultAnswerer: "claude-sonnet-5",
    defaultJudge: "claude-haiku-4-5",
  },
  openai: {
    label: "OpenAI",
    answerers: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
    ],
    defaultAnswerer: "gpt-5",
    defaultJudge: "gpt-5-mini",
  },
  google: {
    label: "Google",
    answerers: [
      { id: "gemini-flash-latest", label: "Gemini Flash" },
      { id: "gemini-pro-latest", label: "Gemini Pro" },
    ],
    defaultAnswerer: "gemini-flash-latest",
    defaultJudge: "gemini-flash-lite-latest",
  },
};

/** Whether an id is a valid answerer for a provider (route/UI validation). */
export function isValidAnswerer(provider: Provider, id: string): boolean {
  return PROVIDER_REGISTRY[provider].answerers.some((m) => m.id === id);
}

/** The neutral provider ids, in display order. */
export const PROVIDERS: Provider[] = ["anthropic", "openai", "google"];

/**
 * Bootstrap default provider from env (`FRONTDESK_PROVIDER`), validated against
 * the known providers. Undefined when unset/invalid — callers fall back to the
 * built-in default. Like the env API keys, this is only a first-boot default:
 * once an operator picks a provider in /admin it's stored in the DB and wins.
 */
export function resolveEnvProvider(
  raw = process.env.FRONTDESK_PROVIDER,
): Provider | undefined {
  const v = raw?.trim().toLowerCase();
  return PROVIDERS.includes(v as Provider) ? (v as Provider) : undefined;
}

/**
 * Bootstrap default answerer model from env (`FRONTDESK_MODEL`), for the active
 * provider only — validated against that provider's registry, so a model meant
 * for another provider is ignored rather than sent. Undefined when unset/invalid;
 * a UI-stored model choice still overrides it.
 */
export function resolveEnvAnswerer(
  provider: Provider,
  raw = process.env.FRONTDESK_MODEL,
): string | undefined {
  const v = raw?.trim();
  return v && isValidAnswerer(provider, v) ? v : undefined;
}
