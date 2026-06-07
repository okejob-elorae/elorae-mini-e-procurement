"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { apiFetch } from "@/lib/internal-api";

export type CategoryMappingRow = {
  erpCategoryId: string;
  erpName: string;
  erpCode: string | null;
  jubelioId: number | null;
  createdAt: string | null;
};

export type JubelioCategoryFlat = {
  id: number;
  name: string;
  path: string;
  isLeaf: boolean;
};

export async function getJubelioCategoryMappings(): Promise<CategoryMappingRow[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const cats = await prisma.itemCategory.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      jubelioCategoryMappings: {
        select: { jubelioCategoryId: true, createdAt: true },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
  });

  return cats.map((c) => ({
    erpCategoryId: c.id,
    erpName: c.name,
    erpCode: c.code,
    jubelioId: c.jubelioCategoryMappings[0]?.jubelioCategoryId ?? null,
    createdAt: c.jubelioCategoryMappings[0]?.createdAt?.toISOString() ?? null,
  }));
}

export async function fetchJubelioCategoryList(): Promise<JubelioCategoryFlat[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const r = await apiFetch<JubelioCategoryFlat[]>("POST", "/jubelio/categories/list", {
    userId: session.user.id,
  });
  if (!r.ok) {
    throw new Error(`Failed to load Jubelio categories (${r.status}): ${(r.error ?? "").slice(0, 200)}`);
  }
  return r.data ?? [];
}

export async function saveJubelioCategoryMappings(
  mappings: Array<{ itemCategoryId: string; jubelioCategoryId: number }>,
): Promise<{ saved: number }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const r = await apiFetch<{ saved: number }>("POST", "/jubelio/categories/mappings", {
    userId: session.user.id,
    body: { mappings },
  });
  if (!r.ok) {
    throw new Error(`Save failed (${r.status}): ${(r.error ?? "").slice(0, 300)}`);
  }
  revalidatePath("/backoffice/settings/jubelio/categories");
  return r.data ?? { saved: 0 };
}
