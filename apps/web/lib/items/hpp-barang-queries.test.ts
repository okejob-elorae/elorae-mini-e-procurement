import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bacaHppBarang } from "./hpp-barang-queries";

/*
 * HPP per pcs di formulir barang jadi, terhadap basis data uji. Semua tanggal
 * 2003–2004 supaya tidak bercampur dengan data sungguhan; barang, WO, dan
 * penerimaan milik tes sendiri.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("bacaHppBarang (basis data uji)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let itemId = "";
  let lainId = "";
  let woId = "";
  let woLainId = "";
  let urut = 0;

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    itemId = "";
    lainId = "";
    woId = "";
    woLainId = "";
    userId = (await prisma.user.create({ data: { email: `hpp-${token}@uji.local`, name: "Uji HPP" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `THP-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (await prisma.supplier.create({ data: { code: `CMT-HP-${token}`, name: "CMT uji", typeId }, select: { id: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `H${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    const barang = (sku: string) =>
      prisma.item.create({ data: { sku, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId }, select: { id: true } });
    itemId = (await barang(`FG-HP-${token}`)).id;
    lainId = (await barang(`FG-HPL-${token}`)).id;
    const wo = (docNumber: string, finishedGoodId: string) =>
      prisma.workOrder.create({
        data: { docNumber, vendorId, finishedGoodId, plannedQty: 100, consumptionPlan: {}, createdById: userId },
        select: { id: true },
      });
    woId = (await wo(`WO-HP-${token}`, itemId)).id;
    woLainId = (await wo(`WO-HPL-${token}`, lainId)).id;
  });

  afterAll(async () => {
    await prisma.fGReceipt.deleteMany({ where: { woId: { in: seededIds([woId, woLainId]) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds([woId, woLainId]) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([itemId, lainId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([itemId, lainId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function terima(isi: {
    wo?: string;
    qty: number;
    bahan: number | null;
    jasa: number | null;
    tambahan: number | null;
    nilai: number;
    hari: string;
  }) {
    urut += 1;
    await prisma.fGReceipt.create({
      data: {
        docNumber: `RCPT-HP-${token}-${urut}`,
        woId: isi.wo ?? woId,
        receiptType: "GENERIC",
        qtyReceived: Math.max(isi.qty, 1),
        qtyRejected: isi.qty > 0 ? 0 : 1,
        qtyAccepted: isi.qty,
        materialCost: isi.bahan,
        serviceCost: isi.jasa,
        additionalCost: isi.tambahan,
        totalCostValue: isi.nilai,
        receivedById: userId,
        receivedAt: new Date(`${isi.hari}T03:00:00.000Z`),
      },
    });
  }

  it("tanpa stok dan tanpa penerimaan → belum ada HPP", async () => {
    expect(await bacaHppBarang(prisma, itemId)).toEqual({ perPcs: null, sumber: null, rincian: null });
  });

  it("hanya penerimaan lama, stok 0 → HPP dari penerimaan itu, rincian bahan saja", async () => {
    await terima({ qty: 10, bahan: null, jasa: null, tambahan: null, nilai: 100_000, hari: "2003-05-01" });
    expect(await bacaHppBarang(prisma, itemId)).toEqual({
      perPcs: 10_000,
      sumber: "PENERIMAAN",
      rincian: {
        penerimaan: `RCPT-HP-${token}-1`,
        wo: `WO-HP-${token}`,
        tanggal: "2003-05-01T03:00:00.000Z",
        bahanPerPcs: 10_000,
        jahitPerPcs: null,
        tambahanPerPcs: null,
      },
    });
  });

  it("penerimaan terakhir yang memikul bahan menjadi rincian; setoran semua cacat dan lebih produksi tanpa bahan dilewati", async () => {
    await terima({ qty: 40, bahan: 400_000, jasa: 866_000, tambahan: 80_000, nilai: 1_260_180, hari: "2004-02-01" });
    await terima({ qty: 0, bahan: 0, jasa: 0, tambahan: 0, nilai: 0, hari: "2004-03-01" });
    await terima({ qty: 5, bahan: 0, jasa: 75_000, tambahan: 10_000, nilai: 85_000, hari: "2004-04-01" });
    // Barang lain, lebih baru: tidak boleh bocor.
    await terima({ wo: woLainId, qty: 2, bahan: 2_000, jasa: 0, tambahan: 0, nilai: 2_000, hari: "2004-12-01" });

    const hasil = await bacaHppBarang(prisma, itemId);
    expect(hasil.perPcs).toBe(31_504.5);
    expect(hasil.sumber).toBe("PENERIMAAN");
    expect(hasil.rincian).toEqual({
      penerimaan: `RCPT-HP-${token}-2`,
      wo: `WO-HP-${token}`,
      tanggal: "2004-02-01T03:00:00.000Z",
      bahanPerPcs: 10_000,
      jahitPerPcs: 19_504.5,
      tambahanPerPcs: 2_000,
    });
  });

  it("stok ada → Σ nilai ÷ Σ qty semua varian ber-qty > 0", async () => {
    await prisma.inventoryValue.createMany({
      data: [
        { itemId, variantSku: `FG-HP-${token}-S`, qtyOnHand: 10, avgCost: 30_000, totalValue: 300_000 },
        { itemId, variantSku: `FG-HP-${token}-M`, qtyOnHand: 30, avgCost: 32_000, totalValue: 960_000 },
        { itemId, variantSku: `FG-HP-${token}-L`, qtyOnHand: 0, avgCost: 0, totalValue: 0 },
        { itemId, variantSku: `FG-HP-${token}-XL`, qtyOnHand: -2, avgCost: 30_000, totalValue: -60_000 },
        { itemId: lainId, variantSku: null, qtyOnHand: 1, avgCost: 1, totalValue: 1 },
      ],
    });
    const hasil = await bacaHppBarang(prisma, itemId);
    expect(hasil.perPcs).toBe(31_500);
    expect(hasil.sumber).toBe("STOK");
    expect(hasil.rincian?.penerimaan).toBe(`RCPT-HP-${token}-2`);
  });
});
