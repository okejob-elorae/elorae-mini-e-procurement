import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * PO baru menghitung PPN dari tarif Pengaturan → Pajak dan menyimpannya:
 * `taxAmount`, `grandTotal` = subtotal + PPN, dan `ppnRatePercent` (tarif yang
 * dipakai, supaya PO tidak berubah nilai saat tarif diganti kemudian).
 */

const tarif = vi.hoisted(() => ({ persen: 11 }));
vi.mock("@/app/actions/settings/ppn", () => ({ getPpnRatePercent: async () => tarif.persen }));

const { createPurchaseOrder } = await import("./mutations");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("createPurchaseOrder menghitung PPN (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let kaosId = "";
  let celanaId = "";
  let poIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    supplierId = "";
    uomId = "";
    kaosId = "";
    celanaId = "";
    userId = (await prisma.user.create({ data: { email: `po-ppn-${token}@uji.local` }, select: { id: true } })).id;
    typeId = (
      await prisma.supplierType.create({ data: { code: `TPP-${token}`, name: `Jenis PPN ${token}` }, select: { id: true } })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-PPN-${token}`, name: "Pemasok PPN uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({ data: { code: `P${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })
    ).id;
    kaosId = (
      await prisma.item.create({
        data: { sku: `PPN-KAOS-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    celanaId = (
      await prisma.item.create({
        data: { sku: `PPN-CLN-${token}`, nameId: "Celana uji", nameEn: "Test pants", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(() => {
    poIds = [];
    tarif.persen = 11;
  });

  afterEach(async () => {
    await prisma.pOStatusHistory.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
    await prisma.pOItem.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaosId, celanaId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function buat() {
    const po = await createPurchaseOrder(
      {
        supplierId,
        items: [
          { itemId: kaosId, variantSku: undefined, qty: 12, price: 85_000, ppnIncluded: false, uomId },
          { itemId: celanaId, variantSku: undefined, qty: 10, price: 50_000, ppnIncluded: true, uomId },
        ],
      },
      userId,
      { applyLeadTime: false },
    );
    poIds.push(po.id);
    return prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: seededId(po.id) },
      select: { totalAmount: true, taxAmount: true, grandTotal: true, ppnRatePercent: true },
    });
  }

  it("12 kaos @85.000 tanpa PPN + 10 celana @50.000 termasuk PPN, tarif 11%", async () => {
    const po = await buat();
    expect(Number(po.totalAmount)).toBe(1_520_000);
    expect(Number(po.taxAmount)).toBe(112_200);
    expect(Number(po.grandTotal)).toBe(1_632_200);
    expect(Number(po.ppnRatePercent)).toBe(11);
  });

  it("tarif mengikuti Pengaturan saat PO dibuat (12%)", async () => {
    tarif.persen = 12;
    const po = await buat();
    expect(Number(po.taxAmount)).toBe(122_400);
    expect(Number(po.grandTotal)).toBe(1_642_400);
    expect(Number(po.ppnRatePercent)).toBe(12);
  });

  it("tarif berdesimal tiga dibulatkan ke presisi kolom: PPN dihitung dari tarif yang TERSIMPAN", async () => {
    // 12 × 85.000 = 1.020.000; 11,125% → disimpan 11,13% → PPN 113.526 (bukan 113.475).
    tarif.persen = 11.125;
    const po = await buat();
    expect(Number(po.ppnRatePercent)).toBe(11.13);
    expect(Number(po.taxAmount)).toBe(113_526);
    expect(Number(po.grandTotal)).toBe(1_633_526);
  });
});
