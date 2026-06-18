import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@elorae/db";
import type { JubelioSalesOrderDetail } from "../jubelio-http.client";
import { detectChannel } from "../handlers/_shared/channel-detect";

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

/**
 * Ingest the SalesReturn audit row from a Jubelio SalesOrder detail that's in
 * a RETURNED state. Returns ARE SalesOrders in Jubelio's data model — there is
 * no separate "return" entity. The `jubelioReturnId` column on `SalesReturn`
 * stores the `salesorder_id` of the returned order.
 *
 * Called from:
 *   - SalesOrderWebhookHandler when payload has internal_status === "RETURNED"
 *   - SalesReturnWebhookHandler (thin ping handler that fetches the SO detail first)
 *   - ReturnsSweeperService backstop
 *
 * Idempotent: upsert keyed on jubelioReturnId. Doesn't overwrite admin-driven
 * decision/status fields on update.
 */
@Injectable()
export class SalesReturnIngestService {
  private readonly logger = new Logger(SalesReturnIngestService.name);

  async upsertFromApiDetail(detail: JubelioSalesOrderDetail): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const salesOrder = await tx.salesOrder.findUnique({
        where: { salesorderId: detail.salesorder_id },
        select: { id: true },
      });

      const { channel } = detectChannel(detail.source_name);
      const totalQty = detail.items.reduce((s, i) => s + toNum(i.qty_in_base), 0);
      const totalValue = detail.items.reduce((s, i) => s + toNum(i.amount), 0);

      const ret = await tx.salesReturn.upsert({
        where: { jubelioReturnId: detail.salesorder_id },
        create: {
          jubelioReturnId: detail.salesorder_id,
          jubelioReturnNo: detail.salesorder_no ?? null,
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
          jubelioReturnNo: detail.salesorder_no ?? null,
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

        if (apiItem.salesorder_detail_id != null) {
          await tx.salesReturnItem.upsert({
            where: { jubelioReturnDetailId: apiItem.salesorder_detail_id },
            create: {
              salesReturnId: ret.id,
              jubelioReturnDetailId: apiItem.salesorder_detail_id,
              jubelioItemId: apiItem.item_id ?? null,
              salesOrderDetailId: apiItem.salesorder_detail_id,
              itemId: itemRow?.id ?? null,
              variantSku,
              externalSku: apiItem.item_code,
              productName: apiItem.item_name,
              qty: toNum(apiItem.qty_in_base),
              unitPrice: toNum(apiItem.unit_price),
              subtotal: toNum(apiItem.amount),
              itemReason: apiItem.reject_return_reason ?? null,
            },
            update: {
              itemReason: apiItem.reject_return_reason ?? null,
            },
          });
        } else {
          // No stable per-item key — create a new row each time (best-effort).
          this.logger.warn(
            `SalesReturnItem missing salesorder_detail_id for salesorder ${detail.salesorder_id} — creating new row`,
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
              subtotal: toNum(apiItem.amount),
              itemReason: apiItem.reject_return_reason ?? null,
            },
          });
        }
      }
    });
  }
}
