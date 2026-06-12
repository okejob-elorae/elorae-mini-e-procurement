import { Test } from "@nestjs/testing";
import { SalesReturnWebhookHandler } from "./salesreturn.handler";

describe("SalesReturnWebhookHandler", () => {
  let handler: SalesReturnWebhookHandler;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [SalesReturnWebhookHandler],
    }).compile();
    handler = mod.get(SalesReturnWebhookHandler);
  });

  it("returns SKIPPED with awaiting_samples reason", async () => {
    const r = await handler.handle({
      id: "wh_1",
      event: "salesreturn",
      eventId: null,
      signature: "",
      payloadHash: "",
      rawPayload: {},
      status: "PROCESSING",
      attempts: 1,
      lastError: null,
      receivedAt: new Date(),
      processedAt: null,
    } as any);
    expect(r).toEqual({ kind: "skipped", reason: "awaiting_samples" });
  });
});
