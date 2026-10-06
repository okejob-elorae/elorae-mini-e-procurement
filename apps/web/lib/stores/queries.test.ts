import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  buildStoreLocationWhere,
  buildStoreNpwpWhere,
  createStore,
  listStores,
  parseStoreLocationFilter,
  parseStoreNpwpFilter,
  updateStore,
  StoreHasConsignmentStockError,
  InvalidPriceDiscountPercentError,
  InvalidMarkupPercentError,
  KonsiPriceDiscountNotAllowedError,
  SellThroughMethodRequiresKonsiError,
  StoreHasDraftSellThroughError,
  type StoreFields,
  type StoreLocationFilter,
  type StoreNpwpFilter,
} from "./queries";
import { closeFieldSalesOrderRemainder } from "@/lib/field-sales/delivery/writer";

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
    markupPercent: 20,
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod: null,
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
      data: { code: `TEST-SQ-LAG-${token}`, name: "Lagging konsi store", address: "Test address", termsType: "KONSI", markupPercent: 20, isActive: true },
    });
    laggingStoreId = laggingStore.id;
    await prisma.storeStock.create({ data: { storeId: laggingStoreId, itemId, variantSku: "", qty: 4, avgCost: 1000 } });

    const clearedStore = await prisma.store.create({
      data: { code: `TEST-SQ-CLR-${token}`, name: "Cleared konsi store", address: "Test address", termsType: "KONSI", markupPercent: 20, isActive: true },
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

  it("leaves the store row untouched when the switch is refused", async () => {
    const before = await prisma.store.findUnique({ where: { id: laggingStoreId }, select: { termsType: true, name: true, updatedAt: true } });

    await expect(
      updateStore(laggingStoreId, { ...baseFields(`TEST-SQ-LAG-${token}`), name: "Changed by a refused switch" }),
    ).rejects.toBeInstanceOf(StoreHasConsignmentStockError);

    const after = await prisma.store.findUnique({ where: { id: laggingStoreId }, select: { termsType: true, name: true, updatedAt: true } });
    expect(after).toEqual(before);
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

d("updateStore KONSI → PUTUS guard over undelivered konsi orders (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let userId = "";
  let storeId = "";
  let orderId = "";

  const putusFields = (): StoreFields => ({
    code: `TEST-SQ-OPEN-${token}`,
    name: "Open konsi order store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "PUTUS",
    paymentTempo: 0,
    markupPercent: 20,
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod: null,
  });

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    storeId = "";
    orderId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-SQO-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-SQO-ITEM-${token}`, nameId: "Open konsi item", nameEn: "Open konsi item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;
    const user = await prisma.user.create({ data: { email: `test-sqo-${token}@example.com`, name: "Test SQO Admin" } });
    userId = user.id;

    /* No StoreStock at all: the only thing holding this store on KONSI is the order below. */
    const store = await prisma.store.create({
      data: { code: `TEST-SQ-OPEN-${token}`, name: "Open konsi order store", address: "Test address", termsType: "KONSI", markupPercent: 20, isActive: true },
    });
    storeId = store.id;
  });

  afterEach(async () => {
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: seededId(orderId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const seedKonsiOrder = async (status: "PENDING_APPROVAL" | "APPROVED") => {
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST-SQO-${token}`,
        orderType: "KONSI",
        storeId,
        salesmanId: userId,
        status,
        subtotal: 3000,
        total: 3000,
        lines: { create: [{ itemId, variantSku: "", productName: "Open konsi item", qty: 3, unitPrice: 1000, lineTotal: 3000 }] },
      },
    });
    orderId = order.id;
  };

  it("refuses the switch while an approved konsi order is undelivered, and allows it once the remainder is closed", async () => {
    await seedKonsiOrder("APPROVED");
    await expect(updateStore(storeId, putusFields())).rejects.toBeInstanceOf(StoreHasConsignmentStockError);
    const stillKonsi = await prisma.store.findUnique({ where: { id: seededId(storeId) }, select: { termsType: true } });
    expect(stillKonsi?.termsType).toBe("KONSI");

    await closeFieldSalesOrderRemainder({ orderId, closedById: userId, reason: "test: store switching terms" });
    const result = await updateStore(storeId, putusFields());
    expect(result.termsType).toBe("PUTUS");
  });

  it("refuses the switch while a konsi order is still awaiting approval", async () => {
    await seedKonsiOrder("PENDING_APPROVAL");
    await expect(updateStore(storeId, putusFields())).rejects.toBeInstanceOf(StoreHasConsignmentStockError);
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
    markupPercent: null,
    priceDiscountPercent,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod: null,
  });

  const konsiFields = (code: string, priceDiscountPercent: number | null): StoreFields => ({
    code,
    name: "Discount guard konsi store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "KONSI",
    paymentTempo: 0,
    markupPercent: 20,
    priceDiscountPercent,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod: null,
  });

  beforeEach(() => {
    createdIds = [];
  });

  afterEach(async () => {
    await prisma.store.deleteMany({ where: { id: { in: createdIds.map((id) => seededId(id)) } } });
  });

  /* A refusal that wrongly succeeds still created a row; record its id so the teardown removes it. */
  const tracked = (created: Promise<{ id: string }>) =>
    created.then((row) => {
      createdIds.push(row.id);
      return row;
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

  it("stores the value it validated, so -0.005 lands as 0 and 99.994 as 99.99", async () => {
    for (const [suffix, given, stored] of [["RNEG", -0.005, 0], ["RDN", 99.994, 99.99]] as const) {
      const created = await createStore(putusFields(`TEST-SQ-DISC-${suffix}-${token}`, given));
      createdIds.push(created.id);
      const row = await prisma.store.findUniqueOrThrow({ where: { id: seededId(created.id) }, select: { priceDiscountPercent: true } });
      expect(Number(row.priceDiscountPercent)).toBe(stored);
    }
  });

  it("refuses a negative percent", async () => {
    await expect(
      tracked(createStore(putusFields(`TEST-SQ-DISC-NEG-${token}`, -5))),
    ).rejects.toBeInstanceOf(InvalidPriceDiscountPercentError);
  });

  it("refuses a percent of exactly 100", async () => {
    await expect(
      tracked(createStore(putusFields(`TEST-SQ-DISC-100-${token}`, 100))),
    ).rejects.toBeInstanceOf(InvalidPriceDiscountPercentError);
  });

  it("refuses a percent above 100", async () => {
    await expect(
      tracked(createStore(putusFields(`TEST-SQ-DISC-150-${token}`, 150))),
    ).rejects.toBeInstanceOf(InvalidPriceDiscountPercentError);
  });

  it("refuses a non-null percent on a KONSI store", async () => {
    await expect(
      tracked(createStore(konsiFields(`TEST-SQ-DISC-KONSI-${token}`, 10))),
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

d("store sell-through method guard (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let createdIds: string[] = [];

  const konsiFields = (code: string, sellThroughMethod: StoreFields["sellThroughMethod"]): StoreFields => ({
    code,
    name: "Sell-through guard konsi store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "KONSI",
    paymentTempo: 0,
    markupPercent: 20,
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod,
  });

  const putusFields = (code: string, sellThroughMethod: StoreFields["sellThroughMethod"]): StoreFields => ({
    code,
    name: "Sell-through guard putus store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "PUTUS",
    paymentTempo: 0,
    markupPercent: null,
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod,
  });

  beforeEach(() => {
    createdIds = [];
  });

  afterEach(async () => {
    await prisma.store.deleteMany({ where: { id: { in: createdIds.map((id) => seededId(id)) } } });
  });

  /* A refusal that wrongly succeeds still created a row; record its id so the teardown removes it. */
  const tracked = (created: Promise<{ id: string }>) =>
    created.then((row) => {
      createdIds.push(row.id);
      return row;
    });

  it("persists SPG_POS on a KONSI store", async () => {
    const created = await createStore(konsiFields(`TEST-SQ-STM-OK-${token}`, "SPG_POS"));
    createdIds.push(created.id);
    expect(created.sellThroughMethod).toBe("SPG_POS");
  });

  it("refuses a non-null method on a PUTUS store", async () => {
    await expect(
      tracked(createStore(putusFields(`TEST-SQ-STM-PUTUS-${token}`, "SPG_POS"))),
    ).rejects.toBeInstanceOf(SellThroughMethodRequiresKonsiError);
  });

  it("refuses switching a KONSI store with a method set to PUTUS unless the same call clears it", async () => {
    const created = await createStore(konsiFields(`TEST-SQ-STM-SWITCH-${token}`, "SHELF_COUNT"));
    createdIds.push(created.id);

    await expect(
      updateStore(created.id, putusFields(`TEST-SQ-STM-SWITCH-${token}`, "SHELF_COUNT")),
    ).rejects.toBeInstanceOf(SellThroughMethodRequiresKonsiError);

    const cleared = await updateStore(created.id, putusFields(`TEST-SQ-STM-SWITCH-${token}`, null));
    expect(cleared.termsType).toBe("PUTUS");
    expect(cleared.sellThroughMethod).toBeNull();
  });
});

d("updateStore KONSI → PUTUS guard over a draft sell-through report (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let storeId = "";

  const fields = (termsType: "KONSI" | "PUTUS"): StoreFields => ({
    code: `TEST-SQ-SLT-${token}`,
    name: "Sell-through draft guard store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType,
    paymentTempo: 0,
    markupPercent: termsType === "KONSI" ? 20 : null,
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod: termsType === "KONSI" ? "SHELF_COUNT" : null,
  });

  beforeEach(async () => {
    storeId = "";
    const created = await createStore(fields("KONSI"));
    storeId = created.id;
  });

  afterEach(async () => {
    await prisma.konsiSellThrough.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  it("refuses the switch while the store has a DRAFT report, and allows it once the report is cancelled", async () => {
    /* Seeded directly: the guard reads only the status, and a real report needs a whole counted period behind it. */
    const report = await prisma.konsiSellThrough.create({
      data: {
        docNo: `SLT/TEST-SQ-${token}`,
        storeId,
        method: "SHELF_COUNT",
        status: "DRAFT",
        closingStocktakeId: `TEST-SQ-STK-${token}`,
        periodEnd: new Date(),
        createdById: `TEST-SQ-USER-${token}`,
      },
      select: { id: true },
    });

    await expect(updateStore(storeId, fields("PUTUS"))).rejects.toBeInstanceOf(StoreHasDraftSellThroughError);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: seededId(storeId) } })).termsType).toBe("KONSI");

    await prisma.konsiSellThrough.update({ where: { id: report.id }, data: { status: "CANCELLED" } });
    const switched = await updateStore(storeId, fields("PUTUS"));
    expect(switched.termsType).toBe("PUTUS");
  });
});

d("store markup guard (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let createdIds: string[] = [];

  const konsiFields = (code: string, markupPercent: number | null): StoreFields => ({
    code,
    name: "Markup guard konsi store",
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "KONSI",
    paymentTempo: 0,
    markupPercent,
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod: null,
  });

  beforeEach(() => {
    createdIds = [];
  });

  afterEach(async () => {
    await prisma.store.deleteMany({ where: { id: { in: createdIds.map((id) => seededId(id)) } } });
  });

  /* A refusal that wrongly succeeds still created a row; record its id so the teardown removes it. */
  const tracked = (created: Promise<{ id: string }>) =>
    created.then((row) => {
      createdIds.push(row.id);
      return row;
    });

  it("stores a valid markup, null, 0 and the column ceiling as given", async () => {
    for (const [suffix, markupPercent] of [["OK", 20], ["NULL", null], ["ZERO", 0], ["MAX", 999.99]] as const) {
      const created = await createStore(konsiFields(`TEST-SQ-MKP-${suffix}-${token}`, markupPercent));
      createdIds.push(created.id);
      expect(created.markupPercent).toBe(markupPercent);
    }
  });

  /**
   * The writer persists the value it validated. A raw -0.005 would otherwise pass the guard (it
   * rounds to 0) and land as -0.01, since MariaDB rounds half away from zero — a stored markup every
   * SPG sale at the store then refuses as `NO_PRICE`.
   */
  it("stores the value it validated, so -0.005 lands as 0 and 999.994 as 999.99", async () => {
    for (const [suffix, given, stored] of [["RNEG", -0.005, 0], ["RDN", 999.994, 999.99]] as const) {
      const created = await createStore(konsiFields(`TEST-SQ-MKP-${suffix}-${token}`, given));
      createdIds.push(created.id);
      expect(created.markupPercent).toBe(stored);
      const row = await prisma.store.findUniqueOrThrow({ where: { id: seededId(created.id) }, select: { markupPercent: true } });
      expect(Number(row.markupPercent)).toBe(stored);
    }
  });

  it("stores the rounded value on update too", async () => {
    const created = await createStore(konsiFields(`TEST-SQ-MKP-URND-${token}`, 20));
    createdIds.push(created.id);
    const updated = await updateStore(created.id, konsiFields(`TEST-SQ-MKP-URND-${token}`, -0.005));
    expect(updated.markupPercent).toBe(0);
    const row = await prisma.store.findUniqueOrThrow({ where: { id: seededId(created.id) }, select: { markupPercent: true } });
    expect(Number(row.markupPercent)).toBe(0);
  });

  it("refuses a negative markup, one above the ceiling, and one that rounds above it in the column", async () => {
    for (const [suffix, markupPercent] of [["NEG", -1], ["OVER", 1000], ["RUP", 999.996]] as const) {
      await expect(tracked(createStore(konsiFields(`TEST-SQ-MKP-${suffix}-${token}`, markupPercent)))).rejects.toBeInstanceOf(
        InvalidMarkupPercentError,
      );
    }
  });

  it("refuses an out-of-range markup on update too, and leaves the stored one alone", async () => {
    const created = await createStore(konsiFields(`TEST-SQ-MKP-UPD-${token}`, 20));
    createdIds.push(created.id);
    await expect(updateStore(created.id, konsiFields(`TEST-SQ-MKP-UPD-${token}`, 1000))).rejects.toBeInstanceOf(
      InvalidMarkupPercentError,
    );
    const row = await prisma.store.findUniqueOrThrow({ where: { id: seededId(created.id) }, select: { markupPercent: true } });
    expect(Number(row.markupPercent)).toBe(20);
  });
});

