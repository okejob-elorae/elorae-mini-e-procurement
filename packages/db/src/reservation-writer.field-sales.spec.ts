import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import {
  reserveFieldSalesOrder,
  consumeFieldSalesOrder,
  consumeFieldSalesOrderPartial,
  releaseFieldSalesOrder,
  reserveKonsiFieldSalesOrder,
} from "./reservation-writer";
import { seededId } from "./spec-teardown";

// Stock-mutating — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("field-sales reservation fns (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  const variantSku = "";
  const sku = `TEST-FS-${Math.random().toString(36).slice(2, 10)}`;

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
    await prisma.inventoryValue.create({
      data: { itemId, variantSku, qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 },
    });
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("reserve increments reservedQty and is idempotent per fieldSalesLineId", async () => {
    const lineId = `line-${sku}-1`;
    const r1 = await reserveFieldSalesOrder(prisma, { orderNo: "PUTUS-T-1", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 6 }] });
    expect(r1.reserved).toBe(1);
    const r2 = await reserveFieldSalesOrder(prisma, { orderNo: "PUTUS-T-1", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 6 }] });
    expect(r2.skipped).toBe(1);
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku } } });
    expect(Number(inv!.reservedQty)).toBe(6);
  });

  it("consume decrements qtyOnHand + reservedQty and stamps FIELD_SALES_CONSUME", async () => {
    const lineId = `line-${sku}-2`;
    await reserveFieldSalesOrder(prisma, { orderNo: "PUTUS-T-2", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 6 }] });
    const res = await consumeFieldSalesOrder(prisma, { orderNo: "PUTUS-T-2", fieldSalesLineIds: [lineId] });
    expect(res.consumed).toBe(1);
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku } } });
    expect(Number(inv!.qtyOnHand)).toBe(94);
    expect(Number(inv!.reservedQty)).toBe(0);
    const adj = await prisma.stockAdjustment.findFirst({ where: { itemId, source: "FIELD_SALES_CONSUME" } });
    expect(adj).not.toBeNull();
    expect(Number(adj!.qtyChange)).toBe(-6);
  });

  it("release frees reservedQty without touching qtyOnHand", async () => {
    const lineId = `line-${sku}-3`;
    await reserveFieldSalesOrder(prisma, { orderNo: "PUTUS-T-3", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 6 }] });
    const res = await releaseFieldSalesOrder(prisma, { fieldSalesLineIds: [lineId] });
    expect(res.released).toBe(1);
    const inv = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku } } });
    expect(Number(inv!.qtyOnHand)).toBe(100);
    expect(Number(inv!.reservedQty)).toBe(0);
  });

  describe("variantless InventoryValue row keyed with variantSku: null (real-world convention)", () => {
    let nullItemId = "";
    let nullUomId = "";
    const nullSku = `TEST-FS-NULL-${Math.random().toString(36).slice(2, 10)}`;

    beforeEach(async () => {
      /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
      nullItemId = "";
      nullUomId = "";

      const uom = await prisma.uOM.create({
        data: { code: `TEST-UOM-${nullSku}`, nameId: "test", nameEn: "test" },
      });
      nullUomId = uom.id;
      const item = await prisma.item.create({
        data: { sku: nullSku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId: nullUomId },
      });
      nullItemId = item.id;
      await prisma.inventoryValue.create({
        data: { itemId: nullItemId, variantSku: null, qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 },
      });
    });

    afterEach(async () => {
      await prisma.stockReservation.deleteMany({ where: { itemId: seededId(nullItemId) } });
      await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(nullItemId) } });
      await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(nullItemId) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(nullItemId) } });
      await prisma.item.deleteMany({ where: { id: seededId(nullItemId) } });
      await prisma.uOM.deleteMany({ where: { id: seededId(nullUomId) } });
    });

    it("reserve, consume, and release all succeed against a variantSku: null row", async () => {
      const lineId = `line-${nullSku}-1`;

      const r1 = await reserveFieldSalesOrder(prisma, {
        orderNo: "PUTUS-T-NULL-1",
        lines: [{ fieldSalesLineId: lineId, itemId: nullItemId, variantSku: "", qty: 6 }],
      });
      expect(r1.reserved).toBe(1);
      let inv = await prisma.inventoryValue.findFirst({
        where: { itemId: nullItemId, OR: [{ variantSku: null }, { variantSku: "" }] },
      });
      expect(Number(inv!.reservedQty)).toBe(6);
      expect(Number(inv!.qtyOnHand)).toBe(100);

      const consumeRes = await consumeFieldSalesOrder(prisma, { orderNo: "PUTUS-T-NULL-1", fieldSalesLineIds: [lineId] });
      expect(consumeRes.consumed).toBe(1);
      inv = await prisma.inventoryValue.findFirst({
        where: { itemId: nullItemId, OR: [{ variantSku: null }, { variantSku: "" }] },
      });
      expect(Number(inv!.qtyOnHand)).toBe(94);
      expect(Number(inv!.reservedQty)).toBe(0);
      const adj = await prisma.stockAdjustment.findFirst({ where: { itemId: nullItemId, source: "FIELD_SALES_CONSUME" } });
      expect(adj).not.toBeNull();
      expect(Number(adj!.qtyChange)).toBe(-6);

      const lineId2 = `line-${nullSku}-2`;
      await reserveFieldSalesOrder(prisma, {
        orderNo: "PUTUS-T-NULL-2",
        lines: [{ fieldSalesLineId: lineId2, itemId: nullItemId, variantSku: "", qty: 4 }],
      });
      const releaseRes = await releaseFieldSalesOrder(prisma, { fieldSalesLineIds: [lineId2] });
      expect(releaseRes.released).toBe(1);
      inv = await prisma.inventoryValue.findFirst({
        where: { itemId: nullItemId, OR: [{ variantSku: null }, { variantSku: "" }] },
      });
      expect(Number(inv!.qtyOnHand)).toBe(94);
      expect(Number(inv!.reservedQty)).toBe(0);
    });
  });

  describe("dual null + empty InventoryValue rows (Jubelio fork)", () => {
    let dualItemId = "";
    let dualUomId = "";
    const dualSku = `TEST-FS-DUAL-${Math.random().toString(36).slice(2, 10)}`;

    beforeEach(async () => {
      dualItemId = "";
      dualUomId = "";
      const uom = await prisma.uOM.create({
        data: { code: `TEST-UOM-${dualSku}`, nameId: "test", nameEn: "test" },
      });
      dualUomId = uom.id;
      const item = await prisma.item.create({
        data: { sku: dualSku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId: dualUomId },
      });
      dualItemId = item.id;
      await prisma.inventoryValue.create({
        data: { itemId: dualItemId, variantSku: null, qtyOnHand: 1000, reservedQty: 12, avgCost: 1000, totalValue: 1000000 },
      });
      await prisma.inventoryValue.create({
        data: { itemId: dualItemId, variantSku: "", qtyOnHand: 999, reservedQty: 0, avgCost: 1000, totalValue: 999000 },
      });
    });

    afterEach(async () => {
      await prisma.stockReservation.deleteMany({ where: { itemId: seededId(dualItemId) } });
      await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(dualItemId) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(dualItemId) } });
      await prisma.item.deleteMany({ where: { id: seededId(dualItemId) } });
      await prisma.uOM.deleteMany({ where: { id: seededId(dualUomId) } });
    });

    it("reserve + release bump the empty-string row, not the null sibling", async () => {
      const lineId = `line-${dualSku}-1`;
      const r1 = await reserveFieldSalesOrder(prisma, {
        orderNo: "PUTUS-T-DUAL-1",
        lines: [{ fieldSalesLineId: lineId, itemId: dualItemId, variantSku: "", qty: 6 }],
      });
      expect(r1.reserved).toBe(1);
      const empty = await prisma.inventoryValue.findFirst({ where: { itemId: dualItemId, variantSku: "" } });
      const nullRow = await prisma.inventoryValue.findFirst({ where: { itemId: dualItemId, variantSku: null } });
      expect(Number(empty!.reservedQty)).toBe(6);
      expect(Number(nullRow!.reservedQty)).toBe(12);

      const releaseRes = await releaseFieldSalesOrder(prisma, { fieldSalesLineIds: [lineId] });
      expect(releaseRes.released).toBe(1);
      const emptyAfter = await prisma.inventoryValue.findFirst({ where: { itemId: dualItemId, variantSku: "" } });
      const nullAfter = await prisma.inventoryValue.findFirst({ where: { itemId: dualItemId, variantSku: null } });
      expect(Number(emptyAfter!.reservedQty)).toBe(0);
      expect(Number(nullAfter!.reservedQty)).toBe(12);
    });
  });
});

