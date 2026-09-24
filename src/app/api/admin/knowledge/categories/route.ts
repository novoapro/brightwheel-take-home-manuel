import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminUnauthorized, isAdmin } from "@/lib/admin";
import {
  deleteCategory,
  getCategory,
  listCategories,
  upsertCategory,
} from "@/lib/repo/categories";
import type { CategorySensitivity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Each category name: lowercase letters, digits, hyphens (matches an intent). */
const NAME = /^[a-z0-9-]+$/;

const SENSITIVITY: readonly CategorySensitivity[] = ["normal", "sensitive", "always_escalate"];

/** Read the requested tier, accepting the legacy `sensitive` boolean too. */
function readSensitivity(body: Record<string, unknown>): CategorySensitivity {
  if ((SENSITIVITY as readonly string[]).includes(body.sensitivity as string)) {
    return body.sensitivity as CategorySensitivity;
  }
  return body.sensitive === true ? "sensitive" : "normal";
}

/** Normalize an operator-typed category name to a stable lowercase token. */
function normalizeName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** List all categories (name + sensitivity), for the KB "Manage categories" panel. */
export function GET(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  return NextResponse.json({ ok: true, categories: listCategories(getDb()) });
}

/**
 * Create a category or update its sensitivity tier. Idempotent by name — POSTing
 * an existing name just sets its tier (the toggle path).
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const name = normalizeName(body.name);
  if (!name) return NextResponse.json({ ok: false, error: "A category name is required." }, { status: 400 });
  if (name.length > 40) {
    return NextResponse.json({ ok: false, error: "Category must be 40 characters or fewer." }, { status: 400 });
  }
  if (!NAME.test(name)) {
    return NextResponse.json(
      { ok: false, error: "Category must be lowercase letters, numbers, or hyphens (no spaces)." },
      { status: 400 },
    );
  }

  const category = upsertCategory(getDb(), { name, sensitivity: readSensitivity(body) });
  return NextResponse.json({ ok: true, category });
}

/**
 * Remove a category. Refused while entries still use it — the operator reassigns
 * or removes those entries first, so no live entry loses the sensitivity it
 * relies on.
 */
export async function DELETE(request: Request) {
  if (!isAdmin(request)) return adminUnauthorized();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name =
    normalizeName(body.name) || normalizeName(new URL(request.url).searchParams.get("name"));
  if (!name) return NextResponse.json({ ok: false, error: "A category name is required." }, { status: 400 });

  const db = getDb();
  if (!getCategory(db, name)) {
    return NextResponse.json({ ok: false, error: "Unknown category." }, { status: 404 });
  }

  const { deleted, inUse } = deleteCategory(db, name);
  if (!deleted) {
    return NextResponse.json(
      {
        ok: false,
        error: `“${name}” is still used by ${inUse} ${inUse === 1 ? "entry" : "entries"}. Reassign or remove them first.`,
        inUse,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
