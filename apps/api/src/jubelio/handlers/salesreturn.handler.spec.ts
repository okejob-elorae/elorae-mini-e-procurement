import { Test } from "@nestjs/testing";
import { SalesReturnWebhookHandler } from "./salesreturn.handler";
import { SalesReturnIngestService } from "../returns/sales-return-ingest.service";
import { JubelioHttpClient } from "../jubelio-http.client";

describe("SalesReturnWebhookHandler", () => {
  let handler: SalesReturnWebhookHandler;
  let ingest: jest.Mocked<SalesReturnIngestService>;
  let client: jest.Mocked<JubelioHttpClient>;

  beforeEach(async () => {
    ingest = { upsertFromApiDetail: jest.fn().mockResolvedValue(undefined) } as any;
    client = { getSalesReturn: jest.fn() } as any;
    const mod = await Test.createTestingModule({
      providers: [
        SalesReturnWebhookHandler,
        { provide: SalesReturnIngestService, useValue: ingest },
        { provide: JubelioHttpClient, useValue: client },
      ],
    }).compile();
    handler = mod.get(SalesReturnWebhookHandler);
  });

  it("fetches detail by return_id and calls ingest service", async () => {
    client.getSalesReturn.mockResolvedValue({
      return_id: 7,
      return_no: "SR-000000007",
      items: [],
    } as any);

    const result = await handler.handle({
      id: "evt1",
      event: "salesreturn",
      rawPayload: { action: "new-salesreturn", return_id: 7, return_no: "SR-000000007" },
    } as any);

    expect(client.getSalesReturn).toHaveBeenCalledWith(7);
    expect(ingest.upsertFromApiDetail).toHaveBeenCalledWith(
      expect.objectContaining({ return_id: 7 }),
    );
    expect(result.kind).toBe("processed");
  });

  it("returns skipped when return_id missing", async () => {
    const result = await handler.handle({
      id: "evt2",
      event: "salesreturn",
      rawPayload: { action: "ping" },
    } as any);

    expect(result.kind).toBe("skipped");
    expect(client.getSalesReturn).not.toHaveBeenCalled();
  });
});
