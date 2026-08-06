import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ReturnsSweeperService } from "./returns-sweeper.service";
import { SalesReturnIngestService } from "./sales-return-ingest.service";
import { JubelioHttpClient } from "../jubelio-http.client";

jest.mock("@elorae/db", () => ({
  prisma: {
    salesReturn: { findUnique: jest.fn() },
    salesOrder: { findUnique: jest.fn() },
  },
}));
import { prisma } from "@elorae/db";

const returnFindUnique = prisma.salesReturn.findUnique as jest.Mock;
const orderFindUnique = prisma.salesOrder.findUnique as jest.Mock;

describe("ReturnsSweeperService", () => {
  let service: ReturnsSweeperService;
  let ingest: jest.Mocked<SalesReturnIngestService>;
  let client: jest.Mocked<JubelioHttpClient>;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const logLines = (): string[] => logSpy.mock.calls.map((c) => String(c[0]));

  beforeEach(async () => {
    jest.clearAllMocks();
    ingest = {
      upsertFromApiDetail: jest.fn().mockResolvedValue({ salesOrderId: null }),
    } as any;
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
    /* Spied after compile so Nest's own bootstrap logging can't pollute the assertions. */
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The order pre-check gates only rows that already exist. A first sighting is ingested
   * even with no local sales order, because the audit row is worth having regardless — so
   * this also pins the gate BELOW the existence check rather than above it.
   */
  it("ingests a return not seen locally without consulting the local sales order", async () => {
    client.listReturnedOrders.mockResolvedValue([
      { salesorder_id: 1 } as any,
      { salesorder_id: 2 } as any,
    ]);
    client.getSalesOrder
      .mockResolvedValueOnce({ salesorder_id: 1, items: [] } as any)
      .mockResolvedValueOnce({ salesorder_id: 2, items: [] } as any);
    returnFindUnique.mockResolvedValue(null);
    orderFindUnique.mockResolvedValue(null);

    await service.sweep();

    expect(client.getSalesOrder).toHaveBeenCalledTimes(2);
    expect(ingest.upsertFromApiDetail).toHaveBeenCalledTimes(2);
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(logLines()).toContain("Returns backstop ingested 2 new returns");
  });

  it("skips a return that already exists locally AND is linked, querying nothing further", async () => {
    client.listReturnedOrders.mockResolvedValue([{ salesorder_id: 1 } as any]);
    returnFindUnique.mockResolvedValue({ id: "r1", salesOrderId: "so1" });

    await service.sweep();

    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(client.getSalesOrder).not.toHaveBeenCalled();
    expect(ingest.upsertFromApiDetail).not.toHaveBeenCalled();
    expect(logLines()).toEqual([]);
  });

  /*
   * The healing path. The return routinely arrives before its sales order, so the first
   * ingest resolved nothing and stored null; once the order lands, re-ingesting is what
   * fills the link in, and the GL refuses to journal a return without it.
   */
  it("re-ingests an existing null-linked return once its sales order is present locally", async () => {
    client.listReturnedOrders.mockResolvedValue([{ salesorder_id: 77 } as any]);
    returnFindUnique.mockResolvedValue({ id: "r1", salesOrderId: null });
    orderFindUnique.mockResolvedValue({ id: "so-local-1" });
    client.getSalesOrder.mockResolvedValue({ salesorder_id: 77, items: [] } as any);
    ingest.upsertFromApiDetail.mockResolvedValue({ salesOrderId: "so-local-1" });

    await service.sweep();

    /* Same column, same value as the ingest's own resolve — if these drift, one side lies. */
    expect(orderFindUnique).toHaveBeenCalledWith({
      where: { salesorderId: 77 },
      select: { id: true },
    });
    expect(client.getSalesOrder).toHaveBeenCalledWith(77);
    expect(ingest.upsertFromApiDetail).toHaveBeenCalledTimes(1);
    expect(logLines()).toContain("Returns backstop linked 1 re-ingested returns to their sales order");
  });

  /*
   * The regression this guards: re-ingesting a return whose order was never ingested
   * cannot resolve the link, so it burns a detail fetch, a write transaction and an
   * audit row every 30 minutes forever. 100 of 102 dev-bed returns are in that state.
   */
  it("does not fetch or upsert a null-linked return whose sales order is absent locally", async () => {
    client.listReturnedOrders.mockResolvedValue([{ salesorder_id: 5 } as any]);
    returnFindUnique.mockResolvedValue({ id: "r1", salesOrderId: null });
    orderFindUnique.mockResolvedValue(null);

    await service.sweep();

    expect(client.getSalesOrder).not.toHaveBeenCalled();
    expect(ingest.upsertFromApiDetail).not.toHaveBeenCalled();
    /* Proves the skip came from the order pre-check, not from a blanket skip-on-existence. */
    expect(orderFindUnique).toHaveBeenCalledTimes(1);
    expect(logLines()).toContain(
      "Returns backstop skipped 1 unlinked returns — sales order not ingested locally",
    );
    expect(logLines().some((l) => l.includes("linked 1 re-ingested"))).toBe(false);
  });

  it("queries a shared absent sales order once per run", async () => {
    client.listReturnedOrders.mockResolvedValue([
      { salesorder_id: 9 } as any,
      { salesorder_id: 9 } as any,
    ]);
    returnFindUnique.mockResolvedValue({ id: "r1", salesOrderId: null });
    orderFindUnique.mockResolvedValue(null);

    await service.sweep();

    expect(orderFindUnique).toHaveBeenCalledTimes(1);
    expect(client.getSalesOrder).not.toHaveBeenCalled();
    expect(logLines()).toContain(
      "Returns backstop skipped 2 unlinked returns — sales order not ingested locally",
    );
  });

  /* The counter reports the link the ingest actually wrote, never the fact that it ran. */
  it("warns instead of claiming a link when the re-ingest comes back still unlinked", async () => {
    client.listReturnedOrders.mockResolvedValue([{ salesorder_id: 3 } as any]);
    returnFindUnique.mockResolvedValue({ id: "r1", salesOrderId: null });
    orderFindUnique.mockResolvedValue({ id: "so-local-1" });
    client.getSalesOrder.mockResolvedValue({ salesorder_id: 3, items: [] } as any);
    ingest.upsertFromApiDetail.mockResolvedValue({ salesOrderId: null });

    await service.sweep();

    expect(ingest.upsertFromApiDetail).toHaveBeenCalledTimes(1);
    expect(logLines().some((l) => l.includes("linked"))).toBe(false);
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toContain(
      "Re-ingest left salesorder 3 unlinked despite a local sales order",
    );
  });

  it("reports new, relinked and skipped returns separately in one run", async () => {
    client.listReturnedOrders.mockResolvedValue([
      { salesorder_id: 10 } as any,
      { salesorder_id: 20 } as any,
      { salesorder_id: 30 } as any,
      { salesorder_id: 40 } as any,
    ]);
    returnFindUnique.mockImplementation(({ where }: any) => {
      if (where.jubelioReturnId === 10) return Promise.resolve(null);
      if (where.jubelioReturnId === 20) return Promise.resolve({ id: "r20", salesOrderId: null });
      if (where.jubelioReturnId === 30) return Promise.resolve({ id: "r30", salesOrderId: null });
      return Promise.resolve({ id: "r40", salesOrderId: "so40" });
    });
    orderFindUnique.mockImplementation(({ where }: any) =>
      where.salesorderId === 20 ? Promise.resolve({ id: "so20" }) : Promise.resolve(null),
    );
    client.getSalesOrder.mockImplementation((id: number) =>
      Promise.resolve({ salesorder_id: id, items: [] } as any),
    );
    ingest.upsertFromApiDetail.mockImplementation((detail: any) =>
      Promise.resolve({ salesOrderId: detail.salesorder_id === 20 ? "so20" : null }),
    );

    await service.sweep();

    /* Only the new row (10) and the healable one (20) cost a Jubelio call. */
    expect(client.getSalesOrder.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    expect(logLines()).toEqual([
      "Returns backstop ingested 1 new returns",
      "Returns backstop linked 1 re-ingested returns to their sales order",
      "Returns backstop skipped 1 unlinked returns — sales order not ingested locally",
    ]);
  });

  it("skips list rows with no salesorder_id and never touches the database", async () => {
    client.listReturnedOrders.mockResolvedValue([{ salesorder_id: 0 } as any]);

    await service.sweep();

    expect(returnFindUnique).not.toHaveBeenCalled();
    expect(client.getSalesOrder).not.toHaveBeenCalled();
  });

  it("aborts the run when the returned-order list itself fails", async () => {
    client.listReturnedOrders.mockRejectedValue(new Error("429"));

    await service.sweep();

    expect(returnFindUnique).not.toHaveBeenCalled();
    expect(client.getSalesOrder).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toContain("listReturnedOrders failed: 429");
  });
});
