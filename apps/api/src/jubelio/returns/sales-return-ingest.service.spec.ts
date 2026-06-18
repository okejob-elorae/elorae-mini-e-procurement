import { Test } from "@nestjs/testing";
import { SalesReturnIngestService } from "./sales-return-ingest.service";

// Mock prisma at the @elorae/db level — match existing pattern in other ingest specs.
jest.mock("@elorae/db", () => ({
  prisma: {
    $transaction: jest.fn(),
    salesReturn: { upsert: jest.fn(), findUnique: jest.fn() },
    salesReturnItem: { upsert: jest.fn() },
    salesOrder: { findUnique: jest.fn() },
    item: { findFirst: jest.fn() },
  },
}));

import { prisma } from "@elorae/db";

describe("SalesReturnIngestService", () => {
  let service: SalesReturnIngestService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [SalesReturnIngestService],
    }).compile();
    service = mod.get(SalesReturnIngestService);
  });

  it("upserts SalesReturn + items inside a single transaction", async () => {
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({
        salesReturn: { upsert: jest.fn().mockResolvedValue({ id: "r1" }) },
        salesReturnItem: { upsert: jest.fn().mockResolvedValue({}) },
        salesOrder: { findUnique: jest.fn().mockResolvedValue(null) },
        item: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    );

    await service.upsertFromApiDetail({
      salesorder_id: 7,
      salesorder_no: "SP-7",
      source_name: "Shop | Tokopedia",
      customer_name: "Jane",
      items: [
        {
          salesorder_detail_id: 11,
          item_code: "SKU-A",
          item_name: "Product A",
          qty_in_base: "2.0000",
          unit_price: "100.00",
          amount: "200.00",
        },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("resolves salesOrderId via existing SalesOrder by salesorderId", async () => {
    let capturedSalesOrderId: string | null = null;
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({
        salesReturn: {
          upsert: jest.fn().mockImplementation(({ create }) => {
            capturedSalesOrderId = create.salesOrderId;
            return Promise.resolve({ id: "r1" });
          }),
        },
        salesReturnItem: { upsert: jest.fn().mockResolvedValue({}) },
        salesOrder: { findUnique: jest.fn().mockResolvedValue({ id: "so-local-1" }) },
        item: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    );

    await service.upsertFromApiDetail({
      salesorder_id: 12345,
      source_name: "Shop | Tokopedia",
      items: [{ salesorder_detail_id: 1, item_code: "SKU-A", item_name: "A", qty_in_base: "1" }],
    });

    expect(capturedSalesOrderId).toBe("so-local-1");
  });

  it("creates fresh row each time when salesorder_detail_id missing (no stable key)", async () => {
    const itemUpsert = jest.fn();
    const itemCreate = jest.fn().mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({
        salesReturn: { upsert: jest.fn().mockResolvedValue({ id: "r1" }) },
        salesReturnItem: { upsert: itemUpsert, create: itemCreate },
        salesOrder: { findUnique: jest.fn().mockResolvedValue(null) },
        item: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    );

    await service.upsertFromApiDetail({
      salesorder_id: 9,
      items: [{ item_code: "SKU-A", item_name: "A", qty_in_base: "1" }],
    });

    expect(itemCreate).toHaveBeenCalledTimes(1);
    expect(itemUpsert).not.toHaveBeenCalled();
  });
});
