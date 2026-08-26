import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { getSellableCatalogForSpg } from "./sale-queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("getSellableCatalogForSpg (test bed only)", () => {
  const tag = `SPGCAT-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let shortItemId = "";
  let neverHeldItemId = "";
  let storeAId = "";
  let storeBId = "";
  let discountStoreId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; shortItemId = ""; neverHeldItemId = ""; storeAId = ""; storeBId = ""; discountStoreId = "";
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 },
    });
    itemId = item.id;

    const shortItem = await prisma.item.create({
      data: { sku: `${tag}-SHORT`, nameId: "TS", nameEn: "TS", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 },
    });
    shortItemId = shortItem.id;

    const neverHeldItem = await prisma.item.create({
      data: { sku: `${tag}-NEVER`, nameId: "TN", nameEn: "TN", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 },
    });
    neverHeldItemId = neverHeldItem.id;

    const storeA = await prisma.store.create({
      data: { code: `${tag}-A`, name: "Toko SPG Catalog A", address: "Jl. Test A", termsType: "KONSI", isActive: true },
    });
    storeAId = storeA.id;

    const storeB = await prisma.store.create({
      data: { code: `${tag}-B`, name: "Toko SPG Catalog B", address: "Jl. Test B", termsType: "KONSI", isActive: true },
    });
    storeBId = storeB.id;

    const discountStore = await prisma.store.create({
      data: { code: `${tag}-DISC`, name: "Toko SPG Catalog Diskon", address: "Jl. Test C", termsType: "PUTUS", priceDiscountPercent: 25, isActive: true },
    });
    discountStoreId = discountStore.id;

    /* storeA holds 7 of itemId; storeB holds 3 of the same item — proves the figure is per-store. */
    await prisma.storeStock.create({ data: { storeId: storeAId, itemId, variantSku: "", qty: 7, avgCost: 0 } });
    await prisma.storeStock.create({ data: { storeId: storeBId, itemId, variantSku: "", qty: 3, avgCost: 0 } });
    /* storeA holds -2 of shortItemId — the ledger missed something; must render as negative, never clamped. */
    await prisma.storeStock.create({ data: { storeId: storeAId, itemId: shortItemId, variantSku: "", qty: -2, avgCost: 0 } });
    /* Deliberately no StoreStock row for (storeAId, neverHeldItemId) — the store never held it. */
  });

  afterEach(async () => {
    const storeIds = [seededId(storeAId), seededId(storeBId), seededId(discountStoreId)];
    await prisma.storeStock.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemId), seededId(shortItemId), seededId(neverHeldItemId)] } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("reports the on-counter quantity for the queried store only", async () => {
    const rowsA = await getSellableCatalogForSpg(seededId(storeAId));
    const rowA = rowsA.find((r) => r.itemId === itemId && r.variantSku === null)!;
    expect(rowA.onCounterQty).toBe(7);

    const rowsB = await getSellableCatalogForSpg(seededId(storeBId));
    const rowB = rowsB.find((r) => r.itemId === itemId && r.variantSku === null)!;
    expect(rowB.onCounterQty).toBe(3);
  });

  it("returns a negative on-counter quantity as negative", async () => {
    const rows = await getSellableCatalogForSpg(seededId(storeAId));
    const row = rows.find((r) => r.itemId === shortItemId && r.variantSku === null)!;
    expect(row.onCounterQty).toBe(-2);
  });

  it("still offers an item the store has never held, at zero", async () => {
    const rows = await getSellableCatalogForSpg(seededId(storeAId));
    const row = rows.find((r) => r.itemId === neverHeldItemId);
    expect(row).toBeDefined();
    expect(row!.onCounterQty).toBe(0);
  });

  it("prices off the store's priceDiscountPercent, and at list for a store with none", async () => {
    const discounted = await getSellableCatalogForSpg(seededId(discountStoreId));
    const discountedRow = discounted.find((r) => r.itemId === itemId && r.variantSku === null)!;
    expect(discountedRow.price).toBe(3750); // 5000 * (1 - 25/100)

    const undiscounted = await getSellableCatalogForSpg(seededId(storeAId));
    const undiscountedRow = undiscounted.find((r) => r.itemId === itemId && r.variantSku === null)!;
    expect(undiscountedRow.price).toBe(5000);
  });
});
