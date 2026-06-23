import { Test } from "@nestjs/testing";
import { SalesOrderPickHandler } from "./salesorder-pick.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

describe("SalesOrderPickHandler", () => {
  let handler: SalesOrderPickHandler;
  let prisma: any;
  let http: { post: jest.Mock };

  beforeEach(async () => {
    prisma = {
      salesOrder: { findUnique: jest.fn() },
    };
    http = { post: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalesOrderPickHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();

    handler = moduleRef.get(SalesOrderPickHandler);
  });

  const baseRow = (overrides = {}) => ({
    id: "ob1",
    entityType: "salesorder_pick",
    entityId: "so1",
    payload: { salesOrderId: "so1", jubelioSalesorderId: 23043 },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  });

  it("happy path: POSTs to Jubelio and returns processed", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockResolvedValue({ status: "ok" });

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("picklist"),
      expect.objectContaining({ ids: [23043] }),
    );
  });

  it("returns skipped when SalesOrder not found", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(null);

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "skipped", reason: expect.stringContaining("missing") });
    expect(http.post).not.toHaveBeenCalled();
  });

  it("returns skipped with jubelio_already_in_state when Jubelio rejects with already-picked error", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockRejectedValue(Object.assign(new Error("already picked"), { code: "ALREADY_IN_STATE" }));

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE });
  });

  it("propagates other errors so the outbox retries", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockRejectedValue(new Error("network bork"));

    await expect(handler.handle(baseRow() as any)).rejects.toThrow("network bork");
  });
});
