import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

@Injectable()
export class StockPushHandler implements OutboxHandler {
  private readonly logger = new Logger(StockPushHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const itemId = row.entityId;

    const mapping = await this.prisma.jubelioProductMapping.findFirst({ where: { itemId } });
    if (!mapping) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.MISSING_MAPPING };
    }

    const inventory = await this.prisma.inventoryValue.findMany({ where: { itemId } });
    if (inventory.length === 0) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_INVENTORY };
    }

    const items = inventory.map((iv) => ({
      item_code: iv.variantSku || mapping.jubelioItemCode,
      end_qty: Number(iv.qtyOnHand),
    }));

    await this.http.put(`/inventory/items/${mapping.jubelioItemGroupId}/stock`, { items });

    this.logger.log(`Pushed stock for itemId=${itemId} (${items.length} variant rows)`);
    return { kind: "processed" };
  }
}
