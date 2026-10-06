import { Test } from "@nestjs/testing";
import { SalesOrderShipHandler } from "./salesorder-ship.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { JubelioError } from "../../jubelio.types";
import { NonRetryableError } from "../../queue/errors";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

describe("SalesOrderShipHandler", () => {
  let handler: SalesOrderShipHandler;
  let prisma: any;
  let http: { post: jest.Mock };

  beforeEach(async () => {
    prisma = {
      salesOrder: { findUnique: jest.fn() },
      jubelioOutbox: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    http = { post: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalesOrderShipHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();

    handler = moduleRef.get(SalesOrderShipHandler);
  });

  const baseRow = (overrides = {}) => ({
    id: "ob1",
    entityType: "salesorder_ship",
    entityId: "so1",
    payload: { salesOrderId: "so1", jubelioSalesorderId: 23043, courierId: 4 },
    status: "PENDING",
    attempts: 0,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    ...overrides,
  });

  /**
   * Ship carried the same wrong `location_id: 1` as pick and was never reached,
   * because pick failed first — so this had no prod evidence behind it either way.
   * Pinned to the literal for the same reason as the pick spec.
   */
  it("sends the prod-confirmed location id, not the 1 that never existed", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockResolvedValue({ status: "ok" });

    await handler.handle(baseRow() as any);

    expect(http.post.mock.calls[0][1].location_id).toBe(-1);
  });

  it("happy path: POSTs to /wms/shipments/ with courier and order metadata", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: "so1",
      salesorderId: 23043,
      salesorderNo: "TT-23043",
    });
    http.post.mockResolvedValue({ status: "ok" });

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.post).toHaveBeenCalledWith(
      "/wms/shipments/",
      expect.objectContaining({
        courier_new_id: 4,
        shipment_header_id: 0,
      }),
    );
  });

  it("returns skipped when SalesOrder not found", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(null);
    const result = await handler.handle(baseRow() as any);
    expect(result.kind).toBe("skipped");
    expect(http.post).not.toHaveBeenCalled();
  });

  it("returns skipped on already-in-state error", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043, salesorderNo: "TT-23043" });
    http.post.mockRejectedValue(
      new JubelioError("An internal server error occurred", 500, {
        code:
          "error: Pesanan sudah dipakai di transaksi lain. " +
          "Status Dituju: FINISH_SHIP",
      }),
    );
    const result = await handler.handle(baseRow() as any);
    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE });
  });

  it("propagates other errors", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043, salesorderNo: "TT-23043" });
    http.post.mockRejectedValue(new Error("network bork"));
    await expect(handler.handle(baseRow() as any)).rejects.toThrow("network bork");
  });

  it("waits while the salesorder_pack push is PENDING, without touching Jubelio", async () => {
    prisma.jubelioOutbox.findFirst.mockResolvedValue({ id: "p1", status: "PENDING" });
    await expect(handler.handle(baseRow() as any)).rejects.toThrow("has not settled yet");
    expect(prisma.salesOrder.findUnique).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("goes non-retryable when the salesorder_pack push is DEAD", async () => {
    prisma.jubelioOutbox.findFirst.mockResolvedValue({ id: "p1", status: "DEAD" });
    await expect(handler.handle(baseRow() as any)).rejects.toBeInstanceOf(NonRetryableError);
    expect(http.post).not.toHaveBeenCalled();
  });
});
