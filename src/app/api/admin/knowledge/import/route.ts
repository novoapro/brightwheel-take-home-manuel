import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import { importEntries } from "@/lib/repo/knowledge";
import type {
  Intent,
  KnowledgeEntryInput,
  KnowledgeEntryStatus,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Each id/intent segment: lowercase letters, digits, hyphens. */
const SEGMENT = /^[a-z0-9-]+$/;

/**
 * Validate one raw entry from an imported `{ entries: [...] }` file into a
 * KnowledgeEntryInput. Mirrors the handbook-to-knowledge-base skill's contract
 * (see .claude/skills/handbook-to-knowledge-base/references/format-spec.md).
 * Returns a per-entry error string on the first problem so the operator sees
 * exactly which entry is malformed.
 */
function parseImportEntry(
  raw: unknown,
  index: number,
  updatedBy: string,
): { input: KnowledgeEntryInput } | { error: string } {
  const at = `Entry ${index + 1}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${at}: must be an object.` };
  }
  const e = raw as Record<string, unknown>;

  const intent = typeof e.intent === "string" ? e.intent.trim().toLowerCase() : "";
  if (!intent) return { error: `${at}: "intent" is required.` };
  if (intent.length > 40) return { error: `${at}: "intent" must be 40 characters or fewer.` };
  if (!SEGMENT.test(intent)) {
    return { error: `${at}: "intent" must be lowercase letters, numbers, or hyphens (no spaces).` };
  }

  const id = typeof e.id === "string" ? e.id.trim() : "";
  if (!id) return { error: `${at}: "id" is required.` };
  const segments = id.split(".");
  if (segments[0] !== intent || segments.some((s) => !SEGMENT.test(s))) {
    return { error: `${at} ("${id}"): id must be "<intent>.<slug>", all lowercase.` };
  }

  const title = typeof e.title === "string" ? e.title.trim() : "";
  if (!title) return { error: `${at} ("${id}"): "title" is required.` };

  const body_md = typeof e.body_md === "string" ? e.body_md.trim() : "";
  if (!body_md) return { error: `${at} ("${id}"): "body_md" is required.` };

  if (!e.structured || typeof e.structured !== "object" || Array.isArray(e.structured)) {
    return { error: `${at} ("${id}"): "structured" must be an object.` };
  }

  if (!Array.isArray(e.keywords)) {
    return { error: `${at} ("${id}"): "keywords" must be an array.` };
  }
  const keywords = e.keywords.map(String).map((k) => k.trim()).filter(Boolean);

  const status: KnowledgeEntryStatus =
    e.status === "draft" || e.status === "unpublished" ? e.status : "published";

  return {
    input: {
      id,
      intent: intent as Intent,
      title,
      body_md,
      structured: e.structured as Record<string, unknown>,
      keywords,
      source: typeof e.source === "string" ? e.source : null,
      effective_from: typeof e.effective_from === "string" ? e.effective_from : null,
      effective_to: typeof e.effective_to === "string" ? e.effective_to : null,
      status,
      // Imported entries are authored, not born from the capture loop.
      origin: "seed",
      updated_by: updatedBy,
    },
  };
}

/**
 * Bulk-import knowledge entries from a `{ entries: [...] }` file (the shape the
 * handbook-to-knowledge-base skill produces). All-or-nothing: if any entry is
 * invalid the whole import is rejected with a specific error and nothing is
 * written. Entries whose id already exists are overwritten.
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The file must be valid JSON." }, { status: 400 });
  }

  // Accept either the { entries: [...] } envelope or a bare array of entries.
  const entriesRaw = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { entries?: unknown }).entries)
      ? (body as { entries: unknown[] }).entries
      : null;
  if (!entriesRaw) {
    return NextResponse.json(
      { ok: false, error: 'Expected a JSON object with an "entries" array.' },
      { status: 400 },
    );
  }
  if (entriesRaw.length === 0) {
    return NextResponse.json({ ok: false, error: 'The "entries" array is empty.' }, { status: 400 });
  }

  const updatedBy =
    !Array.isArray(body) &&
    body &&
    typeof body === "object" &&
    typeof (body as { updated_by?: unknown }).updated_by === "string"
      ? (body as { updated_by: string }).updated_by
      : "Operator";

  const inputs: KnowledgeEntryInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < entriesRaw.length; i++) {
    const parsed = parseImportEntry(entriesRaw[i], i, updatedBy);
    if ("error" in parsed) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    if (seen.has(parsed.input.id)) {
      return NextResponse.json(
        { ok: false, error: `Duplicate id "${parsed.input.id}" in the file.` },
        { status: 400 },
      );
    }
    seen.add(parsed.input.id);
    inputs.push(parsed.input);
  }

  const db = getDb();
  const imported = importEntries(db, inputs);
  return NextResponse.json({ ok: true, imported });
}
