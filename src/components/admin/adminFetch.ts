/**
 * One place the operator console talks to `/api/admin/*`. Every admin request is
 * gated by the passcode header, so injecting it here means no panel hand-rolls
 * the header (or forgets it). A JSON body implies the content-type, matching how
 * every call site set it by hand before.
 */
export function adminFetch(
  path: string,
  passcode: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-admin-passcode", passcode);
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(path, { ...init, headers });
}
