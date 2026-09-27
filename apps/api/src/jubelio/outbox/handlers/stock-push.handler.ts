import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { isJubelioStockPushEnabled, jubelioEndQtyFor, offlineReservedByKey } from "@elorae/db";
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
    // Owner-approved cutover switch: Jubelio is the stock source of truth until cutover, so a
    // push is refused entirely rather than retried — see jubelio-stock-contract.ts.
    if (!(await isJubelioStockPushEnabled(this.prisma))) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.STOCK_PUSH_DISABLED };
    }

    const itemId = row.entityId;

    const mapping = await this.prisma.jubelioProductMapping.findFirst({ where: { itemId } });
    if (!mapping) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.MISSING_MAPPING };
    }

    const inventory = await this.prisma.inventoryValue.findMany({ where: { itemId } });
    if (inventory.length === 0) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_INVENTORY };
    }

    const offlineByKey = await offlineReservedByKey(
      this.prisma,
      inventory.map((iv) => ({ itemId, variantSku: iv.variantSku ?? "" })),
    );

    const items = inventory.map((iv) => {
      const variantSku = iv.variantSku ?? "";
      const offline = offlineByKey.get(`${itemId}:${variantSku}`) ?? 0;
      return {
        item_code: iv.variantSku || mapping.jubelioItemCode,
        // end_qty is ON-HAND (the verified contract — see jubelio-stock-contract.ts). Jubelio
        // already nets out its own marketplace commitments via order_qty, so only Elorae's
        // field-sales holds — which Jubelio cannot see — are subtracted here. Floored at 0 by
        // jubelioEndQtyFor: Jubelio cannot hold negative stock; oversell is surfaced via
        // AdminNotification.
        end_qty: jubelioEndQtyFor(Number(iv.qtyOnHand), offline),
      };
    });

    await this.http.put(`/inventory/items/${mapping.jubelioItemGroupId}/stock`, { items });

    this.logger.log(`Pushed stock for itemId=${itemId} (${items.length} variant rows)`);
    return { kind: "processed" };
  }
}
