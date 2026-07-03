import {
  SalesChannel,
  SalesHistoryStatus,
} from "@elorae/db";
import { prisma } from "@elorae/db";
import { logAudit } from "@/lib/audit";
import { parseShopeeExcel } from "@/lib/forecast/shopee-parser";
import { parseTikTokExcel } from "@/lib/forecast/tiktok-parser";
import type { SalesHistoryRow } from "@/lib/forecast/types";
import {
  loadResolverIndex,
  resolutionStatusFromResolve,
  resolveMarketplaceSku,
} from "@/lib/sales/marketplace-sku-resolver";

function channelLabel(channel: SalesChannel): string {
  return channel === "SHOPEE" ? "Shopee" : "TikTok";
}

function periodLabel(month: number, year: number): string {
  return `${month}/${year}`;
}

type EnrichedRow = SalesHistoryRow & {
  itemId: string | null;
  erpVariantSku: string | null;
  jubelioItemId: number | null;
  resolutionStatus: ReturnType<typeof resolutionStatusFromResolve>;
};

async function enrichRowsWithResolver(
  rows: SalesHistoryRow[],
  channel: SalesChannel
): Promise<EnrichedRow[]> {
  const index = await loadResolverIndex(prisma);
  const enriched: EnrichedRow[] = [];

  for (const row of rows) {
    const resolved = resolveMarketplaceSku(
      {
        variantSku: row.variantSku,
        size: row.size ?? undefined,
        channel: channel === "SHOPEE" || channel === "TIKTOK" ? channel : undefined,
      },
      index
    );
    const resolutionStatus = resolutionStatusFromResolve(resolved);
    const parentSku =
      resolved.parentItemSku ?? row.parentSku;

    enriched.push({
      ...row,
      parentSku,
      itemId: resolved.itemId,
      erpVariantSku: resolved.erpVariantSku,
      jubelioItemId: resolved.jubelioItemId,
      resolutionStatus,
    });
  }

  return enriched;
}

export type ImportSalesHistoryInput = {
  buffer: Buffer;
  fileName: string;
  channel: SalesChannel;
  periodMonth: number;
  periodYear: number;
  userId: string;
};

export type ImportSalesHistoryResult = {
  success: boolean;
  imported?: number;
  skipped?: number;
  mapped?: number;
  unmapped?: number;
  unmappedSkus?: string[];
  errors?: { row: number; message: string }[];
  error?: string;
};

export async function executeSalesHistoryImport(
  data: ImportSalesHistoryInput
): Promise<ImportSalesHistoryResult> {
  const existing = await prisma.salesHistoryImport.findUnique({
    where: {
      channel_periodYear_periodMonth: {
        channel: data.channel,
        periodYear: data.periodYear,
        periodMonth: data.periodMonth,
      },
    },
  });
  if (existing) {
    return {
      success: false,
      error: `Data untuk ${channelLabel(data.channel)} ${periodLabel(data.periodMonth, data.periodYear)} sudah diimport. Hapus import sebelumnya jika ingin re-import.`,
    };
  }

  const parsed =
    data.channel === "SHOPEE"
      ? parseShopeeExcel(data.buffer)
      : parseTikTokExcel(data.buffer);

  const completed = parsed.rows.filter((r) => r.status === "COMPLETED");
  const enriched = await enrichRowsWithResolver(completed, data.channel);

  const mapped = enriched.filter((r) => r.resolutionStatus === "MAPPED").length;
  const unmapped = enriched.filter((r) => r.resolutionStatus === "UNMAPPED").length;
  const unmappedSkus = [
    ...new Set(
      enriched
        .filter((r) => r.resolutionStatus === "UNMAPPED")
        .map((r) => r.variantSku)
    ),
  ].sort();

  const importRecord = await prisma.salesHistoryImport.create({
    data: {
      channel: data.channel,
      fileName: data.fileName,
      periodMonth: data.periodMonth,
      periodYear: data.periodYear,
      totalRows: parsed.totalParsed + parsed.totalErrors,
      importedRows: 0,
      skippedRows: 0,
      errorRows: parsed.totalErrors,
      errors: parsed.errors.length > 0 ? parsed.errors : undefined,
      uploadedById: data.userId,
    },
  });

  const createPayload = enriched.map((row) => ({
    channel: data.channel,
    orderId: row.orderId,
    orderStatus: SalesHistoryStatus.COMPLETED,
    variantSku: row.variantSku,
    parentSku: row.parentSku,
    productName: row.productName,
    color: row.color,
    size: row.size,
    quantity: row.quantity,
    returnedQuantity: row.returnedQuantity,
    netQuantity: row.netQuantity,
    unitPrice: row.unitPrice,
    unitPriceAfterDiscount: row.unitPriceAfterDiscount,
    lineTotal: row.lineTotal,
    orderTotal: row.orderTotal,
    orderDate: row.orderDate,
    completedDate: row.completedDate,
    province: row.province,
    city: row.city,
    productCategory: row.productCategory,
    itemId: row.itemId,
    erpVariantSku: row.erpVariantSku,
    jubelioItemId: row.jubelioItemId,
    resolutionStatus: row.resolutionStatus,
    importBatchId: importRecord.id,
  }));

  const beforeCount = await prisma.salesHistory.count({
    where: { importBatchId: importRecord.id },
  });

  await prisma.salesHistory.createMany({
    data: createPayload,
    skipDuplicates: true,
  });

  const afterCount = await prisma.salesHistory.count({
    where: { importBatchId: importRecord.id },
  });
  const imported = afterCount - beforeCount;
  const skipped = Math.max(0, createPayload.length - imported);

  await prisma.salesHistoryImport.update({
    where: { id: importRecord.id },
    data: {
      importedRows: imported,
      skippedRows: skipped,
    },
  });

  await logAudit({
    userId: data.userId,
    action: "CREATE",
    entityType: "SalesHistoryImport",
    entityId: importRecord.id,
    metadata: {
      channel: data.channel,
      periodMonth: data.periodMonth,
      periodYear: data.periodYear,
      imported,
      skipped,
      mapped,
      unmapped,
    },
  });

  return {
    success: true,
    imported,
    skipped,
    mapped,
    unmapped,
    unmappedSkus,
    errors: parsed.errors,
  };
}
