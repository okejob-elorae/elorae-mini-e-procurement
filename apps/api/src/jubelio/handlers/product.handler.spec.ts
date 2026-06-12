import { Test } from "@nestjs/testing";
import { ProductWebhookHandler } from "./product.handler";
import { JubelioCatalogSyncService } from "../catalog/catalog-sync.service";

function row(payload: any) {
  return {
    id: "wh_1",
    event: "product",
    eventId: null,
    signature: "",
    payloadHash: "",
    rawPayload: payload,
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    processedAt: null,
  };
}

describe("ProductWebhookHandler", () => {
  let handler: ProductWebhookHandler;
  let sync: { syncCatalog: jest.Mock };

  beforeEach(async () => {
    sync = { syncCatalog: jest.fn().mockResolvedValue({ dryRun: false, summary: { created: 0, updated: 1, skipped: 0, errors: 0, warnings: [] }, items: [], errors: [] }) };
    const mod = await Test.createTestingModule({
      providers: [
        ProductWebhookHandler,
        { provide: JubelioCatalogSyncService, useValue: sync },
      ],
    }).compile();
    handler = mod.get(ProductWebhookHandler);
  });

  it("calls syncCatalog with the payload's item_group_id", async () => {
    const r = await handler.handle(row({ action: "update-product", item_group_id: 116, item_group_name: "X" }) as any);
    expect(sync.syncCatalog).toHaveBeenCalledWith({ itemGroupIds: [116] });
    expect(r).toEqual({ kind: "processed" });
  });

  it("SKIPs missing_item_group_id when payload lacks item_group_id", async () => {
    const r = await handler.handle(row({ action: "update-product" }) as any);
    expect(sync.syncCatalog).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "skipped", reason: "missing_item_group_id" });
  });

  it("propagates syncCatalog errors (BullMQ retry handles it)", async () => {
    sync.syncCatalog.mockRejectedValueOnce(new Error("Jubelio 503"));
    await expect(handler.handle(row({ item_group_id: 99 }) as any)).rejects.toThrow("Jubelio 503");
  });
});
