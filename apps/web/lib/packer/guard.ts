import { hasPermission, PERMISSIONS } from "@/lib/rbac";

export type PackerGuardOutcome = "render" | "redirect-login" | "redirect-backoffice";

/**
 * Packer surface is for users with packer:menu.
 * Admins with wildcard may still open /packer (useful for QA).
 * Users without packer:menu go to backoffice (or login handled by caller).
 */
export function packerAccessGuard(permissions: string[] | undefined): PackerGuardOutcome {
  const perms = permissions ?? [];
  if (hasPermission(perms, PERMISSIONS.PACKER_MENU)) return "render";
  return "redirect-backoffice";
}
