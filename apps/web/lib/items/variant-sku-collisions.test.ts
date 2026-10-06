import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { findVariantSkuCollisions } from "./variant-sku-collisions";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("findVariantSkuCollisions (test bed only)", () => {
  let token = "";
  let uomId = "";
  let itemAId = "";
  let itemBId = "";
  let itemBSku = "";

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10).toUpperCase();
    uomId = "";
    itemAId = "";
    itemBId = "";
    const uom = await prisma.uOM.create({
      data: { code: `TEST-VSC-UOM-${token}`, nameId: "pcs", nameEn: "pcs" },
    });
    uomId = uom.id;
    const a = await prisma.item.create({
      data: {
        sku: `TST-A-${token}`,
        nameId: "t",
        nameEn: "t",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        variants: [{ Warna: "Merah", sku: `TST-A-${token}-MERAH` }],
      },
    });
    itemAId = a.id;
    itemBSku = `TST-B-${token}`;
    const b = await prisma.item.create({
      data: {
        sku: itemBSku,
        nameId: "t",
        nameEn: "t",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        variants: [],
      },
    });
    itemBId = b.id;
  });

  afterEach(async () => {
    if (itemAId) await prisma.item.delete({ where: { id: seededId(itemAId) } });
    if (itemBId) await prisma.item.delete({ where: { id: seededId(itemBId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  it("flags a SKU another item's variant already uses, case-insensitively", async () => {
    const sku = `tst-a-${token.toLowerCase()}-merah`;
    expect(await findVariantSkuCollisions(prisma, { skus: [sku] })).toEqual([sku]);
  });

  it("does not flag the item's own variant SKUs when it is excluded", async () => {
    const sku = `TST-A-${token}-MERAH`;
    expect(await findVariantSkuCollisions(prisma, { excludeItemId: itemAId, skus: [sku] })).toEqual([]);
  });

  it("folds accents the way the collation does", async () => {
    const sku = `TST-A-${token}-MÉRAH`;
    expect(await findVariantSkuCollisions(prisma, { skus: [sku] })).toEqual([sku]);
  });

  it("flags a SKU equal to another item's own SKU", async () => {
    expect(await findVariantSkuCollisions(prisma, { skus: [itemBSku] })).toEqual([itemBSku]);
  });

  it("returns nothing for empty or blank-only input", async () => {
    expect(await findVariantSkuCollisions(prisma, { skus: [] })).toEqual([]);
    expect(await findVariantSkuCollisions(prisma, { skus: ["", "  "] })).toEqual([]);
  });
});
