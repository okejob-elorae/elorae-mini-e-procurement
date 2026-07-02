export type PwaGuardOutcome = "render" | "redirect-backoffice";

/**
 * Same rule as computePostLoginRedirect — a user reaches `/pwa` only if they
 * hold `pwa:access` AND don't hold the wildcard admin permission.
 * Unauthenticated case (no session) is handled by the caller before invoking
 * this — this helper only decides for authenticated users.
 */
export function pwaAccessGuard(permissions: string[] | undefined): PwaGuardOutcome {
  const perms = permissions ?? [];
  const hasWildcard = perms.includes("*");
  const hasPwaAccess = perms.includes("pwa:access");
  return (!hasWildcard && hasPwaAccess) ? "render" : "redirect-backoffice";
}
