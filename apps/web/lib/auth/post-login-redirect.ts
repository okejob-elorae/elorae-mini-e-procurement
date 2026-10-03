/**
 * Post-login destination.
 *
 * Wildcard admins (`permissions: ["*"]`) intentionally land on `/backoffice`
 * — the PWA UX is field-salesman-scoped, not a "test everything" surface.
 *
 * `callbackUrl` (the page that sent the visitor to sign in) is honoured only
 * when it is an internal path inside the user's own area: a phone user back
 * into `/pwa`, an office user back into `/backoffice` or `/gudang-retur`.
 * Anything else — another host, `//host`, a backslash trick, the login page
 * itself, `/api` — falls back to the area's home. The page reached still runs
 * its own permission check; this only decides where to go first.
 */
const AREA: Record<"/pwa" | "/backoffice", readonly string[]> = {
  "/pwa": ["/pwa"],
  "/backoffice": ["/backoffice", "/gudang-retur"],
};

function dalamArea(path: string, awalan: string): boolean {
  return path === awalan || path.startsWith(`${awalan}/`) || path.startsWith(`${awalan}?`);
}

function alamatKembali(callbackUrl: string | null | undefined, rumah: "/pwa" | "/backoffice"): string | null {
  if (typeof callbackUrl !== "string" || callbackUrl.length > 2000) return null;
  if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//") || callbackUrl.includes("\\")) return null;
  return AREA[rumah].some((awalan) => dalamArea(callbackUrl, awalan)) ? callbackUrl : null;
}

export function computePostLoginRedirect(permissions: string[], callbackUrl?: string | null): string {
  const hasWildcard = permissions.includes("*");
  const hasPwaAccess = permissions.includes("pwa:access");
  const rumah = !hasWildcard && hasPwaAccess ? "/pwa" : "/backoffice";
  return alamatKembali(callbackUrl, rumah) ?? rumah;
}
