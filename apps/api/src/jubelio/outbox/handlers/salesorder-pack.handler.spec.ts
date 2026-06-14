import { Test } from "@nestjs/testing";
import { SalesOrderPackHandler } from "./salesorder-pack.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

describe("SalesOrderPackHandler", () => {
  let handler: SalesOrderPackHandler;
  let prisma: any;
  let http: { post: jest.Mock };

  beforeEach(async () => {
    prisma = { salesOrder: { findUnique: jest.fn() } };
    http = { post: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalesOrderPackHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();

    handler = moduleRef.get(SalesOrderPackHandler);
  });

  const baseRow = (overrides = {}) => ({
    id: "ob1",
    entityType: "salesorder_pack",
    entityId: "so1",
    payload: { salesOrderId: "so1", jubelioSalesorderId: 23043 },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  });

  it("happy path: POSTs to mark-as-complete with ids array", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockResolvedValue({ status: "ok" });

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("packlist/mark-as-complete"),
      { ids: [23043] },
    );
  });

  it("returns skipped when SalesOrder not found", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(null);
    const result = await handler.handle(baseRow() as any);
    expect(result.kind).toBe("skipped");
    expect(http.post).not.toHaveBeenCalled();
  });

  it("returns skipped on already-in-state error", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockRejectedValue(Object.assign(new Error("already packed"), { code: "ALREADY_IN_STATE" }));
    const result = await handler.handle(baseRow() as any);
    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE });
  });

  it("propagates other errors", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({ id: "so1", salesorderId: 23043 });
    http.post.mockRejectedValue(new Error("network bork"));
    await expect(handler.handle(baseRow() as any)).rejects.toThrow("network bork");
  });
});
