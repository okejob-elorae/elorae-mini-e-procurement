import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@elorae/db";
import { recordVanSale } from "./sale-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("recordVanSale (test bed only)", () => {
  const tag = `VSALE-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = ""; let itemId = ""; let salesmanId = "";

  beforeEach(async () => {
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({ data: { sku: tag, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 } });
    itemId = item.id;
    const s = await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } });
    salesmanId = s.id;
    await prisma.vanStock.create({ data: { userId: salesmanId, itemId, variantSku: "", qty: 20, avgCost: 2000 } });
  });

  afterEach(async () => {
    await prisma.salesHistory.deleteMany({ where: { itemId } });
    await prisma.vanSaleLine.deleteMany({ where: { itemId } });
    await prisma.vanSale.deleteMany({ where: { salesmanId, storeId: null } });
    await prisma.vanStock.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.uOM.deleteMany({ where: { id: uomId } });
  });

  const line = (qty: number) => ({ itemId, variantSku: null, qty });

  it("records a sale: van decremented, VanSale+lines, SalesHistory, change", async () => {
    const res = await recordVanSale({ salesmanId, lines: [line(4)], amountPaid: 25000, buyerName: "Walk-in" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.changeAmount).toBe(5000); // 4*5000=20000; paid 25000
    const van = await prisma.vanStock.findFirst({ where: { userId: salesmanId, itemId } });
    expect(Number(van!.qty)).toBe(16);
    const sale = await prisma.vanSale.findUnique({ where: { id: res.saleId }, include: { lines: true } });
    expect(sale!.lines).toHaveLength(1);
    expect(Number(sale!.lines[0].unitCost)).toBe(2000); // COGS snapshot = van avgCost
    const sh = await prisma.salesHistory.findFirst({ where: { itemId, orderId: res.docNo } });
    expect(sh).not.toBeNull();
  });

  it("hard-blocks on short van stock, no writes", async () => {
    const res = await recordVanSale({ salesmanId, lines: [line(21)], amountPaid: 999999 });
    expect(res.ok).toBe(false);
    if (res.ok || res.code !== "INSUFFICIENT_VAN_STOCK") throw new Error("expected INSUFFICIENT_VAN_STOCK");
    expect(res.shortLines[0]).toMatchObject({ requested: 21, available: 20 });
    const van = await prisma.vanStock.findFirst({ where: { userId: salesmanId, itemId } });
    expect(Number(van!.qty)).toBe(20); // untouched
  });

  it("rejects insufficient payment", async () => {
    const res = await recordVanSale({ salesmanId, lines: [line(4)], amountPaid: 10000 }); // needs 20000
    expect(res).toEqual({ ok: false, code: "INSUFFICIENT_PAYMENT" });
  });

  it("NO_PRICE when item has no sellingPrice", async () => {
    await prisma.item.update({ where: { id: itemId }, data: { sellingPrice: null } });
    const res = await recordVanSale({ salesmanId, lines: [line(1)], amountPaid: 999999 });
    expect(res).toEqual({ ok: false, code: "NO_PRICE" });
  });

  it("idempotency replay returns the same sale, deducts once", async () => {
    const key = `${tag}-idem`;
    const a = await recordVanSale({ salesmanId, lines: [line(3)], amountPaid: 15000, idempotencyKey: key });
    const b = await recordVanSale({ salesmanId, lines: [line(3)], amountPaid: 15000, idempotencyKey: key });
    expect(a.ok && b.ok && a.saleId === b.saleId).toBe(true);
    const van = await prisma.vanStock.findFirst({ where: { userId: salesmanId, itemId } });
    expect(Number(van!.qty)).toBe(17); // 20 - 3 once
  });

  it("EMPTY when no positive-qty lines", async () => {
    const res = await recordVanSale({ salesmanId, lines: [line(0)], amountPaid: 0 });
    expect(res).toEqual({ ok: false, code: "EMPTY" });
  });

  it("sums duplicate lines and drops zero/negative lines", async () => {
    // two lines same item (2 + 3 = 5) + one zero line dropped; 5 * 5000 = 25000
    const res = await recordVanSale({ salesmanId, lines: [line(2), line(3), line(0)], amountPaid: 25000 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const sale = await prisma.vanSale.findUnique({ where: { id: res.saleId }, include: { lines: true } });
    expect(sale!.lines).toHaveLength(1);               // merged to one line
    expect(Number(sale!.lines[0].qty)).toBe(5);        // 2 + 3
    expect(Number(sale!.total)).toBe(25000);
    const van = await prisma.vanStock.findFirst({ where: { userId: salesmanId, itemId } });
    expect(Number(van!.qty)).toBe(15);                 // 20 - 5
  });

  it("stamps the variant label into productName on van sale + sales history", async () => {
    const vUom = await prisma.uOM.create({ data: { code: `UVS-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    const vItem = await prisma.item.create({
      data: {
        sku: `${tag}-V`, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId: vUom.id, isActive: true, sellingPrice: 5000,
        variants: [{ sku: `${tag}-V-M`, size: "M" }],
      },
    });
    await prisma.vanStock.create({ data: { userId: salesmanId, itemId: vItem.id, variantSku: `${tag}-V-M`, qty: 20, avgCost: 2000 } });

    const res = await recordVanSale({ salesmanId, lines: [{ itemId: vItem.id, variantSku: `${tag}-V-M`, qty: 2 }], amountPaid: 10000, buyerName: "Walk-in" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    const sale = await prisma.vanSale.findUnique({ where: { id: res.saleId }, include: { lines: true } });
    expect(sale!.lines[0].productName).toBe("Kaos — size: M");
    expect(sale!.lines[0].variantSku).toBe(`${tag}-V-M`);
    const sh = await prisma.salesHistory.findFirst({ where: { itemId: vItem.id, orderId: res.docNo } });
    expect(sh!.productName).toBe("Kaos — size: M");

    await prisma.salesHistory.deleteMany({ where: { itemId: vItem.id } });
    await prisma.vanSaleLine.deleteMany({ where: { itemId: vItem.id } });
    await prisma.vanSale.deleteMany({ where: { id: res.saleId } });
    await prisma.vanStock.deleteMany({ where: { itemId: vItem.id } });
    await prisma.item.deleteMany({ where: { id: vItem.id } });
    await prisma.uOM.deleteMany({ where: { id: vUom.id } });
  });
});