d("reserveKonsiFieldSalesOrder (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  const variantSku = "";
  const sku = `TEST-KONSI-${Math.random().toString(36).slice(2, 10)}`;

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
    await prisma.inventoryValue.create({
      data: { itemId, variantSku, qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 },
    });
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("reserves qty item-level with source FIELD_SALES_KONSI and increments reservedQty", async () => {
    const lineId = `konsi-line-${sku}-1`;
    const res = await reserveKonsiFieldSalesOrder(prisma, {
      orderNo: "KONSI/2026/0001",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 3 }],
    });
    expect(res.reserved).toBe(1);
    expect(res.shortLines).toEqual([]);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(3);
    const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: lineId } });
    expect(rsv!.source).toBe("FIELD_SALES_KONSI");
    expect(rsv!.state).toBe("RESERVED");
  });

  it("reports shortLines and does NOT reserve when qty exceeds available", async () => {
    await prisma.inventoryValue.update({
      where: { itemId_variantSku: { itemId, variantSku } },
      data: { qtyOnHand: 2 },
    });
    const lineId = `konsi-line-${sku}-2`;
    const res = await reserveKonsiFieldSalesOrder(prisma, {
      orderNo: "KONSI/2026/0002",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 5 }],
    });
    expect(res.reserved).toBe(0);
    expect(res.shortLines).toHaveLength(1);
    expect(res.shortLines[0].itemId).toBe(itemId);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(0);
    const rsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: lineId } });
    expect(rsv).toBeNull();
  });

  it("is idempotent — re-reserving the same line skips", async () => {
    const lineId = `konsi-line-${sku}-3`;
    const input = { orderNo: "KONSI/2026/0003", lines: [{ fieldSalesLineId: lineId, itemId, variantSku, qty: 3 }] };
    await reserveKonsiFieldSalesOrder(prisma, input);
    const res2 = await reserveKonsiFieldSalesOrder(prisma, input);
    expect(res2.reserved).toBe(0);
    expect(res2.skipped).toBe(1);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(3);
  });

  it("handles a mixed batch — one reservable line and one short line independently", async () => {
    await prisma.inventoryValue.update({
      where: { itemId_variantSku: { itemId, variantSku } },
      data: { qtyOnHand: 10 },
    });
    const okLineId = `konsi-line-${sku}-mixed-ok`;
    const shortLineId = `konsi-line-${sku}-mixed-short`;
    const res = await reserveKonsiFieldSalesOrder(prisma, {
      orderNo: "KONSI/2026/0004",
      lines: [
        { fieldSalesLineId: okLineId, itemId, variantSku, qty: 4 },
        { fieldSalesLineId: shortLineId, itemId, variantSku, qty: 50 },
      ],
    });
    expect(res.reserved).toBe(1);
    expect(res.skipped).toBe(0);
    expect(res.shortLines).toHaveLength(1);
    expect(res.shortLines[0].itemId).toBe(itemId);
    const okRsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: okLineId } });
    expect(okRsv).not.toBeNull();
    expect(okRsv!.state).toBe("RESERVED");
    const shortRsv = await prisma.stockReservation.findUnique({ where: { fieldSalesLineId: shortLineId } });
    expect(shortRsv).toBeNull();
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId } });
    expect(Number(inv!.reservedQty)).toBe(4);
  });
});

