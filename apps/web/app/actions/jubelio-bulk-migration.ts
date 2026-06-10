"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";

export type EligibleItem = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  categoryId: string | null;
  categoryName: string | null;
  variantCount: number;
  hasJubelioCategoryMapping: boolean;
};

export type MigrationSummary = {
  done: number;
  pending: number;
  processing: number;
  dead: number;
  skipped: number;
  total: number;
  windowStart: string;
};

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function getEligibleItems(): Promise<EligibleItem[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const items = await prisma.item.findMany({
    where: {
      type: "FINISHED_GOOD",
      source: "ERP",
      jubelioProductMappings: { none: {} },
    },
    select: {
      id: true,
      sku: true,
      nameId: true,
      nameEn: true,
      categoryId: true,
      variants: true,
      category: { select: { name: true } },
    },
    orderBy: { sku: "asc" },
  });

  const mappedCategoryIds = await prisma.jubelioCategoryMapping.findMany({
    select: { itemCategoryId: true },
  });
  const mappedCatSet = new Set(mappedCategoryIds.map((m) => m.itemCategoryId));

  return items.map((it) => {
    const variants = Array.isArray(it.variants) ? (it.variants as Array<unknown>) : [];
    return {
      id: it.id,
      sku: it.sku,
      nameId: it.nameId,
      nameEn: it.nameEn,
      categoryId: it.categoryId,
      categoryName: it.category?.name ?? null,
      variantCount: variants.length,
      hasJubelioCategoryMapping: it.categoryId ? mappedCatSet.has(it.categoryId) : false,
    };
  });
}

export async function enqueueBulkMigration(itemIds: string[]): Promise<{ enqueued: number }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  if (itemIds.length === 0) {
    throw new Error("No items selected");
  }

  const eligibleIds = new Set(
    (await prisma.item.findMany({
      where: {
        id: { in: itemIds },
        type: "FINISHED_GOOD",
        source: "ERP",
        jubelioProductMappings: { none: {} },
      },
      select: { id: true },
    })).map((it) => it.id),
  );

  const invalid = itemIds.filter((id) => !eligibleIds.has(id));
  if (invalid.length > 0) {
    throw new Error(`${invalid.length} item(s) not eligible (already mapped or wrong type)`);
  }

  await prisma.jubelioOutbox.createMany({
    data: itemIds.map((id) => ({
      entityType: "product_push",
      entityId: id,
      payload: {},
      enqueuedById: session.user.id,
    })),
  });

  revalidatePath("/backoffice/jubelio/migration");
  return { enqueued: itemIds.length };
}

export async function getMigrationSummary(): Promise<MigrationSummary> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const windowStart = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);

  const grouped = await prisma.jubelioOutbox.groupBy({
    by: ["status"],
    where: {
      entityType: "product_push",
      enqueuedById: session.user.id,
      createdAt: { gte: windowStart },
    },
    _count: { _all: true },
  });

  const counts: Record<string, number> = { DONE: 0, PENDING: 0, PROCESSING: 0, DEAD: 0, SKIPPED: 0 };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  return {
    done: counts.DONE,
    pending: counts.PENDING,
    processing: counts.PROCESSING,
    dead: counts.DEAD,
    skipped: counts.SKIPPED,
    total: counts.DONE + counts.PENDING + counts.PROCESSING + counts.DEAD + counts.SKIPPED,
    windowStart: windowStart.toISOString(),
  };
}
