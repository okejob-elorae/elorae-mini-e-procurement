"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { ajukanKeJubelio } from "@/lib/jubelio/harga/pengajuan";
import {
  gagalJubelio,
  jalankanAksiJubelio,
  type HasilJubelio,
} from "@/app/backoffice/jubelio/galat-jubelio";

export type EligibleItem = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  categoryId: string | null;
  categoryName: string | null;
  variantCount: number;
  hasJubelioCategoryMapping: boolean;
  /** ISO; set = already requested, waiting on Jubelio → Konfirmasi harga. */
  jubelioCreateRequestedAt: string | null;
};

export type MigrationSummary = {
  done: number;
  pending: number;
  processing: number;
  dead: number;
  skipped: number;
  total: number;
  windowStart: string;
  /** Unmapped ERP finished goods whose request waits for price confirmation (any requester). */
  awaitingPriceConfirmation: number;
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
      jubelioCreateRequestedAt: true,
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
      jubelioCreateRequestedAt: it.jubelioCreateRequestedAt?.toISOString() ?? null,
    };
  });
}

/**
 * Bulk migration REQUESTS the selected products; it creates nothing in Jubelio (owner decision
 * 2026-11-02). Each requested product waits on Jubelio → Konfirmasi harga and is created there
 * once its price is confirmed. Same gate as before: viewing the page is settings_security:view,
 * requesting is settings_security:manage — the page disables its controls for view-only users.
 */
export async function requestBulkMigration(
  itemIds: string[],
): Promise<HasilJubelio<{ requested: number; skipped: number }>> {
  return jalankanAksiJubelio(async () => {
    const session = await auth();
    if (!session) return gagalJubelio("TANPA_AKSES");
    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.some((id) => typeof id !== "string")) {
      return gagalJubelio("ISIAN_TIDAK_SAH", "No items selected");
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
      return gagalJubelio(
        "ISIAN_TIDAK_SAH",
        `${invalid.length} item(s) not eligible (already mapped or wrong type)`,
      );
    }

    /* Same rules as the item page's "Ajukan ke Jubelio": already requested or a push in flight is skipped. */
    const hasil = await ajukanKeJubelio(itemIds, session.user.id);
    const requested = hasil.filter((h) => h.hasil === "DIAJUKAN").length;

    revalidatePath("/backoffice/jubelio/migration");
    revalidatePath("/backoffice/jubelio/harga");
    return { ok: true, data: { requested, skipped: hasil.length - requested } };
  });
}

export async function getMigrationSummary(): Promise<MigrationSummary> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

  const windowStart = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);

  const [grouped, awaitingPriceConfirmation] = await Promise.all([
    prisma.jubelioOutbox.groupBy({
      by: ["status"],
      where: {
        entityType: "product_push",
        enqueuedById: session.user.id,
        createdAt: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    /* The same set as the "Produk baru" rows of Jubelio → Konfirmasi harga. */
    prisma.item.count({
      where: {
        type: "FINISHED_GOOD",
        source: "ERP",
        jubelioCreateRequestedAt: { not: null },
        jubelioProductMappings: { none: {} },
      },
    }),
  ]);

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
    awaitingPriceConfirmation,
  };
}