describe("store location filter where builder", () => {
  it("treats undefined as no filter and never an empty where", () => {
    expect(buildStoreLocationWhere(undefined)).toBeUndefined();
  });

  it("parses only the known values", () => {
    expect(parseStoreLocationFilter("missing")).toBe("missing");
    expect(parseStoreLocationFilter("defaultRadius")).toBe("defaultRadius");
    expect(parseStoreLocationFilter("customRadius")).toBe("customRadius");
    expect(parseStoreLocationFilter("")).toBeUndefined();
    expect(parseStoreLocationFilter("bogus")).toBeUndefined();
    expect(parseStoreLocationFilter(undefined)).toBeUndefined();
  });
});

d("listStores location filter (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const createdIds: string[] = [];

  const fields = (suffix: string, over: Partial<StoreFields>): StoreFields => ({
    code: `TEST-LOC-${suffix}-${token}`,
    name: `Location ${suffix}`,
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "PUTUS",
    paymentTempo: 0,
    markupPercent: null,
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod: null,
    ...over,
  });

  let noCoordsId = "";
  let halfCoordsId = "";
  let defaultRadiusId = "";
  let customRadiusId = "";
  let customNoCoordsId = "";

  beforeEach(async () => {
    createdIds.length = 0;
    const seed = async (suffix: string, over: Partial<StoreFields>) => {
      const created = await createStore(fields(suffix, over));
      createdIds.push(created.id);
      return created.id;
    };
    noCoordsId = await seed("NONE", {});
    halfCoordsId = await seed("HALF", { lat: -6.2, lng: null });
    defaultRadiusId = await seed("DEF", { lat: -6.2, lng: 106.8 });
    customRadiusId = await seed("CUS", { lat: -6.2, lng: 106.8, checkinRadiusMeters: 250 });
    customNoCoordsId = await seed("CNC", { checkinRadiusMeters: 50 });
  });

  afterEach(async () => {
    for (const id of createdIds) await prisma.store.delete({ where: { id: seededId(id) } });
  });

  async function idsFor(location: StoreLocationFilter | undefined) {
    const { items } = await listStores({ search: token, location });
    return items.map((s) => s.id).sort();
  }

  it("returns all five seeded stores with no location filter", async () => {
    expect(await idsFor(undefined)).toEqual(
      [noCoordsId, halfCoordsId, defaultRadiusId, customRadiusId, customNoCoordsId].sort(),
    );
  });

  it("missing returns stores lacking lat or lng, overridden radius or not", async () => {
    expect(await idsFor("missing")).toEqual([noCoordsId, halfCoordsId, customNoCoordsId].sort());
  });

  it("defaultRadius returns geocoded stores with no override", async () => {
    expect(await idsFor("defaultRadius")).toEqual([defaultRadiusId]);
  });

  it("customRadius returns geocoded stores with an override, never an ungeocoded one", async () => {
    expect(await idsFor("customRadius")).toEqual([customRadiusId]);
  });

  it("combines with search instead of overwriting it", async () => {
    const { items } = await listStores({ search: `NONE-${token}`, location: "missing" });
    expect(items.map((s) => s.id)).toEqual([noCoordsId]);
  });
});

