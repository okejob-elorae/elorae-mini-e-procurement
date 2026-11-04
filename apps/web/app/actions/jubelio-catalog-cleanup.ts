"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { apiFetch, extractApiMessage } from "@/lib/internal-api";
import {
  gagalJubelio,
  galatDariBalasanApi,
  jalankanAksiJubelio,
  type HasilJubelio,
} from "@/app/backoffice/jubelio/galat-jubelio";

export type CatalogDeleteResult = {
  jubelioGroupId: number;
  deletedMappings: number;
};

export async function deleteJubelioProduct(
  jubelioGroupId: number,
): Promise<HasilJubelio<CatalogDeleteResult>> {
  return jalankanAksiJubelio(async () => {
    const session = await auth();
    if (!session) return gagalJubelio("TANPA_AKSES");
    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);
    if (!Number.isInteger(jubelioGroupId) || jubelioGroupId <= 0) {
      return gagalJubelio("ISIAN_TIDAK_SAH");
    }

    const r = await apiFetch<CatalogDeleteResult>("POST", "/jubelio/catalog/delete-product", {
      userId: session.user.id,
      body: { jubelioGroupId },
    });
    if (!r.ok) {
      return galatDariBalasanApi(r.status, extractApiMessage(r.error, `Delete failed (${r.status})`));
    }
    revalidatePath("/backoffice/jubelio/settings");
    return { ok: true, data: r.data as CatalogDeleteResult };
  });
}
