"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { apiFetch } from "@/lib/internal-api";

export type CatalogDeleteResult = {
  jubelioGroupId: number;
  deletedMappings: number;
};

export async function deleteJubelioProduct(
  jubelioGroupId: number,
): Promise<CatalogDeleteResult> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const r = await apiFetch<CatalogDeleteResult>("POST", "/jubelio/catalog/delete-product", {
    userId: session.user.id,
    body: { jubelioGroupId },
  });
  if (!r.ok) {
    throw new Error(`Delete failed (${r.status}): ${(r.error ?? "").slice(0, 200)}`);
  }
  revalidatePath("/backoffice/settings/jubelio");
  return r.data as CatalogDeleteResult;
}
