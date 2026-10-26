import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { matchKey } from "@/lib/items/match-key";
import { getItemAvailabilityBySku } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getItemAvailabilityBySku (test bed only)", () => {
  const sku = `TEST-AVL-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";

  async function seedRow(variantSku: string | null, qtyOnHand: number, reservedQty: number): Promise<void> {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku, qtyOnHand, reservedQty, avgCost: 1000, totalValue: qtyOnHand * 1000 },
    });
  }

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000 },
    });
    itemId = item.id;
  });

  afterEach(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("reads a sold-out variant as 0 rather than leaving it out", async () => {
    await seedRow("RED-M", 5, 5);
    const available = await getItemAvailabilityBySku(itemId);
    expect(available["red-m"]).toBe(0);
  });

  it("takes the MINIMUM where the null and the empty-string variantless rows collide", async () => {
    await seedRow(null, 10, 2);
    await seedRow("", 7, 1);
    const available = await getItemAvailabilityBySku(itemId);
    expect(available[""]).toBe(6);
  });

  it("matches a catalog spelling that differs in case or padding from the stored key", async () => {
    await seedRow("ABC-01", 9, 4);
    const available = await getItemAvailabilityBySku(itemId);
    expect(available[matchKey("abc-01")]).toBe(5);
    expect(available[matchKey("  Abc-01 ")]).toBe(5);
  });

  it("leaves a variant with no row absent so the caller reads it as unknown", async () => {
    await seedRow("ABC-01", 9, 4);
    const available = await getItemAvailabilityBySku(itemId);
    expect(Object.prototype.hasOwnProperty.call(available, "zzz-99")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(available, "constructor")).toBe(false);
  });
});
