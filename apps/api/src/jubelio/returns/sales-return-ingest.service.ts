import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@elorae/db";
import type { JubelioSalesReturnDetail } from "../jubelio-http.client";
import { detectChannel } from "../handlers/_shared/channel-detect";

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

@Injectable()
export class SalesReturnIngestService {
  private readonly logger = new Logger(SalesReturnIngestService.name);

  async upsertFromApiDetail(detail: JubelioSalesReturnDetail): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const salesOrder = detail.salesorder_id
        ? await tx.salesOrder.findUnique({
            where: { salesorderId: detail.salesorder_id },
            select: { id: true },
          })
        : null;

      const { channel } = detectChannel(detail.source_name);
      const totalQty = detail.items.reduce((s, i) => s + toNum(i.qty_in_base), 0);
      const totalValue = detail.items.reduce((s, i) => s + toNum(i.subtotal), 0);

      const ret = await tx.salesReturn.upsert({
        where: { jubelioReturnId: detail.return_id },
        create: {
          jubelioReturnId: detail.return_id,
          jubelioReturnNo: detail.return_no ?? null,
          salesOrderId: salesOrder?.id ?? null,
          channel,
          channelOrderNo: detail.salesorder_no ?? null,
          buyerName: detail.customer_name ?? null,
          totalQty,
          totalValue,
          receivedAt: new Date(),
          rawIngestPayload: detail as unknown as object,
        },
        update: {
          jubelioReturnNo: detail.return_no ?? null,
          rawIngestPayload: detail as unknown as object,
          // Don't overwrite decision/status fields — admin-driven.
        },
      });

      for (const apiItem of detail.items) {
        const itemRow = apiItem.item_code
          ? await tx.item.findFirst({
              where: { sku: apiItem.item_code },
              select: { id: true, sku: true },
            })
          : null;

        const variantSku =
          itemRow && itemRow.sku !== apiItem.item_code ? apiItem.item_code : null;

        if (apiItem.return_detail_id != null) {
          await tx.salesReturnItem.upsert({
            where: { jubelioReturnDetailId: apiItem.return_detail_id },
            create: {
              salesReturnId: ret.id,
              jubelioReturnDetailId: apiItem.return_detail_id,
              jubelioItemId: apiItem.item_id ?? null,
              salesOrderDetailId: apiItem.salesorder_detail_id ?? null,
              itemId: itemRow?.id ?? null,
              variantSku,
              externalSku: apiItem.item_code,
              productName: apiItem.item_name,
              qty: toNum(apiItem.qty_in_base),
              unitPrice: toNum(apiItem.unit_price),
              subtotal: toNum(apiItem.subtotal),
              itemReason: apiItem.return_reason ?? null,
              ...(apiItem.evidence_urls != null ? { evidenceUrls: apiItem.evidence_urls } : {}),
            },
            update: {
              itemReason: apiItem.return_reason ?? null,
              ...(apiItem.evidence_urls != null ? { evidenceUrls: apiItem.evidence_urls } : {}),
            },
          });
        } else {
          // No stable per-item key — create a new row each time (best-effort).
          // Real returns without return_detail_id will deduplicate via parent
          // (salesReturnId) + externalSku composite in a future pass if needed.
          this.logger.warn(
            `SalesReturnItem missing return_detail_id for return ${detail.return_id} — creating new row`,
          );
          await tx.salesReturnItem.create({
            data: {
              salesReturnId: ret.id,
              itemId: itemRow?.id ?? null,
              variantSku,
              externalSku: apiItem.item_code,
              productName: apiItem.item_name,
              qty: toNum(apiItem.qty_in_base),
              unitPrice: toNum(apiItem.unit_price),
              subtotal: toNum(apiItem.subtotal),
              itemReason: apiItem.return_reason ?? null,
              ...(apiItem.evidence_urls != null ? { evidenceUrls: apiItem.evidence_urls } : {}),
            },
          });
        }
      }
    });
  }
}
