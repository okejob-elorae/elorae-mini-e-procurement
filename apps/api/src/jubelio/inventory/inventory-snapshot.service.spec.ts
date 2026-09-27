import { Test } from "@nestjs/testing";
import { InventorySnapshotService } from "./inventory-snapshot.service";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

function group(itemGroupId: number, variants: Array<Record<string, unknown>>) {
  return { item_group_id: itemGroupId, item_name: `G${itemGroupId}`, variants };
}

/* A full page of 200 filler groups, so the service has to ask for the next one. */
function fillerPage(startGroupId: number) {
  return Array.from({ length: 200 }, (_, i) =>
    group(startGroupId + i, [{ item_group_id: startGroupId + i, item_id: 900_000 + startGroupId + i, item_code: "F", end_qty: 1 }]),
  );
}

describe("InventorySnapshotService", () => {
  let svc: InventorySnapshotService;
  let http: { get: jest.Mock };
  let prisma: { jubelioProductMapping: { findMany: jest.Mock } };

  beforeEach(async () => {
    http = { get: jest.fn() };
    prisma = { jubelioProductMapping: { findMany: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [
        InventorySnapshotService,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    svc = mod.get(InventorySnapshotService);
  });

  describe("getSnapshot", () => {
    it("pages through every group until a short page, reading a variant from page 2", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([
        { itemId: "item_1", jubelioItemId: 11, erpVariantSku: "" },
      ]);
      http.get
        .mockResolvedValueOnce({ data: fillerPage(1), totalCount: 201 })
        .mockResolvedValueOnce({
          data: [group(500, [{ item_group_id: 500, item_id: 11, item_code: "A", end_qty: 42 }])],
          totalCount: 201,
        });

      const rows = await svc.getSnapshot();

      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get).toHaveBeenNthCalledWith(1, "/inventory/items/", { query: { page: 1, pageSize: 200 } });
      expect(http.get).toHaveBeenNthCalledWith(2, "/inventory/items/", { query: { page: 2, pageSize: 200 } });
      expect(rows).toEqual([{ itemId: "item_1", variantSku: "", jubelioItemId: 11, jubelioQty: 42 }]);
    });

    it("stops at totalCount even when the last page is exactly full", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([
        { itemId: "item_1", jubelioItemId: 900_001, erpVariantSku: "" },
      ]);
      http.get.mockResolvedValueOnce({ data: fillerPage(1), totalCount: 200 });

      await svc.getSnapshot();

      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it("stops when a page repeats the previous one, instead of looping to the ceiling", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([
        { itemId: "item_1", jubelioItemId: 900_001, erpVariantSku: "" },
      ]);
      http.get.mockResolvedValue({ data: fillerPage(1) });

      await svc.getSnapshot();

      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("returns null — never 0 — for a mapped variant missing from every page", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([
        { itemId: "item_1", jubelioItemId: 11, erpVariantSku: "" },
      ]);
      http.get.mockResolvedValueOnce({ data: [group(1, [{ item_group_id: 1, item_id: 99, item_code: "X", end_qty: 5 }])] });

      const rows = await svc.getSnapshot();

      expect(rows[0].jubelioQty).toBeNull();
    });

    it("reads end_qty only: a missing or invalid end_qty is null even when available_qty is present", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([
        { itemId: "item_1", jubelioItemId: 11, erpVariantSku: "" },
        { itemId: "item_2", jubelioItemId: 12, erpVariantSku: "" },
      ]);
      http.get.mockResolvedValueOnce({
        data: [
          group(1, [
            { item_group_id: 1, item_id: 11, item_code: "A", available_qty: 7 },
            { item_group_id: 1, item_id: 12, item_code: "B", end_qty: null, available_qty: 7 },
          ]),
        ],
      });

      const rows = await svc.getSnapshot();

      expect(rows.map((r) => r.jubelioQty)).toEqual([null, null]);
    });

    it("skips the Jubelio call entirely when nothing is mapped", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([]);

      expect(await svc.getSnapshot()).toEqual([]);
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe("getGroupSnapshot", () => {
    it("reads one group by path and returns each variant's end_qty, null when invalid", async () => {
      http.get.mockResolvedValue({
        item_group_id: 115,
        product_skus: [
          { item_id: 1974, item_code: "A", end_qty: 7 },
          { item_id: 2125, item_code: "B", end_qty: "" },
          { item_id: 2126, item_code: "C", end_qty: "3" },
        ],
      });

      const rows = await svc.getGroupSnapshot(115);

      expect(http.get).toHaveBeenCalledWith("/inventory/items/group/115");
      expect(rows).toEqual([
        { jubelioItemId: 1974, endQty: 7 },
        { jubelioItemId: 2125, endQty: null },
        { jubelioItemId: 2126, endQty: 3 },
      ]);
    });
  });
});
