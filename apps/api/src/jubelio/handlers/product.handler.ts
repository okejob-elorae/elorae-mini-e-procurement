import { Injectable, Logger } from "@nestjs/common";
import type { JubelioWebhookEvent } from "@elorae/db";
import { JubelioCatalogSyncService } from "../catalog/catalog-sync.service";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";
import type { ProductWebhookPayload } from "./product.payload";

@Injectable()
export class ProductWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(ProductWebhookHandler.name);

  constructor(private readonly catalogSync: JubelioCatalogSyncService) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const p = row.rawPayload as unknown as ProductWebhookPayload;
    if (!p?.item_group_id) {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_GROUP_ID };
    }
    await this.catalogSync.syncCatalog({ itemGroupIds: [p.item_group_id] });
    this.logger.log(`Re-ingested item_group_id=${p.item_group_id}`);
    return { kind: "processed" };
  }
}
