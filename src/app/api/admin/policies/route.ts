import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { getPolicy, listPolicies, upsertPolicy } from "@/lib/repo/policies";
import {
  INTENTS,
  type Intent,
  type PolicyInput,
  type PolicySensitivity,
  type PolicyStatus,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List all policies (any status) for the source-of-truth editor. */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  return NextResponse.json({ ok: true, policies: listPolicies(getDb()) });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "policy";
}

/** Parse and validate an editor payload into a PolicyInput. */
function parsePolicyBody(
  body: Record<string, unknown>,
): { input: Omit<PolicyInput, "id" | "origin"> } | { error: string } {
  const intent = body.intent;
  if (typeof intent !== "string" || !(INTENTS as readonly string[]).includes(intent)) {
    return { error: "intent must be one of hours|tuition|health|meals|tours." };
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const body_md = typeof body.body_md === "string" ? body.body_md.trim() : "";
  if (!title || !body_md) return { error: "title and body_md are required." };

  let structured: Record<string, unknown> = {};
  if (typeof body.structured === "string" && body.structured.trim()) {
    try {
      structured = JSON.parse(body.structured) as Record<string, unknown>;
    } catch {
      return { error: "structured must be valid JSON." };
    }
  } else if (body.structured && typeof body.structured === "object") {
    structured = body.structured as Record<string, unknown>;
  }

  const keywords = Array.isArray(body.keywords)
    ? (body.keywords as unknown[]).map(String)
    : typeof body.keywords === "string"
      ? body.keywords.split(",").map((k) => k.trim()).filter(Boolean)
      : [];

  const sensitivity: PolicySensitivity =
    body.sensitivity === "sensitive" ? "sensitive" : "none";
  const status: PolicyStatus = body.status === "draft" ? "draft" : "published";

  return {
    input: {
      intent: intent as Intent,
      title,
      body_md,
      structured,
      keywords,
      sensitivity,
      status,
      source: typeof body.source === "string" ? body.source : null,
      updated_by: typeof body.updated_by === "string" ? body.updated_by : "Operator",
    },
  };
}

/** Create a new policy. */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json()) as Record<string, unknown>;
  const parsed = parsePolicyBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const db = getDb();
  let id =
    typeof body.id === "string" && body.id.trim()
      ? body.id.trim()
      : `${parsed.input.intent}.${slugify(parsed.input.title)}`;
  // Avoid clobbering an existing id on create.
  if (getPolicy(db, id)) id = `${id}.${Date.now().toString(36).slice(-4)}`;

  const policy = upsertPolicy(db, { ...parsed.input, id, origin: "seed" });
  return NextResponse.json({ ok: true, policy });
}

/** Update an existing policy (preserving its origin), bumping its version. */
export async function PUT(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json()) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  const db = getDb();
  const existing = getPolicy(db, id);
  if (!existing) return NextResponse.json({ ok: false, error: "Unknown policy." }, { status: 404 });

  const parsed = parsePolicyBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const policy = upsertPolicy(db, { ...parsed.input, id, origin: existing.origin });
  return NextResponse.json({ ok: true, policy });
}
