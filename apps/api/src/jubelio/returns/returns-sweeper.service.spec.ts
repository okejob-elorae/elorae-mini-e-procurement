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

  it("skips returns that already exist locally AND are linked to their sales order", async () => {
    client.listReturnedOrders.mockResolvedValue([{ salesorder_id: 1 } as any]);
    (prisma.salesReturn.findUnique as jest.Mock).mockResolvedValue({ id: "r1", salesOrderId: "so1" });

    await service.sweep();

    expect(client.getSalesOrder).not.toHaveBeenCalled();
    expect(ingest.upsertFromApiDetail).not.toHaveBeenCalled();
  });

  /*
   * The return routinely arrives before its sales order, so the first ingest had no
   * order to resolve and stored null. Skipping on mere presence stranded those rows:
   * nothing re-entered the ingest upsert, so the link was never filled in and the GL
   * refused the return's journal for good. Re-ingesting is what makes it self-heal.
   */
  it("re-ingests an existing return whose sales order link is still null", async () => {
    client.listReturnedOrders.mockResolvedValue([{ salesorder_id: 1 } as any]);
    (prisma.salesReturn.findUnique as jest.Mock).mockResolvedValue({ id: "r1", salesOrderId: null });
    client.getSalesOrder.mockResolvedValueOnce({ salesorder_id: 1, items: [] } as any);

    await service.sweep();

    expect(client.getSalesOrder).toHaveBeenCalledTimes(1);
    expect(ingest.upsertFromApiDetail).toHaveBeenCalledTimes(1);
  });
});
