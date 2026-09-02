import { Test } from "@nestjs/testing";
import { SalesOrderPickHandler } from "./salesorder-pick.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { JubelioConfig } from "../../jubelio.config";
import { JubelioError } from "../../jubelio.types";
import { JUBELIO_WMS_LOCATION_ID } from "../jubelio-outbox.config";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

const PICKER_EMAIL = "wms@example.com";

function orderFixture(overrides: any = {}) {
  return {
    id: "so1",
    salesorderId: 23043,
    items: [
      {
        salesorderDetailId: 5533730,
        jubelioItemId: 56801,
        qty: 10,
        isCanceledItem: false,
      },
    ],
    ...overrides,
  };
}

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
        { provide: JubelioConfig, useValue: { pickerEmail: PICKER_EMAIL } },
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

  it("posts the create-and-autocomplete picklist body Jubelio validates against", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(orderFixture());
    http.post.mockResolvedValue({ status: "ok" });

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.post).toHaveBeenCalledWith("/wms/sales/picklists/", {
      picklist_id: 0,
      picklist_no: "[auto]",
      is_completed: true,
      is_warehouse: true,
      merge_location: false,
      picker_id: PICKER_EMAIL,
      salesorderIds: [23043],
      items: [
        {
          salesorder_detail_id: 5533730,
          item_id: 56801,
          location_id: JUBELIO_WMS_LOCATION_ID,
          qty_ordered: 10,
          qty_picked: 10,
          salesorder_id: 23043,
          bundle_item_id: 0,
          package_detail_id: 0,
          package_id: 0,
        },
      ],
    });
  });

  it("never sends the bare ids payload Jubelio rejected with a picklist_no error", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(orderFixture());
    http.post.mockResolvedValue({ status: "ok" });

    await handler.handle(baseRow() as any);

    const body = http.post.mock.calls[0][1];
    expect(body).not.toHaveProperty("ids");
    expect(body.picklist_no).toBe("[auto]");
  });

  it("coerces a Prisma Decimal qty to a number", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(
      orderFixture({
        items: [
          {
            salesorderDetailId: 1,
            jubelioItemId: 2,
            qty: { toString: () => "3", valueOf: () => 3 },
            isCanceledItem: false,
          },
        ],
      }),
    );
    http.post.mockResolvedValue({ status: "ok" });

    await handler.handle(baseRow() as any);

    expect(http.post.mock.calls[0][1].items[0]).toMatchObject({
      qty_ordered: 3,
      qty_picked: 3,
    });
  });

  it("drops canceled lines", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(
      orderFixture({
        items: [
          { salesorderDetailId: 1, jubelioItemId: 11, qty: 2, isCanceledItem: false },
          { salesorderDetailId: 2, jubelioItemId: 22, qty: 5, isCanceledItem: true },
        ],
      }),
    );
    http.post.mockResolvedValue({ status: "ok" });

    await handler.handle(baseRow() as any);

    const items = http.post.mock.calls[0][1].items;
    expect(items).toHaveLength(1);
    expect(items[0].item_id).toBe(11);
  });

  it("skips rather than posting an empty picklist when every line is canceled", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(
      orderFixture({
        items: [{ salesorderDetailId: 1, jubelioItemId: 11, qty: 2, isCanceledItem: true }],
      }),
    );

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({
      kind: "skipped",
      reason: OUTBOX_SKIP_REASONS.NO_PUSHABLE_LINES,
    });
    expect(http.post).not.toHaveBeenCalled();
  });

  it("returns skipped when SalesOrder not found", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(null);

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({ kind: "skipped", reason: expect.stringContaining("missing") });
    expect(http.post).not.toHaveBeenCalled();
  });

  it("returns skipped when Jubelio reports the order already moved past PICK", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(orderFixture());
    http.post.mockRejectedValue(
      new JubelioError("An internal server error occurred", 500, {
        code: "error: Pesanan sudah dipakai di transaksi lain. Status Dituju: FINISH_PICK",
      }),
    );

    const result = await handler.handle(baseRow() as any);

    expect(result).toEqual({
      kind: "skipped",
      reason: OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE,
    });
  });

  it("propagates other errors so the outbox retries", async () => {
    prisma.salesOrder.findUnique.mockResolvedValue(orderFixture());
    http.post.mockRejectedValue(new Error("network bork"));

    await expect(handler.handle(baseRow() as any)).rejects.toThrow("network bork");
  });
});
