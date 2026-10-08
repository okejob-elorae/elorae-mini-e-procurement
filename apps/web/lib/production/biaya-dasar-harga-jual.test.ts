import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { dasarHargaJualProduksi } from "./biaya-dasar-harga-jual";

/*
 * Dasar harga jual otomatis untuk pemicu tanpa biaya sendiri (ubah margin,
 * ubah bawaan Jubelio): sesudah ongkos jahit masuk HPP, `InventoryValue.avgCost`
 * memuat jasa — dasarnya harus tetap biaya BAHAN per pcs.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("dasarHargaJualProduksi (basis data uji)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let itemId = "";
  let woId = "";
  let urut = 0;

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    itemId = "";
    woId = "";
    userId = (await prisma.user.create({ data: { email: `dhj-${token}@uji.local`, name: "Uji dasar harga" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TDH-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (await prisma.supplier.create({ data: { code: `CMT-DH-${token}`, name: "CMT uji", typeId }, select: { id: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `D${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `FG-DH-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    woId = (
      await prisma.workOrder.create({
        data: { docNumber: `WO-DH-${token}`, vendorId, finishedGoodId: itemId, plannedQty: 100, consumptionPlan: {}, createdById: userId },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.fGReceipt.deleteMany({ where: { woId: seededId(woId) } });
    await prisma.workOrder.deleteMany({ where: { id: seededId(woId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function terima(isi: { qty: number; bahan: number; jasa: number | null; hari: string }) {
    urut += 1;
    await prisma.fGReceipt.create({
      data: {
        docNumber: `RCPT-DH-${token}-${urut}`,
        woId,
        receiptType: "GENERIC",
        qtyReceived: isi.qty,
        qtyAccepted: isi.qty,
        materialCost: isi.bahan,
        serviceCost: isi.jasa,
        additionalCost: isi.jasa == null ? null : 0,
        totalCostValue: isi.bahan + (isi.jasa ?? 0),
        receivedById: userId,
        receivedAt: new Date(`${isi.hari}T03:00:00.000Z`),
      },
    });
  }

  it("tanpa penerimaan, atau hanya penerimaan lama → undefined (penulis harga memakai avgCost seperti dulu)", async () => {
    expect(await dasarHargaJualProduksi(prisma, itemId)).toBeUndefined();
    await terima({ qty: 10, bahan: 100_000, jasa: null, hari: "2004-06-01" });
    expect(await dasarHargaJualProduksi(prisma, itemId)).toBeUndefined();
  });

  it("ada penerimaan bergaya baru → biaya bahan per pcs penerimaan terakhir yang memikul bahan", async () => {
    await terima({ qty: 40, bahan: 480_000, jasa: 600_000, hari: "2004-06-02" });
    expect(await dasarHargaJualProduksi(prisma, itemId)).toBe(12_000);
    // Lebih produksi tanpa bahan: tidak menjadi dasar.
    await terima({ qty: 5, bahan: 0, jasa: 75_000, hari: "2004-06-03" });
    expect(await dasarHargaJualProduksi(prisma, itemId)).toBe(12_000);
  });
});
