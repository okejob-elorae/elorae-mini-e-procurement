import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { addAssortmentSkuToOpenDraft } from "./assortment-sync";

/**
 * A SKU added to a store's assortment while a count is open lands on the open DRAFT as an ordinary
 * draft line, never on a submitted document. Never run against prod.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("addAssortmentSkuToOpenDraft (test bed only)", () => {
  let token = "";
  let uomId = "";
  let itemId = "";
  let storeId = "";

  beforeEach(async () => {
    token = "";
    uomId = "";
    itemId = "";
    storeId = "";
    token = Math.floor(Math.random() * 10_000_000).toString();

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-ASY${token}`, nameId: "test", nameEn: "test" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-ASY-${token}`, nameId: "Kaos Test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    const store = await prisma.store.create({
      data: { code: `TST-ASY-${token}`, name: "Test Store", address: "Jl. Test", termsType: "KONSI", isActive: true },
    });
    storeId = store.id;
  });

  afterEach(async () => {
    await prisma.storeStocktake.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeStock.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeAssortmentLine.deleteMany({ where: { storeId: seededId(storeId) } });
    if (storeId) await prisma.store.delete({ where: { id: storeId } });
    if (itemId) await prisma.item.delete({ where: { id: itemId } });
    if (uomId) await prisma.uOM.delete({ where: { id: uomId } });
  });

  async function openDoc(status: "DRAFT" | "PENDING_VERIFICATION") {
    return prisma.storeStocktake.create({
      data: { docNo: `STK/TEST-ASY/${token}`, storeId, status, openKey: storeId, countedAt: new Date(), createdById: "test" },
      select: { id: true },
    });
  }

  it("adds the SKU to an open DRAFT at its live StoreStock figure, not as an added line", async () => {
    await prisma.storeStock.create({ data: { storeId, itemId, variantSku: "M", qty: 4, avgCost: 0 } });
    const doc = await openDoc("DRAFT");

    expect(await addAssortmentSkuToOpenDraft({ storeId, itemId, variantSku: "M" })).toBe(true);

    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: doc.id } });
    expect(line.variantSku).toBe("M");
    expect(Number(line.expectedQty)).toBe(4);
    expect(line.countedQty).toBeNull();
    expect(line.isAdded).toBe(false);
  });

  it("adds a SKU the store has never received at expectedQty 0", async () => {
    /* The action writes the assortment line first, which is what puts a never-stocked SKU in `buildStocktakeLines`. */
    await prisma.storeAssortmentLine.create({ data: { storeId, itemId, variantSku: "L", createdById: "test" } });
    const doc = await openDoc("DRAFT");
    expect(await addAssortmentSkuToOpenDraft({ storeId, itemId, variantSku: "L" })).toBe(true);
    const line = await prisma.storeStocktakeLine.findFirstOrThrow({ where: { stocktakeId: doc.id } });
    expect(Number(line.expectedQty)).toBe(0);
  });

  it("leaves a submitted document alone, so a full count is not turned into a partial one", async () => {
    const doc = await openDoc("PENDING_VERIFICATION");
    expect(await addAssortmentSkuToOpenDraft({ storeId, itemId, variantSku: "M" })).toBe(false);
    expect(await prisma.storeStocktakeLine.count({ where: { stocktakeId: doc.id } })).toBe(0);
  });

  it("does nothing when the SKU is already on the draft, or no count is open", async () => {
    expect(await addAssortmentSkuToOpenDraft({ storeId, itemId, variantSku: "M" })).toBe(false);
    const doc = await openDoc("DRAFT");
    await prisma.storeStocktakeLine.create({
      data: { stocktakeId: doc.id, itemId, variantSku: "M", productName: "Kaos Test", expectedQty: 1 },
    });
    expect(await addAssortmentSkuToOpenDraft({ storeId, itemId, variantSku: "M" })).toBe(false);
    expect(await prisma.storeStocktakeLine.count({ where: { stocktakeId: doc.id } })).toBe(1);
  });
});
