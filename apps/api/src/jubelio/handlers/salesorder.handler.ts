import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { applyJubelioStockAdjustment } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";
import type { SalesOrderLine, SalesOrderPayload } from "./salesorder.payload";
import { resolveItemMapping } from "./_shared/mapping-lookup";

type UnmappedLine = { item_code: string; item_id: number; qty: string | number };

@Injectable()
export class SalesOrderWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(SalesOrderWebhookHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly admin: AdminNotificationService,
  ) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const p = row.rawPayload as unknown as SalesOrderPayload;
    if (!p?.salesorder_id) {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_SALESORDER_ID };
    }

    const state = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.jubelioSalesOrderState.findUnique({
        where: { salesorderId: p.salesorder_id },
      });
      if (existing) return existing;
      return tx.jubelioSalesOrderState.create({
        data: {
          salesorderId: p.salesorder_id,
          stockApplied: false,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: !!p.is_canceled,
          lastWebhookEventId: row.id,
        },
      });
    });

    const shouldApply = !p.is_canceled;
    const items = Array.isArray(p.items) ? p.items : [];

    if (shouldApply && !state.stockApplied) {
      const unmapped = await this.applyAdjustments(items, p.salesorder_id, p.salesorder_no ?? "", -1);
      if (unmapped.length > 0) {
        await this.notifyUnmappedLines(p.salesorder_id, p.salesorder_no ?? "", unmapped);
      }
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          stockApplied: true,
          appliedAt: new Date(),
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: false,
        },
      });
    } else if (!shouldApply && state.stockApplied) {
      await this.applyAdjustments(items, p.salesorder_id, p.salesorder_no ?? "", +1);
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          stockApplied: false,
          reversedAt: new Date(),
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: true,
        },
      });
    } else {
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: !!p.is_canceled,
        },
      });
    }

    return { kind: "processed" };
  }

  private async applyAdjustments(
    items: SalesOrderLine[],
    salesorderId: number,
    salesorderNo: string,
    sign: 1 | -1,
  ): Promise<UnmappedLine[]> {
    const unmapped: UnmappedLine[] = [];
    const direction = sign === -1 ? "decrement" : "reversal";

    for (const line of items) {
      if (line.is_canceled_item) continue;

      const mapping = await resolveItemMapping(this.prisma, line.item_id);
      if (!mapping) {
        unmapped.push({ item_code: line.item_code, item_id: line.item_id, qty: line.qty });
        continue;
      }

      const inv = await this.prisma.inventoryValue.findUnique({
        where: { itemId_variantSku: { itemId: mapping.itemId, variantSku: mapping.erpVariantSku } },
      });
      const currentQty = inv ? Number(inv.qtyOnHand) : 0;
      const newQty = currentQty + sign * Number(line.qty);

      try {
        await applyJubelioStockAdjustment(this.prisma, {
          itemId: mapping.itemId,
          variantSku: mapping.erpVariantSku,
          newQty,
          idempotencyKey: `salesorder-${salesorderId}-${direction}-line-${line.salesorder_detail_id}`,
          externalRef: `salesorder:${salesorderId}`,
          reason: `Jubelio salesorder ${salesorderNo} ${direction}`,
        });
      } catch (err) {
        this.logger.warn(
          `Stock adjustment failed for salesorder ${salesorderId} line ${line.salesorder_detail_id}: ${(err as Error).message}`,
        );
        unmapped.push({ item_code: line.item_code, item_id: line.item_id, qty: line.qty });
      }
    }
    return unmapped;
  }

  private async notifyUnmappedLines(
    salesorderId: number,
    salesorderNo: string,
    lines: UnmappedLine[],
  ): Promise<void> {
    await this.admin.write({
      category: "JUBELIO_UNMAPPED_LINES",
      severity: "WARN",
      title: `Salesorder ${salesorderNo || salesorderId}: ${lines.length} unmapped line(s)`,
      message: `Lines without JubelioProductMapping. Stock NOT decremented for these.`,
      metadata: { salesorderId, lines },
    });
  }
}
