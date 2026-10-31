/**
 * Post-login destination.
 *
 * Wildcard admins (`permissions: ["*"]`) intentionally land on `/backoffice`
 * — the PWA UX is field-salesman-scoped, not a "test everything" surface.
 * Field salesmen with `pwa:access` land on `/pwa`.
 * Packers with `packer:menu` land on `/packer`.
 *
 * `callbackUrl` (the page that sent the visitor to sign in) is honoured only
 * when it is an internal path inside the user's own area: a phone user back
 * into `/pwa`, a packer back into `/packer`, an office user back into
 * `/backoffice` or `/gudang-retur`. Anything else — another host, `//host`, a
 * backslash trick, the login page itself, `/api` — falls back to the area's
 * home. The page reached still runs its own permission check; this only
 * decides where to go first.
 */
type Rumah = "/pwa" | "/packer" | "/backoffice";

const AREA: Record<Rumah, readonly string[]> = {
  "/pwa": ["/pwa"],
  "/packer": ["/packer"],
  "/backoffice": ["/backoffice", "/gudang-retur"],
};

function dalamArea(path: string, awalan: string): boolean {
  return path === awalan || path.startsWith(`${awalan}/`) || path.startsWith(`${awalan}?`);
}

function alamatKembali(callbackUrl: string | null | undefined, rumah: Rumah): string | null {
  if (typeof callbackUrl !== "string" || callbackUrl.length > 2000) return null;
  if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//") || callbackUrl.includes("\\")) return null;
  return AREA[rumah].some((awalan) => dalamArea(callbackUrl, awalan)) ? callbackUrl : null;
}

function rumahUntuk(permissions: string[]): Rumah {
  if (permissions.includes("*")) return "/backoffice";
  if (permissions.includes("pwa:access")) return "/pwa";
  if (permissions.includes("packer:menu")) return "/packer";
  return "/backoffice";
}

export function computePostLoginRedirect(permissions: string[], callbackUrl?: string | null): string {
  const rumah = rumahUntuk(permissions);
  return alamatKembali(callbackUrl, rumah) ?? rumah;
}
