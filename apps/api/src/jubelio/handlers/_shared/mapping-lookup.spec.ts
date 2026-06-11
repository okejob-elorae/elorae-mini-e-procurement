import { resolveItemMapping } from "./mapping-lookup";

describe("resolveItemMapping", () => {
  it("returns the matching mapping when jubelioItemId is found", async () => {
    const mapping = { id: "m1", itemId: "i1", erpVariantSku: "SKU-A", jubelioItemId: 42, jubelioItemGroupId: 9, jubelioItemCode: "SKU-A" };
    const tx = {
      jubelioProductMapping: {
        findFirst: jest.fn().mockResolvedValue(mapping),
      },
    };
    const r = await resolveItemMapping(tx as any, 42);
    expect(r).toBe(mapping);
    expect(tx.jubelioProductMapping.findFirst).toHaveBeenCalledWith({ where: { jubelioItemId: 42 } });
  });

  it("returns null when no mapping matches", async () => {
    const tx = {
      jubelioProductMapping: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const r = await resolveItemMapping(tx as any, 999);
    expect(r).toBeNull();
  });
});
