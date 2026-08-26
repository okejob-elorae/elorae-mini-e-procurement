import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { getSellableVanStock } from "./sale-queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getSellableVanStock (test bed only)", () => {
  const tag = `VSTK-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = ""; let itemId = ""; let salesmanId = ""; let storeId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 } });
    itemId = item.id;
    const s = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    salesmanId = s.id;
    await prisma.vanStock.create({ data: { userId: salesmanId, itemId, variantSku: "", qty: 20, avgCost: 2000 } });
    const store = await prisma.store.create({
      data: { code: `${tag}-S`, name: "Disc Store", address: "x", termsType: "PUTUS", priceDiscountPercent: 20 },
    });
    storeId = store.id;
  });

  afterEach(async () => {
    await prisma.vanStock.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
    await prisma.store.delete({ where: { id: storeId } });
  });

  it("prices a discounted store's stock off its priceDiscountPercent", async () => {
    const rows = await getSellableVanStock(salesmanId, storeId);
    const row = rows.find((r) => r.itemId === itemId);
    expect(row?.price).toBe(4000); // 5000 * (1 - 20/100)
  });

  it("prices at list for a walk-in with no storeId", async () => {
    const rows = await getSellableVanStock(salesmanId, null);
    const row = rows.find((r) => r.itemId === itemId);
    expect(row?.price).toBe(5000);
  });

  it("prices at list when storeId is omitted entirely", async () => {
    const rows = await getSellableVanStock(salesmanId);
    const row = rows.find((r) => r.itemId === itemId);
    expect(row?.price).toBe(5000);
  });
});
