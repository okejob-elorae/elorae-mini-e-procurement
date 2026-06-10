import { Injectable, Logger } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

@Injectable()
export class SalesReturnWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(SalesReturnWebhookHandler.name);

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    // Stub: Jubelio has not sent a real return webhook yet. Real logic lands in a
    // follow-up commit once a sample payload is captured. See sub-4 spec §5.2.
    this.logger.log(`Salesreturn received (id=${row.id}) — awaiting payload sample`);
    return { kind: "skipped", reason: SKIP_REASONS.AWAITING_SAMPLES };
  }
}
