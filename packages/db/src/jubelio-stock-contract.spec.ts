import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import {
  offlineReservedQty,
  offlineReservedByKey,
  jubelioEndQtyFor,
  eloraeOnHandFromJubelio,
  isValidJubelioQty,
  parseJubelioQty,
  isJubelioStockPushEnabled,
  effectiveOfflineReservedQty,
  effectiveOfflineReservedByKey,
  JUBELIO_STOCK_PUSH_ENABLED_KEY,
} from "./jubelio-stock-contract";
import { applyJubelioStockAdjustment } from "./stock-writer";
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

describe("parseJubelioQty", () => {
  it("accepts a finite non-negative number as-is", () => {
    expect(parseJubelioQty(0)).toBe(0);
    expect(parseJubelioQty(12.5)).toBe(12.5);
  });

  it("accepts a plain decimal string", () => {
    expect(parseJubelioQty("12")).toBe(12);
    expect(parseJubelioQty("12.5")).toBe(12.5);
    expect(parseJubelioQty("0")).toBe(0);
  });

  /* Number(null) and Number("") are both 0 — the raw value has to be checked before coercing. */
  it("rejects null and the empty string instead of reading them as 0", () => {
    expect(parseJubelioQty(null)).toBeNull();
    expect(parseJubelioQty("")).toBeNull();
    expect(parseJubelioQty(undefined)).toBeNull();
  });

  it("rejects negatives, non-finite numbers and non-numeric strings", () => {
    expect(parseJubelioQty(-1)).toBeNull();
    expect(parseJubelioQty("-1")).toBeNull();
    expect(parseJubelioQty(NaN)).toBeNull();
    expect(parseJubelioQty(Infinity)).toBeNull();
    expect(parseJubelioQty("abc")).toBeNull();
    expect(parseJubelioQty(" 5")).toBeNull();
    expect(parseJubelioQty("1e3")).toBeNull();
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

/**
 * Snapshots the real dev-bed value of the push switch and puts it back after each test, so these
 * specs never delete or leave behind a value an operator configured on :3308.
 */
function preservePushSwitch(): void {
  const key = JUBELIO_STOCK_PUSH_ENABLED_KEY;
  let original: string | null = null;

  beforeEach(async () => {
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    original = existing?.value ?? null;
  });

  afterEach(async () => {
    if (original === null) {
      await prisma.systemSetting.deleteMany({ where: { key } });
    } else {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: original },
        create: { key, value: original },
      });
    }
  });
}

async function setPushSwitch(value: string | null): Promise<void> {
  const key = JUBELIO_STOCK_PUSH_ENABLED_KEY;
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

d("isJubelioStockPushEnabled (test bed only)", () => {
  preservePushSwitch();

  it("is true only when the stored value is exactly \"true\"", async () => {
    await setPushSwitch("true");
    expect(await isJubelioStockPushEnabled(prisma)).toBe(true);
  });

  it("fails closed on a malformed value", async () => {
    await setPushSwitch("TRUE");
    expect(await isJubelioStockPushEnabled(prisma)).toBe(false);
  });

  it("fails closed on the explicit disabled value", async () => {
    await setPushSwitch("false");
    expect(await isJubelioStockPushEnabled(prisma)).toBe(false);
  });

  it("fails closed when the setting row is absent", async () => {
    await setPushSwitch(null);
    expect(await isJubelioStockPushEnabled(prisma)).toBe(false);
  });
});

d("effectiveOfflineReservedQty / effectiveOfflineReservedByKey (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  const variantSku = "";
  const sku = `TEST-JBSC3-${Math.random().toString(36).slice(2, 10)}`;

  preservePushSwitch();

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    itemId = "";
    uomId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    await prisma.stockReservation.create({
      data: { itemId, variantSku, qty: 4, consumedQty: 0, state: "RESERVED", source: "FIELD_SALES" },
    });
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("returns the open holds while pushes are enabled", async () => {
    await setPushSwitch("true");
    expect(await effectiveOfflineReservedQty(prisma, itemId, variantSku)).toBe(4);
    const map = await effectiveOfflineReservedByKey(prisma, [{ itemId, variantSku }]);
    expect(map.get(`${itemId}:${variantSku}`)).toBe(4);
  });

  it("returns 0 while pushes are disabled, because no push has netted the holds out of end_qty", async () => {
    await setPushSwitch("false");
    expect(await effectiveOfflineReservedQty(prisma, itemId, variantSku)).toBe(0);
    const map = await effectiveOfflineReservedByKey(prisma, [{ itemId, variantSku }]);
    expect(map.get(`${itemId}:${variantSku}`)).toBe(0);
  });
});

/*
 * The stock webhook's apply, against the real writer. It lives in THIS file, not its own, because
 * both read and flip the shared push switch and packages/db runs spec files in parallel: two files
 * toggling one SystemSetting row would race each other.
 */
d("applyJubelioStockAdjustment (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  const sku = `TEST-JBSW-${Math.random().toString(36).slice(2, 10)}`;
  let keySeq = 0;

  preservePushSwitch();

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    itemId = "";
    uomId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
  });

  afterEach(async () => {
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function seedStock(opts: { qtyOnHand: number; variantSku?: string | null; hold?: number }) {
    await prisma.inventoryValue.create({
      data: {
        itemId,
        variantSku: opts.variantSku === undefined ? "" : opts.variantSku,
        qtyOnHand: opts.qtyOnHand,
        avgCost: 10,
        totalValue: opts.qtyOnHand * 10,
      },
    });
    if (opts.hold) {
      await prisma.stockReservation.create({
        data: { itemId, variantSku: "", qty: opts.hold, consumedQty: 0, state: "RESERVED", source: "FIELD_SALES" },
      });
    }
  }

  function nextKey(): string {
    keySeq += 1;
    return `${sku}-${keySeq}`;
  }

  async function apply(jubelioEndQty: number, idempotencyKey: string, variantSku = "") {
    return applyJubelioStockAdjustment(prisma, {
      itemId,
      variantSku,
      jubelioEndQty,
      idempotencyKey,
      externalRef: "spec",
      reason: "spec",
    });
  }

  async function onHand(): Promise<number> {
    const row = await prisma.inventoryValue.findFirst({ where: { itemId } });
    return Number(row!.qtyOnHand);
  }

  it("applies to the named variant's row only, leaving a sibling variant of the same item untouched", async () => {
    await setPushSwitch("false");
    /* The sibling first, so it takes the lower id: a lock that dropped its variant filter would pick it. */
    await seedStock({ qtyOnHand: 5, variantSku: "SPEC-VAR-L" });
    await seedStock({ qtyOnHand: -3, variantSku: "SPEC-VAR-M" });

    const res = await apply(4, nextKey(), "SPEC-VAR-M");

    expect(res.skipped).toBe(false);
    const m = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: "SPEC-VAR-M" } });
    const l = await prisma.inventoryValue.findFirst({ where: { itemId, variantSku: "SPEC-VAR-L" } });
    expect(Number(m!.qtyOnHand)).toBe(4);
    expect(Number(l!.qtyOnHand)).toBe(5);
  });

  it("switch off: applies end_qty as-is, even with a FIELD_SALES hold, with one StockAdjustment and one ledger row", async () => {
    await setPushSwitch("false");
    await seedStock({ qtyOnHand: 10, hold: 2 });

    const res = await apply(6, nextKey());

    expect(res.skipped).toBe(false);
    expect(await onHand()).toBe(6);

    const adjustments = await prisma.stockAdjustment.findMany({ where: { itemId } });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].source).toBe("JUBELIO_WEBHOOK");
    expect(Number(adjustments[0].prevQty)).toBe(10);
    expect(Number(adjustments[0].newQty)).toBe(6);

    const ledger = await prisma.stockLedgerEntry.findMany({ where: { itemId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("ADJUSTMENT");
    expect(ledger[0].refType).toBe("JubelioStockAdjustment");
    expect(Number(ledger[0].qty)).toBe(-4);
    expect(Number(ledger[0].balanceQty)).toBe(6);
  });

  it("switch on: adds the open FIELD_SALES hold back onto end_qty", async () => {
    await setPushSwitch("true");
    await seedStock({ qtyOnHand: 10, hold: 2 });

    await apply(6, nextKey());

    expect(await onHand()).toBe(8);
  });

  it("the same idempotency key twice writes once; the replay is skipped and moves nothing", async () => {
    await setPushSwitch("false");
    await seedStock({ qtyOnHand: 10 });
    const key = nextKey();

    const first = await apply(6, key);
    const second = await apply(3, key);

    expect(first.skipped).toBe(false);
    expect(second).toEqual({ adjustmentId: null, skipped: true });
    expect(await onHand()).toBe(6);
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(1);
  });

  it("maps a P2002 on the docNumber to an idempotent skip, writing nothing", async () => {
    await setPushSwitch("false");
    await seedStock({ qtyOnHand: 10 });
    const key = nextKey();
    /* Same docNumber, different idempotencyKey: the replay read misses, the insert collides. */
    await prisma.stockAdjustment.create({
      data: {
        docNumber: `JBL-${key}`,
        itemId,
        type: "POSITIVE",
        qtyChange: 0,
        reason: "spec collision",
        prevQty: 10,
        newQty: 10,
        prevAvgCost: 10,
        newAvgCost: 10,
        idempotencyKey: `${key}-other`,
      },
    });

    const res = await apply(6, key);

    expect(res).toEqual({ adjustmentId: null, skipped: true });
    expect(await onHand()).toBe(10);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(0);
  });

  it("a zero delta still records the StockAdjustment but writes no ledger row", async () => {
    await setPushSwitch("false");
    await seedStock({ qtyOnHand: 10 });

    await apply(10, nextKey());

    expect(await onHand()).toBe(10);
    expect(await prisma.stockAdjustment.count({ where: { itemId } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId } })).toBe(0);
  });

  it("finds a variantless row stored as null when called with \"\"", async () => {
    await setPushSwitch("false");
    await seedStock({ qtyOnHand: 10, variantSku: null });

    await apply(7, nextKey());

    expect(await onHand()).toBe(7);
  });
});

