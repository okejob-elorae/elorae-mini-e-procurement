import { Injectable } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { StockPushHandler } from "./handlers/stock-push.handler";
import { ProductPushHandler } from "./handlers/product-push.handler";
import type { HandlerOutcome } from "./handlers/handler.types";
import { OUTBOX_SKIP_REASONS } from "./outbox-status";

@Injectable()
export class OutboxRouter {
  constructor(
    private readonly stockPush: StockPushHandler,
    private readonly productPush: ProductPushHandler,
  ) {}

  async route(row: JubelioOutbox): Promise<HandlerOutcome> {
    switch (row.entityType) {
      case "stock_push":
        return this.stockPush.handle(row);
      case "product_push":
        return this.productPush.handle(row);
      default:
        return {
          kind: "skipped",
          reason: `${OUTBOX_SKIP_REASONS.UNKNOWN_ENTITY_TYPE}:${row.entityType}`,
        };
    }
  }
}