d("field-sales reservations pinned to the row they reserved against (test bed only)", () => {
  let itemId = "";
  let uomId = "";
  let nullRowId = "";
  const sku = `TEST-FS-PIN-${Math.random().toString(36).slice(2, 10)}`;

  beforeEach(async () => {
    /* Unset before seeding, so a throw mid-hook leaves teardown scoped to what this run actually created. */
    itemId = "";
    uomId = "";
    nullRowId = "";

    const uom = await prisma.uOM.create({
      data: { code: `TEST-UOM-${sku}`, nameId: "test", nameEn: "test" },
    });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "test", nameEn: "test", type: "FINISHED_GOOD", isActive: true, uomId },
    });
    itemId = item.id;
    const row = await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 },
    });
    nullRowId = row.id;
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    /* Every InventoryValue row of the item, both variantless spellings, including any sibling a test provisioned. */
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  /* The fork a provisioning path can open between reserve and consume; the lookup alone prefers it. */
  const provisionEmptySibling = () =>
    prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 0, reservedQty: 0, avgCost: 1000, totalValue: 0 },
    });

  it("reserveFieldSalesOrder stores the id of the row it reserved against", async () => {
    const lineId = `line-${sku}-a`;
    await reserveFieldSalesOrder(prisma, {
      orderNo: "PUTUS-T-PIN-A",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });
    const rsv = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: lineId } });
    expect(rsv.inventoryValueId).toBe(nullRowId);
  });

  it("consumeFieldSalesOrder acts on the reserved row even after an empty-string sibling is provisioned", async () => {
    const lineId = `line-${sku}-b`;
    await reserveFieldSalesOrder(prisma, {
      orderNo: "PUTUS-T-PIN-B",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });
    const emptyRow = await provisionEmptySibling();

    const res = await consumeFieldSalesOrder(prisma, { orderNo: "PUTUS-T-PIN-B", fieldSalesLineIds: [lineId] });
    expect(res.consumed).toBe(1);

    const nullAfter = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: nullRowId } });
    const emptyAfter = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: emptyRow.id } });
    expect(Number(nullAfter.qtyOnHand)).toBe(6);
    expect(Number(nullAfter.reservedQty)).toBe(0);
    expect(Number(emptyAfter.qtyOnHand)).toBe(0);
    expect(Number(emptyAfter.reservedQty)).toBe(0);
  });

  it("consumeFieldSalesOrderPartial acts on the reserved row even after an empty-string sibling is provisioned", async () => {
    const lineId = `line-${sku}-c`;
    await reserveFieldSalesOrder(prisma, {
      orderNo: "PUTUS-T-PIN-C",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });
    const emptyRow = await provisionEmptySibling();

    const res = await consumeFieldSalesOrderPartial(prisma, {
      orderNo: "PUTUS-T-PIN-C",
      deliveryId: `dlv-${sku}`,
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 3 }],
    });
    expect(res.consumed).toBe(1);

    const nullAfter = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: nullRowId } });
    const emptyAfter = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: emptyRow.id } });
    expect(Number(nullAfter.qtyOnHand)).toBe(7);
    expect(Number(nullAfter.reservedQty)).toBe(1);
    expect(Number(emptyAfter.qtyOnHand)).toBe(0);
    expect(Number(emptyAfter.reservedQty)).toBe(0);
  });

  it("a legacy field-sales reservation with no stored row still consumes through the lookup", async () => {
    const lineId = `line-${sku}-d`;
    await reserveFieldSalesOrder(prisma, {
      orderNo: "PUTUS-T-PIN-D",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });
    await prisma.stockReservation.update({ where: { fieldSalesLineId: lineId }, data: { inventoryValueId: null } });

    const res = await consumeFieldSalesOrder(prisma, { orderNo: "PUTUS-T-PIN-D", fieldSalesLineIds: [lineId] });
    expect(res.consumed).toBe(1);

    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: nullRowId } });
    expect(Number(inv.qtyOnHand)).toBe(6);
    expect(Number(inv.reservedQty)).toBe(0);
  });

  it("reserveKonsiFieldSalesOrder stores the id of the row it reserved against", async () => {
    const lineId = `konsi-line-${sku}-e`;
    const res = await reserveKonsiFieldSalesOrder(prisma, {
      orderNo: "KONSI-T-PIN-E",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });
    expect(res.reserved).toBe(1);
    const rsv = await prisma.stockReservation.findUniqueOrThrow({ where: { fieldSalesLineId: lineId } });
    expect(rsv.inventoryValueId).toBe(nullRowId);
  });

  it("a konsi reservation releases from the reserved row even after an empty-string sibling is provisioned", async () => {
    const lineId = `konsi-line-${sku}-f`;
    await reserveKonsiFieldSalesOrder(prisma, {
      orderNo: "KONSI-T-PIN-F",
      lines: [{ fieldSalesLineId: lineId, itemId, variantSku: "", qty: 4 }],
    });
    const emptyRow = await provisionEmptySibling();

    const res = await releaseFieldSalesOrder(prisma, { fieldSalesLineIds: [lineId] });
    expect(res.released).toBe(1);

    const nullAfter = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: nullRowId } });
    const emptyAfter = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: emptyRow.id } });
    expect(Number(nullAfter.qtyOnHand)).toBe(10);
    expect(Number(nullAfter.reservedQty)).toBe(0);
    expect(Number(emptyAfter.qtyOnHand)).toBe(0);
    expect(Number(emptyAfter.reservedQty)).toBe(0);
  });
});
