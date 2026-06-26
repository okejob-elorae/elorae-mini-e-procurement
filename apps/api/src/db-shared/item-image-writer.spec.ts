import {
  upsertJubelioImage,
  pruneJubelioOrphans,
  bindJubelioId,
} from "../../../../packages/db/src/item-image-writer";

describe("item-image-writer", () => {
  describe("upsertJubelioImage", () => {
    it("inserts when jubelioImageId not present", async () => {
      const tx: any = {
        itemImage: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: "new-1" }),
          update: jest.fn(),
        },
      };
      const r = await upsertJubelioImage(tx, {
        itemId: "i1",
        variantSku: null,
        url: "https://x/y.jpg",
        sortOrder: 0,
        jubelioImageId: "j-1",
      });
      expect(r).toEqual({ id: "new-1", action: "inserted" });
      expect(tx.itemImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jubelioImageId: "j-1",
            source: "JUBELIO_INGEST",
          }),
        }),
      );
    });
    it("updates when jubelioImageId already exists", async () => {
      const tx: any = {
        itemImage: {
          findUnique: jest.fn().mockResolvedValue({ id: "existing-1" }),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn(),
        },
      };
      const r = await upsertJubelioImage(tx, {
        itemId: "i1",
        variantSku: "RED",
        url: "https://x/y.jpg",
        sortOrder: 2,
        jubelioImageId: "j-1",
      });
      expect(r).toEqual({ id: "existing-1", action: "updated" });
      expect(tx.itemImage.update).toHaveBeenCalled();
      expect(tx.itemImage.create).not.toHaveBeenCalled();
    });
  });

  describe("pruneJubelioOrphans", () => {
    it("deletes JUBELIO_INGEST rows not in keepJubelioIds", async () => {
      const tx: any = {
        itemImage: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      };
      const count = await pruneJubelioOrphans(tx, "i1", ["j-1", "j-2"]);
      expect(count).toBe(3);
      expect(tx.itemImage.deleteMany).toHaveBeenCalledWith({
        where: {
          itemId: "i1",
          source: "JUBELIO_INGEST",
          jubelioImageId: { notIn: ["j-1", "j-2"] },
        },
      });
    });
    it("uses sentinel when keepJubelioIds is empty (prevents notIn:[] no-op)", async () => {
      const tx: any = {
        itemImage: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      await pruneJubelioOrphans(tx, "i1", []);
      expect(tx.itemImage.deleteMany).toHaveBeenCalledWith({
        where: {
          itemId: "i1",
          source: "JUBELIO_INGEST",
          jubelioImageId: { notIn: ["__none__"] },
        },
      });
    });
  });

  describe("bindJubelioId", () => {
    it("sets jubelioImageId + syncedAt", async () => {
      const tx: any = {
        itemImage: { update: jest.fn().mockResolvedValue({}) },
      };
      await bindJubelioId(tx, "img-1", "j-99");
      expect(tx.itemImage.update).toHaveBeenCalledWith({
        where: { id: "img-1" },
        data: { jubelioImageId: "j-99", syncedAt: expect.any(Date) },
      });
    });
  });
});
