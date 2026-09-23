import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import {
  deleteEntry,
  getEntry,
  listEntries,
  listIntents,
  upsertEntry,
} from "@/lib/repo/knowledge";
import {
  type Intent,
  type KnowledgeEntryInput,
  type KnowledgeEntrySensitivity,
  type KnowledgeEntryStatus,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List all entries (any status) + the known categories, for the KB editor. */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const db = getDb();
  return NextResponse.json({
    ok: true,
    entries: listEntries(db),
    intents: listIntents(db),
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "entry";
}

/** Normalize an operator-typed category to a stable lowercase token. */
function normalizeIntent(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** Parse and validate an editor payload into a KnowledgeEntryInput. */
function parseEntryBody(
  body: Record<string, unknown>,
): { input: Omit<KnowledgeEntryInput, "id" | "origin"> } | { error: string } {
  // Categories are operator-configurable: any non-empty token is valid.
  const intent = normalizeIntent(body.intent);
  if (!intent) return { error: "A category (intent) is required." };
  if (intent.length > 40) {
    return { error: "Category must be 40 characters or fewer." };
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

  const sensitivity: KnowledgeEntrySensitivity =
    body.sensitivity === "sensitive" ? "sensitive" : "none";
  const status: KnowledgeEntryStatus =
    body.status === "draft" || body.status === "unpublished"
      ? body.status
      : "published";

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

/** Create a new knowledge entry. */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json()) as Record<string, unknown>;
  const parsed = parseEntryBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const db = getDb();
  let id =
    typeof body.id === "string" && body.id.trim()
      ? body.id.trim()
      : `${parsed.input.intent}.${slugify(parsed.input.title)}`;
  // Avoid clobbering an existing id on create.
  if (getEntry(db, id)) id = `${id}.${Date.now().toString(36).slice(-4)}`;

  const entry = upsertEntry(db, { ...parsed.input, id, origin: "seed" });
  return NextResponse.json({ ok: true, entry });
}

/** Update an existing entry (preserving its origin), bumping its version. */
export async function PUT(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json()) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  const db = getDb();
  const existing = getEntry(db, id);
  if (!existing) return NextResponse.json({ ok: false, error: "Unknown entry." }, { status: 404 });

  const parsed = parseEntryBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const entry = upsertEntry(db, { ...parsed.input, id, origin: existing.origin });
  return NextResponse.json({ ok: true, entry });
}

/** Permanently remove an entry from the knowledge base. */
export async function DELETE(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id =
    (typeof body.id === "string" && body.id) ||
    new URL(request.url).searchParams.get("id") ||
    "";
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  const db = getDb();
  const removed = deleteEntry(db, id);
  if (!removed) {
    return NextResponse.json({ ok: false, error: "Unknown entry." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
