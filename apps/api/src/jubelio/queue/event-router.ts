import { Injectable } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { SalesOrderWebhookHandler } from "../handlers/salesorder.handler";
import { SalesReturnWebhookHandler } from "../handlers/salesreturn.handler";
import { ProductWebhookHandler } from "../handlers/product.handler";
import type { HandlerOutcome } from "../handlers/handler.types";
import { SKIP_REASONS } from "./webhook-status";

@Injectable()
export class JubelioEventRouter {
  constructor(
    private readonly stockHandler: StockWebhookHandler,
    private readonly salesOrderHandler: SalesOrderWebhookHandler,
    private readonly salesReturnHandler: SalesReturnWebhookHandler,
    private readonly productHandler: ProductWebhookHandler,
  ) {}

  async route(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    switch (row.event) {
      case "stock":
        return this.stockHandler.handle(row);
      case "salesorder":
        return this.salesOrderHandler.handle(row);
      case "salesreturn":
        return this.salesReturnHandler.handle(row);
      case "product":
        return this.productHandler.handle(row);
      default:
        return { kind: "skipped", reason: `${SKIP_REASONS.UNKNOWN_EVENT}:${row.event}` };
    }
  }
}
