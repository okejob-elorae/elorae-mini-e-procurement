import { Inject, Injectable, Logger } from "@nestjs/common";
import { applyJubelioStockAdjustment } from "@elorae/db";
import type { JubelioWebhookEvent } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

type StockWebhookPayload = {
  item_code: string;
  end_qty: number | string;
};

@Injectable()
export class StockWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(StockWebhookHandler.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const payload = row.rawPayload as unknown as StockWebhookPayload;
    if (!payload?.item_code) {
      return { kind: "skipped", reason: `${SKIP_REASONS.ORPHAN_SKU}:<missing>` };
    }

    const mapping = await this.prisma.jubelioProductMapping.findUnique({
      where: { jubelioItemCode: payload.item_code },
    });
    if (!mapping) {
      return { kind: "skipped", reason: `${SKIP_REASONS.ORPHAN_SKU}:${payload.item_code}` };
    }

    await applyJubelioStockAdjustment(this.prisma, {
      itemId: mapping.itemId,
      variantSku: mapping.erpVariantSku,
      newQty: Number(payload.end_qty),
      idempotencyKey: row.id,
      externalRef: payload.item_code,
      reason: `Jubelio stock webhook event ${row.id}`,
    });

    return { kind: "processed" };
  }
}
