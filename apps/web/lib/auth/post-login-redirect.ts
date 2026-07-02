/**
 * Post-login destination.
 *
 * Wildcard admins (`permissions: ["*"]`) intentionally land on `/backoffice`
 * — the PWA UX is field-salesman-scoped, not a "test everything" surface.
 */
export function computePostLoginRedirect(
  permissions: string[],
): "/pwa" | "/backoffice" {
  const hasWildcard = permissions.includes("*");
  const hasPwaAccess = permissions.includes("pwa:access");
  return !hasWildcard && hasPwaAccess ? "/pwa" : "/backoffice";
}
