import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { applyRetention } from "@/lib/retention";
import { foldCsat } from "@/lib/repo/metrics_rollup";
import { getParentSession, setSessionRating, type SessionRating } from "@/lib/repo/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Longest review we store from the close-session rating popup. */
const REVIEW_MAX = 500;

/**
 * Record the parent's session-level rating (analysis/05 Tier 4 CSAT), captured
 * from the close-session popup. Applies the operator's audit retention policy
 * right away — a 👍 under `flagged`/`off` mode prunes the session's envelopes.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: unknown;
      rating?: unknown;
      review?: unknown;
    };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const rating: SessionRating | null =
      body.rating === "up" || body.rating === "down" ? body.rating : null;
    const review =
      typeof body.review === "string" ? body.review.trim().slice(0, REVIEW_MAX) : null;
    if (!sessionId || !rating) {
      return NextResponse.json(
        { ok: false, error: "Require 'sessionId' and 'rating' ('up'|'down')." },
        { status: 400 },
      );
    }
    const db = getDb();
    const before = getParentSession(db, sessionId);
    const updated = setSessionRating(db, sessionId, { rating, review });
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Unknown sessionId." }, { status: 404 });
    }
    // Fold CSAT into the rollup on the first rating (so it survives cleanup); a
    // re-rating (rare — the popup shows once) is left to the recompute path.
    if (before && before.rating == null) foldCsat(db, updated.rated_at!, rating);
    applyRetention(db, sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
