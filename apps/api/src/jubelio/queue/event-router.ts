import { Injectable } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";
import type { HandlerOutcome } from "../handlers/handler.types";
import { SKIP_REASONS } from "./webhook-status";

const KNOWN_UNHANDLED = new Set(["salesorder", "salesreturn", "product"]);

@Injectable()
export class JubelioEventRouter {
  constructor(
    private readonly stockHandler: StockWebhookHandler,
    private readonly unhandled: UnhandledEventHandler,
  ) {}

  async route(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    switch (row.event) {
      case "stock":
        return this.stockHandler.handle(row);
      default:
        if (KNOWN_UNHANDLED.has(row.event)) {
          return this.unhandled.handle();
        }
        return { kind: "skipped", reason: `${SKIP_REASONS.UNKNOWN_EVENT}:${row.event}` };
    }
  }
}
