import { Test } from "@nestjs/testing";
import { JubelioCategoriesService } from "./categories.service";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

describe("JubelioCategoriesService", () => {
  let svc: JubelioCategoriesService;
  let prisma: any;
  let http: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioCategoryMapping: { upsert: jest.fn() },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    http = { get: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioCategoriesService,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    svc = mod.get(JubelioCategoriesService);
  });

  describe("fetchAll", () => {
    it("paginates until response length < pageSize", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({ category_id: i + 1, category_name: `C${i + 1}`, parent_id: null, has_children: false }));
      const page2 = Array.from({ length: 47 }, (_, i) => ({ category_id: 200 + i, category_name: `D${i}`, parent_id: null, has_children: false }));
      http.get.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

      const result = await svc.fetchAll();

      expect(http.get).toHaveBeenCalledTimes(2);
      expect(http.get).toHaveBeenNthCalledWith(1, "/inventory/categories/item-categories/", expect.objectContaining({ query: expect.objectContaining({ page: 1, pageSize: 100 }) }));
      expect(http.get).toHaveBeenNthCalledWith(2, "/inventory/categories/item-categories/", expect.objectContaining({ query: expect.objectContaining({ page: 2, pageSize: 100 }) }));
      expect(result).toHaveLength(147);
    });

    it("computes breadcrumb path by walking parent_id chain", async () => {
      http.get.mockResolvedValueOnce([
        { category_id: 1, category_name: "Pakaian", parent_id: null, has_children: true },
        { category_id: 2, category_name: "Pria", parent_id: 1, has_children: true },
        { category_id: 3, category_name: "Kaos", parent_id: 2, has_children: false },
      ]);

      const result = await svc.fetchAll();

      const leaf = result.find((c) => c.id === 3);
      expect(leaf?.path).toBe("Pakaian > Pria > Kaos");
      expect(leaf?.isLeaf).toBe(true);
      expect(result.find((c) => c.id === 1)?.path).toBe("Pakaian");
    });

    it("orphan parent (parent_id not in set) → path = name only", async () => {
      http.get.mockResolvedValueOnce([
        { category_id: 5, category_name: "Stray", parent_id: 99, has_children: false },
      ]);
      const result = await svc.fetchAll();
      expect(result[0].path).toBe("Stray");
    });

    it("propagates http error", async () => {
      http.get.mockRejectedValueOnce(new Error("Jubelio 503"));
      await expect(svc.fetchAll()).rejects.toThrow("Jubelio 503");
    });
  });

  describe("saveMappings", () => {
    it("upserts each row in a single transaction", async () => {
      prisma.jubelioCategoryMapping.upsert.mockResolvedValue({});
      const result = await svc.saveMappings([
        { itemCategoryId: "cat_a", jubelioCategoryId: 7278 },
        { itemCategoryId: "cat_b", jubelioCategoryId: 7286 },
      ]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.jubelioCategoryMapping.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.jubelioCategoryMapping.upsert).toHaveBeenNthCalledWith(1, {
        where: { itemCategoryId: "cat_a" },
        create: { itemCategoryId: "cat_a", jubelioCategoryId: 7278 },
        update: { jubelioCategoryId: 7278 },
      });
      expect(result).toEqual({ saved: 2 });
    });

    it("rejects duplicate Jubelio ids within input", async () => {
      await expect(
        svc.saveMappings([
          { itemCategoryId: "cat_a", jubelioCategoryId: 7278 },
          { itemCategoryId: "cat_b", jubelioCategoryId: 7278 },
        ]),
      ).rejects.toThrow(/duplicate.*jubelio/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rethrows on prisma P2002", async () => {
      prisma.jubelioCategoryMapping.upsert.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint"), { code: "P2002" }),
      );
      await expect(
        svc.saveMappings([{ itemCategoryId: "cat_a", jubelioCategoryId: 7278 }]),
      ).rejects.toThrow(/Unique constraint/);
    });
  });
});
