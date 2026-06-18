import { Injectable, Logger } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { JubelioHttpClient } from "../jubelio-http.client";
import { SalesReturnIngestService } from "../returns/sales-return-ingest.service";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

type SalesReturnPing = {
  action?: string;
  return_id?: number;
  return_no?: string;
};

@Injectable()
export class SalesReturnWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(SalesReturnWebhookHandler.name);

  constructor(
    private readonly jubelio: JubelioHttpClient,
    private readonly ingest: SalesReturnIngestService,
  ) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const payload = row.rawPayload as unknown as SalesReturnPing;
    if (!payload?.return_id) {
      this.logger.warn(`Salesreturn webhook missing return_id (id=${row.id})`);
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_REQUIRED_FIELD };
    }

    // Returns are SalesOrders in Jubelio's data model. The webhook ping's
    // `return_id` is the `salesorder_id`. Fetch the full salesorder detail and
    // route through the same ingest path the salesorder webhook uses.
    const detail = await this.jubelio.getSalesOrder(payload.return_id);
    await this.ingest.upsertFromApiDetail(detail);
    return { kind: "processed" };
  }
}
