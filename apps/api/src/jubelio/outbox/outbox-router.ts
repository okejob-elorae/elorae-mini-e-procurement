import { Injectable } from "@nestjs/common";
import type { JubelioOutbox, JubelioOutboxEntityType } from "@elorae/db";
import { StockPushHandler } from "./handlers/stock-push.handler";
import { ProductPushHandler } from "./handlers/product-push.handler";
import { SalesOrderPickHandler } from "./handlers/salesorder-pick.handler";
import { SalesOrderPackHandler } from "./handlers/salesorder-pack.handler";
import { SalesOrderShipHandler } from "./handlers/salesorder-ship.handler";
import type { HandlerOutcome } from "./handlers/handler.types";
import { OUTBOX_SKIP_REASONS } from "./outbox-status";

@Injectable()
export class OutboxRouter {
  constructor(
    private readonly stockPush: StockPushHandler,
    private readonly productPush: ProductPushHandler,
    private readonly salesorderPick: SalesOrderPickHandler,
    private readonly salesorderPack: SalesOrderPackHandler,
    private readonly salesorderShip: SalesOrderShipHandler,
  ) {}

  async route(row: JubelioOutbox): Promise<HandlerOutcome> {
    const entityType = row.entityType as JubelioOutboxEntityType;
    switch (entityType) {
      case "stock_push":
        return this.stockPush.handle(row);
      case "product_push":
        return this.productPush.handle(row);
      case "salesorder_pick":
        return this.salesorderPick.handle(row);
      case "salesorder_pack":
        return this.salesorderPack.handle(row);
      case "salesorder_ship":
        return this.salesorderShip.handle(row);
      default: {
        const _exhaustive: never = entityType;
        return {
          kind: "skipped",
          reason: `${OUTBOX_SKIP_REASONS.UNKNOWN_ENTITY_TYPE}:${String(_exhaustive)}`,
        };
      }
    }
  }
}