describe("store NPWP filter where builder", () => {
  it("treats undefined as no filter and never an empty where", () => {
    expect(buildStoreNpwpWhere(undefined)).toBeUndefined();
  });

  it("parses only the known values", () => {
    expect(parseStoreNpwpFilter("missing")).toBe("missing");
    expect(parseStoreNpwpFilter("present")).toBe("present");
    expect(parseStoreNpwpFilter("")).toBeUndefined();
    expect(parseStoreNpwpFilter("bogus")).toBeUndefined();
    expect(parseStoreNpwpFilter(undefined)).toBeUndefined();
  });
});

d("listStores NPWP filter (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const createdIds: string[] = [];

  const fields = (suffix: string, over: Partial<StoreFields>): StoreFields => ({
    code: `TEST-NPWP-${suffix}-${token}`,
    name: `Npwp ${suffix}`,
    address: "Test address",
    phone: null,
    contactName: null,
    termsType: "PUTUS",
    paymentTempo: 0,
    markupPercent: null,
    priceDiscountPercent: null,
    creditLimit: null,
    npwp: null,
    lat: null,
    lng: null,
    checkinRadiusMeters: null,
    sellThroughMethod: null,
    ...over,
  });

  let nullNpwpId = "";
  let emptyNpwpId = "";
  let spacesNpwpId = "";
  let tabNpwpId = "";
  let filledNpwpId = "";

  async function seed(suffix: string, over: Partial<StoreFields>): Promise<string> {
    const created = await createStore(fields(suffix, over));
    createdIds.push(created.id);
    return created.id;
  }

  /* The writers now normalise a blank NPWP to null, so the legacy spellings are planted directly. */
  async function seedLegacy(suffix: string, npwp: string): Promise<string> {
    const id = await seed(suffix, { npwp: null });
    await prisma.store.update({ where: { id: seededId(id) }, data: { npwp } });
    return id;
  }

  beforeEach(async () => {
    createdIds.length = 0;
    nullNpwpId = "";
    emptyNpwpId = "";
    spacesNpwpId = "";
    tabNpwpId = "";
    filledNpwpId = "";
    nullNpwpId = await seed("NULL", { npwp: null });
    emptyNpwpId = await seedLegacy("EMPTY", "");
    spacesNpwpId = await seedLegacy("SPACES", "   ");
    tabNpwpId = await seedLegacy("TAB", "\t");
    filledNpwpId = await seed("FILLED", { npwp: "01.234.567.8-901.000" });
  });

  afterEach(async () => {
    for (const id of createdIds) await prisma.store.delete({ where: { id: seededId(id) } });
  });

  async function idsFor(opts: { npwp?: StoreNpwpFilter; location?: StoreLocationFilter }) {
    const { items } = await listStores({ search: token, ...opts });
    return items.map((s) => s.id).sort();
  }

  it("missing returns stores whose NPWP is null, empty or spaces only, and never a filled one", async () => {
    const missing = await idsFor({ npwp: "missing" });
    expect(missing).toEqual(expect.arrayContaining([nullNpwpId, emptyNpwpId, spacesNpwpId]));
    expect(missing).not.toContain(filledNpwpId);
  });

  it("present is the exact complement of missing", async () => {
    const all = await idsFor({});
    const missing = await idsFor({ npwp: "missing" });
    const present = await idsFor({ npwp: "present" });
    expect(present).toContain(filledNpwpId);
    expect(present.filter((id) => missing.includes(id))).toEqual([]);
    expect([...missing, ...present].sort()).toEqual(all);
  });

  it("flags each row's npwpMissing exactly as the missing filter buckets it, whatever the collation does with a tab", async () => {
    const missing = new Set(await idsFor({ npwp: "missing" }));
    const { items } = await listStores({ search: token });
    expect(items.map((s) => s.id).sort()).toEqual(
      [nullNpwpId, emptyNpwpId, spacesNpwpId, tabNpwpId, filledNpwpId].sort(),
    );
    for (const s of items) expect(s.npwpMissing).toBe(missing.has(s.id));
  });

  it("applies the location filter and the NPWP filter together instead of one overwriting the other", async () => {
    expect(await idsFor({ npwp: "present", location: "missing" })).toContain(filledNpwpId);
    expect(await idsFor({ npwp: "missing", location: "missing" })).not.toContain(filledNpwpId);
    expect(await idsFor({ npwp: "missing", location: "defaultRadius" })).toEqual([]);
  });

  it("trims the NPWP on create and update, storing a blank one as null", async () => {
    const id = await seed("TRIM", { npwp: "  01.234.567.8-901.000\t" });
    let row = await prisma.store.findUniqueOrThrow({ where: { id: seededId(id) }, select: { npwp: true } });
    expect(row.npwp).toBe("01.234.567.8-901.000");

    await updateStore(id, fields("TRIM", { npwp: " \t " }));
    row = await prisma.store.findUniqueOrThrow({ where: { id: seededId(id) }, select: { npwp: true } });
    expect(row.npwp).toBeNull();
  });
});
