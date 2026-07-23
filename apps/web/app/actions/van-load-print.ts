"use server";

import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getVanLoadById, type VanLoadDetail } from "@/lib/canvassing/queries";

export async function getVanLoadPrintData(id: string): Promise<VanLoadDetail | null> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.CANVASSING_MANAGE)) {
    return null;
  }
  return getVanLoadById(id);
}
