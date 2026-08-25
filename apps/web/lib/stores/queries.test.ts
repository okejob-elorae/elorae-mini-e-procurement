import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { updateStore, StoreHasConsignmentStockError, type StoreFields } from "./queries";

/* Store-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("updateStore KONSI → PUTUS guard (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";

  /* A KONSI store still holding a positive StoreStock row. */
  let laggingStoreId = "";

  /* A KONSI store whose StoreStock row nets to exactly zero. */
  let clearedStoreId = "";

  const baseFields = (code: string): StoreFields => ({
    code,
    name: "Test store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "PUTUS",
    paymentTempo: 0,
    marginPercent: 20,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
  });

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    laggingStoreId = "";
    clearedStoreId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-SQ-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-SQ-ITEM-${token}`, nameId: "Store guard item", nameEn: "Store guard item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;

    const laggingStore = await prisma.store.create({
      data: { code: `TEST-SQ-LAG-${token}`, name: "Lagging konsi store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    laggingStoreId = laggingStore.id;
    await prisma.storeStock.create({ data: { storeId: laggingStoreId, itemId, variantSku: "", qty: 4, avgCost: 1000 } });

    const clearedStore = await prisma.store.create({
      data: { code: `TEST-SQ-CLR-${token}`, name: "Cleared konsi store", address: "Test address", termsType: "KONSI", marginPercent: 20, isActive: true },
    });
    clearedStoreId = clearedStore.id;
    await prisma.storeStock.create({ data: { storeId: clearedStoreId, itemId, variantSku: "", qty: 0, avgCost: 1000 } });
  });

  afterEach(async () => {
    await prisma.storeStock.deleteMany({ where: { storeId: { in: [seededId(laggingStoreId), seededId(clearedStoreId)] } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(laggingStoreId), seededId(clearedStoreId)] } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("refuses KONSI → PUTUS while a non-zero StoreStock row remains", async () => {
    await expect(
      updateStore(laggingStoreId, baseFields(`TEST-SQ-LAG-${token}`)),
    ).rejects.toBeInstanceOf(StoreHasConsignmentStockError);

    const stillKonsi = await prisma.store.findUnique({ where: { id: laggingStoreId }, select: { termsType: true } });
    expect(stillKonsi?.termsType).toBe("KONSI");
  });

  it("allows KONSI → PUTUS once the StoreStock row nets to zero", async () => {
    const result = await updateStore(clearedStoreId, baseFields(`TEST-SQ-CLR-${token}`));
    expect(result.termsType).toBe("PUTUS");
  });

  it("allows editing a KONSI store while keeping it KONSI even with stranded stock", async () => {
    const konsiFields = { ...baseFields(`TEST-SQ-LAG-${token}`), termsType: "KONSI" as const, name: "Renamed" };
    const result = await updateStore(laggingStoreId, konsiFields);
    expect(result.termsType).toBe("KONSI");
    expect(result.name).toBe("Renamed");
  });
});
