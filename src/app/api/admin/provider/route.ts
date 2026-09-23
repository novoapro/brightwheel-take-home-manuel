import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { secretsAvailable } from "@/lib/keyring";
import { PROVIDER_REGISTRY, isValidAnswerer } from "@/lib/model/registry";
import {
  clearCredentialsExcept,
  maskedCredential,
  resolveApiKey,
  setCredentialValidity,
  upsertCredential,
} from "@/lib/repo/credentials";
import { getSettings, updateSettings } from "@/lib/repo/settings";
import type { Provider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS: Provider[] = ["anthropic", "openai", "google"];

/**
 * Per-provider credential config (analysis/11 §3). GET returns masked state only
 * (never the key). PATCH stores a key as ciphertext, records the model choice,
 * optionally activates the provider, and runs a cheap liveness check. All gated
 * by the admin passcode; the master key stays server-only.
 */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const db = getDb();
  const settings = getSettings(db);
  return NextResponse.json({
    ok: true,
    activeProvider: settings.active_provider,
    secretsEnabled: secretsAvailable(),
    registry: PROVIDER_REGISTRY,
    providers: Object.fromEntries(
      PROVIDERS.map((p) => [p, maskedCredential(db, p)]),
    ),
  });
}

export async function PATCH(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json()) as Record<string, unknown>;

  const provider = body.provider as Provider;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ ok: false, error: "Unknown provider." }, { status: 400 });
  }
  const reg = PROVIDER_REGISTRY[provider];

  const answerer_model =
    typeof body.answerer_model === "string" && isValidAnswerer(provider, body.answerer_model)
      ? body.answerer_model
      : reg.defaultAnswerer;
  const judge_model = reg.defaultJudge;

  // apiKey: undefined = leave unchanged; "" = remove; a string = new key.
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : undefined;

  const db = getDb();
  try {
    upsertCredential(db, { provider, apiKey, answerer_model, judge_model });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }

  // Liveness check on the stored key (§3.3 point 3): decrypt in-process, ping.
  const key = resolveApiKey(db, provider);
  if (key) {
    const valid = await pingProvider(provider, key);
    setCredentialValidity(db, provider, valid);
  }

  // Set active only when asked (switching providers happens on save). Exactly
  // one provider is configured at a time — drop the others' stored keys (§3.1).
  if (body.setActive === true) {
    updateSettings(db, { active_provider: provider });
    clearCredentialsExcept(db, provider);
  }

  return NextResponse.json({
    ok: true,
    activeProvider: getSettings(db).active_provider,
    provider: maskedCredential(db, provider),
  });
}

/** Cheap auth check — list models. Any throw ⇒ invalid. Never logs the key. */
async function pingProvider(provider: Provider, apiKey: string): Promise<boolean> {
  try {
    if (provider === "anthropic") {
      await new Anthropic({ apiKey }).models.list();
    } else if (provider === "openai") {
      await new OpenAI({ apiKey }).models.list();
    } else {
      await new GoogleGenAI({ apiKey }).models.list();
    }
    return true;
  } catch {
    return false;
  }
}
