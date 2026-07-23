import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { getLoadableInventory, getVanStock } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("canvassing queries (test bed only)", () => {
  const tag = `VQRY-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = ""; let itemId = ""; let canvasserId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: {
        sku: tag, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000,
        variants: [{ sku: `${tag}-M`, size: "M" }, { sku: `${tag}-L`, size: "L" }],
      },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: `${tag}-M`, qtyOnHand: 50, reservedQty: 5, avgCost: 1000, totalValue: 50000 } });
    await prisma.inventoryValue.create({ data: { itemId, variantSku: `${tag}-L`, qtyOnHand: 30, reservedQty: 0, avgCost: 1000, totalValue: 30000 } });
    const canv = await prisma.user.create({ data: { email: `q-${tag}@test.local`, name: "Q Canvasser" } });
    canvasserId = canv.id;
    await prisma.vanStock.create({ data: { userId: canvasserId, itemId, variantSku: `${tag}-M`, qty: 8, avgCost: 1000 } });
  });

  afterEach(async () => {
    await prisma.vanStock.deleteMany({ where: { itemId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
    await prisma.user.deleteMany({ where: { id: canvasserId } });
  });

  it("getLoadableInventory returns per-variant available (qtyOnHand - reservedQty)", async () => {
    const rows = await getLoadableInventory([itemId]);
    const m = rows.find((r) => r.variantSku === `${tag}-M`);
    const l = rows.find((r) => r.variantSku === `${tag}-L`);
    expect(m!.available).toBe(45); // 50 - 5
    expect(l!.available).toBe(30);
  });

  it("getVanStock includes a human variantLabel from the item's variants JSON", async () => {
    const rows = await getVanStock(canvasserId);
    const row = rows.find((r) => r.variantSku === `${tag}-M`);
    expect(row!.variantLabel).toBe("size: M");
  });
});
