import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { recordSpgSale } from "./sale-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("recordSpgSale (test bed only)", () => {
  const tag = `SPGSALE-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = ""; let itemId = ""; let salesmanId = ""; let storeId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 } });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 2000, totalValue: 200000 } });
    const s = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    salesmanId = s.id;
    const store = await prisma.store.create({ data: { code: tag, name: "Toko SPG Test", address: "Jl. Test", termsType: "KONSI", marginPercent: 20, isActive: true } });
    storeId = store.id;
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId } });
    await prisma.spgSaleLine.deleteMany({ where: { itemId } });
    await prisma.spgSale.deleteMany({ where: { salesmanId, storeId } });
    await prisma.inventoryValue.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
  });

  const line = (qty: number) => ({ itemId, variantSku: null, qty });

  it("records a sale: server-priced at PUTUS (ignores the store's KONSI margin), SpgSale+lines, SalesHistory, change", async () => {
    const res = await recordSpgSale({ salesmanId, storeId, lines: [line(4)], cashReceived: 25000 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    // 4 * 5000 (PUTUS sellingPrice) = 20000, ignoring the store's 20% KONSI margin
    expect(res.changeGiven).toBe(5000);
    const sale = await prisma.spgSale.findUnique({ where: { id: res.spgSaleId }, include: { lines: true } });
    expect(sale!.lines).toHaveLength(1);
    expect(Number(sale!.lines[0].unitPrice)).toBe(5000);
    expect(Number(sale!.total)).toBe(20000);
    const sh = await prisma.salesHistory.findFirst({ where: { itemId, orderId: res.docNo } });
    expect(sh).not.toBeNull();
  });

  it("does not touch VanStock, InventoryValue, or write a StockAdjustment (record-only)", async () => {
    const invBefore = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku: "" } } });
    const adjBefore = await prisma.stockAdjustment.count({ where: { itemId } });
    const vanBefore = await prisma.vanStock.count({ where: { userId: salesmanId, itemId } });

    const res = await recordSpgSale({ salesmanId, storeId, lines: [line(3)], cashReceived: 15000 });
    expect(res.ok).toBe(true);

    const invAfter = await prisma.inventoryValue.findUnique({ where: { itemId_variantSku: { itemId, variantSku: "" } } });
    expect(Number(invAfter!.qtyOnHand)).toBe(Number(invBefore!.qtyOnHand));
    expect(Number(invAfter!.reservedQty)).toBe(Number(invBefore!.reservedQty));
    const adjAfter = await prisma.stockAdjustment.count({ where: { itemId } });
    expect(adjAfter).toBe(adjBefore);
    const vanAfter = await prisma.vanStock.count({ where: { userId: salesmanId, itemId } });
    expect(vanAfter).toBe(vanBefore);
  });

  it("defaults cashReceived to the total (exact payment) when omitted", async () => {
    const res = await recordSpgSale({ salesmanId, storeId, lines: [line(2)] });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.changeGiven).toBe(0);
  });

  it("rejects insufficient payment", async () => {
    const res = await recordSpgSale({ salesmanId, storeId, lines: [line(4)], cashReceived: 10000 }); // needs 20000
    expect(res).toEqual({ ok: false, code: "INSUFFICIENT_PAYMENT" });
  });

  it("NO_PRICE when item has no sellingPrice", async () => {
    await prisma.item.update({ where: { id: itemId }, data: { sellingPrice: null } });
    const res = await recordSpgSale({ salesmanId, storeId, lines: [line(1)] });
    expect(res).toEqual({ ok: false, code: "NO_PRICE" });
  });

  it("STORE_NOT_FOUND for an unknown store", async () => {
    const res = await recordSpgSale({ salesmanId, storeId: "does-not-exist", lines: [line(1)] });
    expect(res).toEqual({ ok: false, code: "STORE_NOT_FOUND" });
  });

  it("idempotency replay returns the same sale, writes SalesHistory once", async () => {
    const key = `${tag}-idem`;
    const a = await recordSpgSale({ salesmanId, storeId, lines: [line(3)], cashReceived: 15000, idempotencyKey: key });
    const b = await recordSpgSale({ salesmanId, storeId, lines: [line(3)], cashReceived: 15000, idempotencyKey: key });
    expect(a.ok && b.ok && a.spgSaleId === b.spgSaleId).toBe(true);
    const count = await prisma.salesHistory.count({ where: { itemId, orderId: a.ok ? a.docNo : "" } });
    expect(count).toBe(1);
  });

  it("EMPTY when no positive-qty lines", async () => {
    const res = await recordSpgSale({ salesmanId, storeId, lines: [line(0)] });
    expect(res).toEqual({ ok: false, code: "EMPTY" });
  });

  it("sums duplicate lines and drops zero/negative lines", async () => {
    const res = await recordSpgSale({ salesmanId, storeId, lines: [line(2), line(3), line(0)], cashReceived: 25000 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const sale = await prisma.spgSale.findUnique({ where: { id: res.spgSaleId }, include: { lines: true } });
    expect(sale!.lines).toHaveLength(1);
    expect(sale!.lines[0].qty).toBe(5);
    expect(Number(sale!.total)).toBe(25000);
  });

  it("stamps the variant label into productName on SpgSale + sales history", async () => {
    const vUom = await prisma.uOM.create({ data: { code: `UVS-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    const vItem = await prisma.item.create({
      data: {
        sku: `${tag}-V`, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId: vUom.id, isActive: true, sellingPrice: 5000,
        variants: [{ sku: `${tag}-V-M`, size: "M" }],
      },
    });

    const res = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId: vItem.id, variantSku: `${tag}-V-M`, qty: 2 }], cashReceived: 10000 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const sale = await prisma.spgSale.findUnique({ where: { id: res.spgSaleId }, include: { lines: true } });
    expect(sale!.lines[0].productName).toBe("Kaos — size: M");
    expect(sale!.lines[0].variantSku).toBe(`${tag}-V-M`);
    const sh = await prisma.salesHistory.findFirst({ where: { itemId: vItem.id, orderId: res.docNo } });
    expect(sh!.productName).toBe("Kaos — size: M");

    await prisma.salesHistory.deleteMany({ where: { itemId: vItem.id } });
    await prisma.spgSaleLine.deleteMany({ where: { itemId: vItem.id } });
    await prisma.spgSale.deleteMany({ where: { id: res.spgSaleId } });
    await prisma.item.deleteMany({ where: { id: vItem.id } });
    await prisma.uOM.deleteMany({ where: { id: vUom.id } });
  });
});
