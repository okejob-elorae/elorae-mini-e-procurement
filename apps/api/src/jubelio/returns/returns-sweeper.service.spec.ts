import { Test } from "@nestjs/testing";
import { ReturnsSweeperService } from "./returns-sweeper.service";
import { SalesReturnIngestService } from "./sales-return-ingest.service";
import { JubelioHttpClient } from "../jubelio-http.client";

jest.mock("@elorae/db", () => ({
  prisma: { salesReturn: { findUnique: jest.fn() } },
}));
import { prisma } from "@elorae/db";

describe("ReturnsSweeperService", () => {
  let service: ReturnsSweeperService;
  let ingest: jest.Mocked<SalesReturnIngestService>;
  let client: jest.Mocked<JubelioHttpClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    ingest = { upsertFromApiDetail: jest.fn().mockResolvedValue(undefined) } as any;
    client = {
      listReturnedOrders: jest.fn(),
      getSalesOrder: jest.fn(),
    } as any;
    const mod = await Test.createTestingModule({
      providers: [
        ReturnsSweeperService,
        { provide: SalesReturnIngestService, useValue: ingest },
        { provide: JubelioHttpClient, useValue: client },
      ],
    }).compile();
    service = mod.get(ReturnsSweeperService);
  });

  it("ingests returns that don't exist locally", async () => {
    client.listReturnedOrders.mockResolvedValue([
      { salesorder_id: 1 } as any,
      { salesorder_id: 2 } as any,
    ]);
    client.getSalesOrder
      .mockResolvedValueOnce({ salesorder_id: 1, items: [] } as any)
      .mockResolvedValueOnce({ salesorder_id: 2, items: [] } as any);
    (prisma.salesReturn.findUnique as jest.Mock).mockResolvedValue(null);

    await service.sweep();

    expect(client.getSalesOrder).toHaveBeenCalledTimes(2);
    expect(ingest.upsertFromApiDetail).toHaveBeenCalledTimes(2);
  });

  it("skips returns that already exist locally", async () => {
    client.listReturnedOrders.mockResolvedValue([{ salesorder_id: 1 } as any]);
    (prisma.salesReturn.findUnique as jest.Mock).mockResolvedValue({ id: "r1" });

    await service.sweep();

    expect(client.getSalesOrder).not.toHaveBeenCalled();
    expect(ingest.upsertFromApiDetail).not.toHaveBeenCalled();
  });
});
