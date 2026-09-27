import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import {
  offlineReservedQty,
  offlineReservedByKey,
  jubelioEndQtyFor,
  eloraeOnHandFromJubelio,
  isValidJubelioQty,
  isJubelioStockPushEnabled,
  JUBELIO_STOCK_PUSH_ENABLED_KEY,
} from "./jubelio-stock-contract";
import { seededId } from "./spec-teardown";

describe("jubelioEndQtyFor", () => {
  it("subtracts offline reserved from on-hand", () => {
    expect(jubelioEndQtyFor(10, 3)).toBe(7);
  });

  it("floors at 0 when offline reserved exceeds on-hand", () => {
    expect(jubelioEndQtyFor(2, 5)).toBe(0);
  });

  it("passes through unchanged when there is no offline hold", () => {
    expect(jubelioEndQtyFor(50, 0)).toBe(50);
  });
});

describe("eloraeOnHandFromJubelio", () => {
  it("adds the offline hold back onto Jubelio's end_qty", () => {
    expect(eloraeOnHandFromJubelio(6, 2)).toBe(8);
  });

  it("passes through unchanged when there is no offline hold", () => {
    expect(eloraeOnHandFromJubelio(50, 0)).toBe(50);
  });
});

describe("isValidJubelioQty", () => {
  it("accepts a non-negative finite number", () => {
    expect(isValidJubelioQty(0)).toBe(true);
    expect(isValidJubelioQty(42)).toBe(true);
  });

  it("rejects NaN", () => {
    expect(isValidJubelioQty(NaN)).toBe(false);
  });

  it("rejects a negative number", () => {
    expect(isValidJubelioQty(-1)).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(isValidJubelioQty(Infinity)).toBe(false);
    expect(isValidJubelioQty(-Infinity)).toBe(false);
  });

  it("rejects a non-numeric value", () => {
    expect(isValidJubelioQty("50")).toBe(false);
    expect(isValidJubelioQty(null)).toBe(false);
    expect(isValidJubelioQty(undefined)).toBe(false);
  });
});

// Stock-reading — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("offlineReservedQty / offlineReservedByKey (test bed only)", () => {
  let itemId = "";
  let itemId2 = "";
  let uomId = "";
  const variantSku = "";
  const sku = `TEST-JBSC-${Math.random().toString(36).slice(2, 10)}`;
  const sku2 = `TEST-JBSC2-${Math.random().toString(36).slice(2, 10)}`;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    itemId = "";
    itemId2 = "";
    uomId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;

    const item2 = await prisma.item.create({
      data: { sku: sku2, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId2 = item2.id;

    /* JUBELIO — must be excluded regardless of state. */
    await prisma.stockReservation.create({
      data: { itemId, variantSku, qty: 999, consumedQty: 0, state: "RESERVED", source: "JUBELIO" },
    });
    /* FIELD_SALES, partially consumed — 5 − 2 = 3 open. */
    await prisma.stockReservation.create({
      data: { itemId, variantSku, qty: 5, consumedQty: 2, state: "RESERVED", source: "FIELD_SALES" },
    });
    /* FIELD_SALES_KONSI, fully open — +4. */
    await prisma.stockReservation.create({
      data: { itemId, variantSku, qty: 4, consumedQty: 0, state: "RESERVED", source: "FIELD_SALES_KONSI" },
    });
    /* RELEASED FIELD_SALES — must be excluded (not RESERVED). */
    await prisma.stockReservation.create({
      data: { itemId, variantSku, qty: 100, consumedQty: 0, state: "RELEASED", source: "FIELD_SALES" },
    });
    /* Second item, so the batched lookup has more than one key to fold over. */
    await prisma.stockReservation.create({
      data: { itemId: itemId2, variantSku, qty: 10, consumedQty: 0, state: "RESERVED", source: "FIELD_SALES" },
    });
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({
      where: { itemId: { in: [seededId(itemId), seededId(itemId2)] } },
    });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemId), seededId(itemId2)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("sums qty - consumedQty over non-JUBELIO RESERVED rows only", async () => {
    const result = await offlineReservedQty(prisma, itemId, variantSku);
    expect(result).toBe(7); // 3 (field sales) + 4 (konsi); JUBELIO and RELEASED excluded
  });

  it("returns 0 for an item with no open offline reservations", async () => {
    const result = await offlineReservedQty(prisma, "TEST-JBSC-NO-SUCH-ITEM", variantSku);
    expect(result).toBe(0);
  });

  it("batches across items with one groupBy", async () => {
    const map = await offlineReservedByKey(prisma, [
      { itemId, variantSku },
      { itemId: itemId2, variantSku },
    ]);
    expect(map.get(`${itemId}:${variantSku}`)).toBe(7);
    expect(map.get(`${itemId2}:${variantSku}`)).toBe(10);
  });

  it("fills 0 for a requested key with no reservations", async () => {
    const map = await offlineReservedByKey(prisma, [{ itemId: "TEST-JBSC-NO-SUCH-ITEM", variantSku }]);
    expect(map.get(`TEST-JBSC-NO-SUCH-ITEM:${variantSku}`)).toBe(0);
  });

  it("returns an empty map for an empty key list without querying", async () => {
    const map = await offlineReservedByKey(prisma, []);
    expect(map.size).toBe(0);
  });
});

d("isJubelioStockPushEnabled (test bed only)", () => {
  const key = JUBELIO_STOCK_PUSH_ENABLED_KEY;

  /* This key is not used by any other feature yet, so owning it exclusively is safe. */
  afterEach(async () => {
    await prisma.systemSetting.deleteMany({ where: { key } });
  });

  it("is true only when the stored value is exactly \"true\"", async () => {
    await prisma.systemSetting.create({ data: { key, value: "true" } });
    expect(await isJubelioStockPushEnabled(prisma)).toBe(true);
  });

  it("fails closed on a malformed value", async () => {
    await prisma.systemSetting.create({ data: { key, value: "TRUE" } });
    expect(await isJubelioStockPushEnabled(prisma)).toBe(false);
  });

  it("fails closed on the explicit disabled value", async () => {
    await prisma.systemSetting.create({ data: { key, value: "false" } });
    expect(await isJubelioStockPushEnabled(prisma)).toBe(false);
  });

  it("fails closed when the setting row is absent", async () => {
    expect(await isJubelioStockPushEnabled(prisma)).toBe(false);
  });
});
