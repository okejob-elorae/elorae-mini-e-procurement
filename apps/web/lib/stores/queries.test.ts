import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  createStore,
  updateStore,
  StoreHasConsignmentStockError,
  InvalidPriceDiscountPercentError,
  KonsiPriceDiscountNotAllowedError,
  type StoreFields,
} from "./queries";

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
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
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

d("store price discount guard (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let createdIds: string[] = [];

  const putusFields = (code: string, priceDiscountPercent: number | null): StoreFields => ({
    code,
    name: "Discount guard store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "PUTUS",
    paymentTempo: 0,
    marginPercent: null,
    priceDiscountPercent,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
  });

  const konsiFields = (code: string, priceDiscountPercent: number | null): StoreFields => ({
    code,
    name: "Discount guard konsi store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "KONSI",
    paymentTempo: 0,
    marginPercent: 20,
    priceDiscountPercent,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
  });

  beforeEach(() => {
    createdIds = [];
  });

  afterEach(async () => {
    await prisma.store.deleteMany({ where: { id: { in: createdIds.map((id) => seededId(id)) } } });
  });

  it("accepts a valid percent and stores it", async () => {
    const created = await createStore(putusFields(`TEST-SQ-DISC-OK-${token}`, 15));
    createdIds.push(created.id);
    expect(created.priceDiscountPercent).toBe(15);
  });

  it("accepts null and stores it as null", async () => {
    const created = await createStore(putusFields(`TEST-SQ-DISC-NULL-${token}`, null));
    createdIds.push(created.id);
    expect(created.priceDiscountPercent).toBeNull();
  });

  it("accepts 0 at the lower boundary (0 <= percent)", async () => {
    const created = await createStore(putusFields(`TEST-SQ-DISC-ZERO-${token}`, 0));
    createdIds.push(created.id);
    expect(created.priceDiscountPercent).toBe(0);
  });

  it("refuses a negative percent", async () => {
    await expect(
      createStore(putusFields(`TEST-SQ-DISC-NEG-${token}`, -5)),
    ).rejects.toBeInstanceOf(InvalidPriceDiscountPercentError);
  });

  it("refuses a percent of exactly 100", async () => {
    await expect(
      createStore(putusFields(`TEST-SQ-DISC-100-${token}`, 100)),
    ).rejects.toBeInstanceOf(InvalidPriceDiscountPercentError);
  });

  it("refuses a percent above 100", async () => {
    await expect(
      createStore(putusFields(`TEST-SQ-DISC-150-${token}`, 150)),
    ).rejects.toBeInstanceOf(InvalidPriceDiscountPercentError);
  });

  it("refuses a non-null percent on a KONSI store", async () => {
    await expect(
      createStore(konsiFields(`TEST-SQ-DISC-KONSI-${token}`, 10)),
    ).rejects.toBeInstanceOf(KonsiPriceDiscountNotAllowedError);
  });

  it("allows a KONSI store as long as it carries no discount", async () => {
    const created = await createStore(konsiFields(`TEST-SQ-DISC-KONSI-OK-${token}`, null));
    createdIds.push(created.id);
    expect(created.priceDiscountPercent).toBeNull();
  });

  it("also enforces the range guard on update", async () => {
    const created = await createStore(putusFields(`TEST-SQ-DISC-UPD-${token}`, 10));
    createdIds.push(created.id);
    await expect(
      updateStore(created.id, putusFields(`TEST-SQ-DISC-UPD-${token}`, 100)),
    ).rejects.toBeInstanceOf(InvalidPriceDiscountPercentError);
  });

  it("also enforces the KONSI guard on update", async () => {
    const created = await createStore(putusFields(`TEST-SQ-DISC-UPD2-${token}`, 10));
    createdIds.push(created.id);
    await expect(
      updateStore(created.id, konsiFields(`TEST-SQ-DISC-UPD2-${token}`, 10)),
    ).rejects.toBeInstanceOf(KonsiPriceDiscountNotAllowedError);
  });

  /* The faktur queue reads `Store.npwp` to prefill the buyer NPWP, so both the write in
     `createStore`/`updateStore` and the pass-through in `serializeStore` are load-bearing. */
  it("persists a provided npwp through create and update", async () => {
    const created = await createStore({ ...putusFields(`TEST-SQ-NPWP-${token}`, null), npwp: "01.234.567.8-901.000" });
    createdIds.push(created.id);
    expect(created.npwp).toBe("01.234.567.8-901.000");

    const updated = await updateStore(created.id, { ...putusFields(`TEST-SQ-NPWP-${token}`, null), npwp: "09.876.543.2-109.000" });
    expect(updated.npwp).toBe("09.876.543.2-109.000");
  });
});
