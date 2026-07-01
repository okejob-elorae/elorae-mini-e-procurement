import { Inject, Injectable, Logger } from "@nestjs/common";
import { applyJubelioStockAdjustment } from "@elorae/db";
import type { JubelioWebhookEvent } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

type StockWebhookPayload = {
  action?: string;
  item_group_id?: number;
  item_group_name?: string;
  item_ids?: number[];
  location_id?: number | null;
  // old shape — still recognised so we can flag it explicitly
  item_code?: string;
  end_qty?: number | string;
};

type GroupDetailSku = {
  item_id: number;
  item_code?: string;
  end_qty?: number | string;
};

type GroupDetailResponse = {
  item_group_id?: number;
  product_skus?: GroupDetailSku[];
};

@Injectable()
export class StockWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(StockWebhookHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const payload = row.rawPayload as unknown as StockWebhookPayload;

    // Old shape used to send { item_code, end_qty }. Jubelio switched to a change
    // notification with { item_group_id, item_ids[] } — no qty inline. Fail fast
    // on the old shape rather than half-supporting both.
    if (typeof payload?.item_code === "string" && payload.item_ids === undefined) {
      return { kind: "skipped", reason: SKIP_REASONS.UNSUPPORTED_PAYLOAD_SHAPE };
    }

    const groupId = payload?.item_group_id;
    if (typeof groupId !== "number") {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_GROUP_ID };
    }

    const itemIds = Array.isArray(payload?.item_ids)
      ? payload.item_ids.filter((n): n is number => typeof n === "number")
      : [];
    if (itemIds.length === 0) {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_IDS };
    }

    const detail = await this.http.get<GroupDetailResponse>(`/inventory/items/group/${groupId}`);
    const productSkus = Array.isArray(detail?.product_skus) ? detail.product_skus : [];
    const endQtyByItemId = new Map<number, number>();
    for (const sku of productSkus) {
      if (typeof sku?.item_id === "number" && sku.end_qty !== undefined) {
        endQtyByItemId.set(sku.item_id, Number(sku.end_qty));
      }
    }

    const mappings = await this.prisma.jubelioProductMapping.findMany({
      where: { jubelioItemId: { in: itemIds } },
    });
    if (mappings.length === 0) {
      return { kind: "skipped", reason: `${SKIP_REASONS.ORPHAN_GROUP}:${groupId}` };
    }

    for (const m of mappings) {
      const newQty = endQtyByItemId.get(m.jubelioItemId);
      if (newQty === undefined) {
        this.logger.warn(
          `stock webhook ${row.id}: item_id ${m.jubelioItemId} in payload but missing from group ${groupId} detail — skipping this sku`,
        );
        continue;
      }
      await applyJubelioStockAdjustment(this.prisma, {
        itemId: m.itemId,
        variantSku: m.erpVariantSku,
        newQty,
        idempotencyKey: `${row.id}:${m.jubelioItemId}`,
        externalRef: `${groupId}/${m.jubelioItemCode}`,
        reason: `Jubelio stock webhook ${row.id} item_id=${m.jubelioItemId}`,
      });
    }

    return { kind: "processed" };
  }
}
