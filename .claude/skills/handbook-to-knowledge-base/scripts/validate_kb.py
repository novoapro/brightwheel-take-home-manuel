#!/usr/bin/env python3
"""
Validate a Knowledge Base extraction against the Front Desk import contract.

Usage:
    python3 validate_kb.py <path-to-output.json>

Exits 0 when there are no ERRORs (WARNINGs are allowed), 1 otherwise.
ERRORs are things that would fail import or corrupt data; WARNINGs are quality
issues worth fixing but not fatal.
"""

import json
import re
import sys

STATUS_VALUES = {"published", "draft", "unpublished"}
# Each id/intent segment: lowercase letters, digits, and hyphens ONLY — this
# mirrors the import endpoint exactly (SEGMENT = /^[a-z0-9-]+$/ in
# src/app/api/admin/knowledge/import/route.ts). Underscores are NOT allowed in
# id/intent (they belong in `structured` keys, e.g. "late_fee_usd", not in ids);
# the import will reject them. Use hyphens: "hours.late-pickup", "hours.holidays.2026".
ID_SEGMENT = re.compile(r"^[a-z0-9-]+$")
# intent is a lowercase category token (single word in practice); no spaces.
INTENT_RE = re.compile(r"^[a-z0-9-]+$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

errors = []
warnings = []


def err(where, msg):
    errors.append(f"  [ERROR] {where}: {msg}")


def warn(where, msg):
    warnings.append(f"  [WARN]  {where}: {msg}")


def looks_like_number_string(v):
    return isinstance(v, str) and re.fullmatch(r"-?\d+(?:\.\d+)?", v.strip() or "x") is not None


def looks_like_bool_string(v):
    return isinstance(v, str) and v.strip().lower() in {"true", "false", "yes", "no"}


def scan_structured_types(where, obj, depth=0):
    """Flag values that should almost certainly be numbers/booleans but are strings."""
    if depth > 6:
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            if looks_like_number_string(v):
                warn(where, f'structured.{k} is the string "{v}" — should this be a number?')
            elif looks_like_bool_string(v) and str(v).strip().lower() in {"true", "false"}:
                warn(where, f'structured.{k} is the string "{v}" — should this be a boolean?')
            scan_structured_types(where, v, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            scan_structured_types(where, item, depth + 1)


def validate_entry(idx, e, seen_ids):
    where = f"entry[{idx}]"
    if not isinstance(e, dict):
        err(where, "entry is not an object")
        return
    eid = e.get("id")
    intent = e.get("intent")
    if isinstance(eid, str) and eid:
        where = f"entry[{idx}] id={eid!r}"

    # id
    if not isinstance(eid, str) or not eid:
        err(where, "missing required 'id' (non-empty string)")
    else:
        segs = eid.split(".")
        # Hard rules mirroring the import endpoint (route.ts): id must be
        # "<intent>.<slug>", every segment lowercase a-z/0-9/hyphen (NO
        # underscores), the first segment MUST equal `intent`, and ids are unique.
        # The import rejects anything else, so these are ERRORs, not warnings.
        if not all(ID_SEGMENT.match(s) for s in segs):
            err(where, f"id {eid!r} has an invalid segment (allowed: lowercase a-z, 0-9, hyphen — no underscores)")
        if eid in seen_ids:
            err(where, f"duplicate id {eid!r}")
        seen_ids.add(eid)
        if len(segs) < 2:
            warn(where, f"id {eid!r} isn't dotted — convention is '<intent>.<slug>'")
        elif isinstance(intent, str) and segs[0] != intent:
            err(where, f"id {eid!r} must start with the intent {intent!r} — the import requires id to be '<intent>.<slug>'")

    # intent
    if not isinstance(intent, str) or not intent.strip():
        err(where, "missing required 'intent' (non-empty string)")
    else:
        if len(intent) > 40:
            err(where, f"intent {intent!r} exceeds 40 characters")
        if not INTENT_RE.match(intent):
            err(where, f"intent {intent!r} must be lowercase, no spaces (allowed: a-z, 0-9, hyphen — no underscores)")

    # title
    title = e.get("title")
    if not isinstance(title, str) or not title.strip():
        err(where, "missing required 'title' (non-empty string)")

    # body_md
    body = e.get("body_md")
    if not isinstance(body, str) or not body.strip():
        err(where, "missing required 'body_md' (non-empty string)")

    # structured
    structured = e.get("structured")
    if "structured" not in e:
        err(where, "missing required 'structured' (object)")
    elif not isinstance(structured, dict):
        err(where, "'structured' must be a JSON object (not an array or string)")
    else:
        if not structured:
            warn(where, "'structured' is empty {} — extract the typed facts this policy states")
        elif set(structured.keys()) <= {"text", "body", "summary", "content"}:
            warn(where, "'structured' only restates prose — extract discrete typed keys instead")
        scan_structured_types(where, structured)

    # keywords
    kw = e.get("keywords")
    if "keywords" not in e:
        err(where, "missing required 'keywords' (array of strings)")
    elif not isinstance(kw, list) or not all(isinstance(k, str) for k in kw):
        err(where, "'keywords' must be an array of strings")
    elif len(kw) == 0:
        warn(where, "'keywords' is empty — add terms a parent would search")

    # optional: source
    if "source" in e and e["source"] is not None and not isinstance(e["source"], str):
        err(where, "'source' must be a string or null")
    if not e.get("source"):
        warn(where, "no 'source' — parents see the citation; add e.g. 'Family Handbook p.N'")

    # optional: dates
    for date_field in ("effective_from", "effective_to"):
        v = e.get(date_field)
        if v is not None and (not isinstance(v, str) or not ISO_DATE.match(v)):
            err(where, f"'{date_field}' must be an ISO date YYYY-MM-DD or null")

    # optional: status
    if "status" in e and e["status"] not in STATUS_VALUES:
        err(where, f"'status' must be one of {sorted(STATUS_VALUES)}")

    # forbidden system-managed fields
    for banned in ("version", "origin", "updated_at", "updated_by"):
        if banned in e:
            warn(where, f"'{banned}' is set by the system — remove it from the export")


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"[ERROR] file not found: {path}")
        sys.exit(1)
    except json.JSONDecodeError as exc:
        print(f"[ERROR] not valid JSON: {exc}")
        sys.exit(1)

    # Accept the wrapped envelope; tolerate a bare array with a warning.
    if isinstance(data, dict) and "entries" in data:
        entries = data["entries"]
        if not isinstance(data.get("source_document"), str) or not data.get("source_document"):
            warn("envelope", "missing 'source_document' — name the handbook it came from")
        if not isinstance(data.get("extracted_at"), str):
            warn("envelope", "missing 'extracted_at' (YYYY-MM-DD)")
    elif isinstance(data, list):
        warn("envelope", "expected { \"entries\": [...] } but got a bare array")
        entries = data
    else:
        print("[ERROR] top level must be an object with an 'entries' array")
        sys.exit(1)

    if not isinstance(entries, list):
        print("[ERROR] 'entries' must be an array")
        sys.exit(1)
    if len(entries) == 0:
        print("[ERROR] 'entries' is empty — nothing to import")
        sys.exit(1)

    seen_ids = set()
    for i, e in enumerate(entries):
        validate_entry(i, e, seen_ids)

    # Summary by intent
    by_intent = {}
    for e in entries:
        if isinstance(e, dict) and isinstance(e.get("intent"), str):
            by_intent[e["intent"]] = by_intent.get(e["intent"], 0) + 1

    print(f"Validated {len(entries)} entr{'y' if len(entries) == 1 else 'ies'} from {path}")
    if by_intent:
        dist = ", ".join(f"{k}={v}" for k, v in sorted(by_intent.items()))
        print(f"  by intent: {dist}")
    print()

    if warnings:
        print(f"{len(warnings)} warning(s):")
        print("\n".join(warnings))
        print()
    if errors:
        print(f"{len(errors)} error(s):")
        print("\n".join(errors))
        print()
        print("RESULT: FAIL — fix the ERRORs above before importing.")
        sys.exit(1)

    print("RESULT: PASS — no errors. Entries conform to the import contract.")
    sys.exit(0)


if __name__ == "__main__":
    main()
