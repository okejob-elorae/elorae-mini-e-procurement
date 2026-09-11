/**
 * Post-login destination.
 *
 * Wildcard admins (`permissions: ["*"]`) land on `/backoffice`.
 * Field salesmen with `pwa:access` land on `/pwa`.
 * Packers with `packer:menu` land on `/packer`.
 */
export function computePostLoginRedirect(
  permissions: string[],
): "/pwa" | "/packer" | "/backoffice" {
  const hasWildcard = permissions.includes("*");
  if (hasWildcard) return "/backoffice";
  if (permissions.includes("pwa:access")) return "/pwa";
  if (permissions.includes("packer:menu")) return "/packer";
  return "/backoffice";
}
