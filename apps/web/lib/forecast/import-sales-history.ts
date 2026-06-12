import {
  SalesChannel,
  SalesHistoryStatus,
} from "@elorae/db";
import { prisma } from "@elorae/db";
import { logAudit } from "@/lib/audit";
import { parseShopeeExcel } from "@/lib/forecast/shopee-parser";
import { parseTikTokExcel } from "@/lib/forecast/tiktok-parser";
import type { SalesHistoryRow } from "@/lib/forecast/types";

function channelLabel(channel: SalesChannel): string {
  return channel === "SHOPEE" ? "Shopee" : "TikTok";
}

function periodLabel(month: number, year: number): string {
  return `${month}/${year}`;
}

async function enrichParentSkus(
  rows: SalesHistoryRow[]
): Promise<SalesHistoryRow[]> {
  const variantSkus = [...new Set(rows.map((r) => r.variantSku))];
  if (variantSkus.length === 0) return rows;

  const mappings = await prisma.jubelioProductMapping.findMany({
    where: { erpVariantSku: { in: variantSkus } },
    include: { item: { select: { sku: true } } },
  });
  const skuToParent = new Map(
    mappings.map((m) => [m.erpVariantSku, m.item.sku])
  );

  return rows.map((row) => {
    const mapped = skuToParent.get(row.variantSku);
    if (mapped) {
      return { ...row, parentSku: mapped };
    }
    return row;
  });
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
  const enriched = await enrichParentSkus(completed);

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
    },
  });

  return {
    success: true,
    imported,
    skipped,
    errors: parsed.errors,
  };
}
