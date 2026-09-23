/**
 * Mock operator gate (analysis/03 §9 decision 3) — NOT real auth, a deliberate
 * non-goal for the prototype. The operator UI sends the passcode in the
 * `x-admin-passcode` header; we compare it to ADMIN_PASSCODE (default for local
 * dev). Real auth (sessions, RBAC) is the production follow-up.
 */
export function isAdmin(request: Request): boolean {
  return isAdminPasscode(request.headers.get("x-admin-passcode"));
}

/**
 * Compare a raw passcode value against ADMIN_PASSCODE. Used by SSE routes, where
 * the passcode must ride in the query string because EventSource can't set
 * headers (a demo-gate concession — the passcode is not a real secret).
 */
export function isAdminPasscode(provided: string | null | undefined): boolean {
  const expected = process.env.ADMIN_PASSCODE ?? "change-me";
  return !!provided && provided === expected;
}

/** Standard 401 body for admin routes. */
export function adminUnauthorized(): Response {
  return new Response(
    JSON.stringify({ ok: false, error: "Invalid or missing operator passcode." }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}
