import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Hutang jasa produksi per pemasok, per langkah WO — bahan untuk pembayaran
 * pemasok. Basis data uji nyata, data sendiri, dibatasi `woIds`. Pengaturan PPN
 * ditiru (tes tidak menulis SystemSetting bersama).
 */

vi.mock("@/lib/finance/pajak/ppn-pengaturan", () => ({
  bacaPengaturanPpn: async () => ({
    statusPkp: "BELUM_DITETAPKAN",
    tarifPersen: 12,
    pakaiDppNilaiLain: true,
    hargaJualTermasukPpn: true,
    berlakuSejak: null,
  }),
}));

const { daftarHutangJasa, TARGET_ALOKASI_LANGKAH_WO } = await import("./hutang-jasa-queries");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("hutang jasa produksi (basis data uji)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let jahitId = "";
  let sablonId = "";
  let uomId = "";
  let itemId = "";
  let woId = "";
  let stepJahit = "";
  let stepSablon = "";
  let receiptBaru = "";
  const paymentIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    jahitId = "";
    sablonId = "";
    uomId = "";
    itemId = "";
    woId = "";
    stepJahit = "";
    stepSablon = "";
    receiptBaru = "";
    userId = (await prisma.user.create({ data: { email: `hj-${token}@uji.local`, name: "Uji hutang jasa" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `THJ-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    jahitId = (
      await prisma.supplier.create({
        data: { code: `HJ-A-${token}`, name: `Penjahit uji ${token}`, typeId, taxWithholding: "PPH21", hasNpwp: false },
        select: { id: true },
      })
    ).id;
    sablonId = (
      await prisma.supplier.create({
        data: { code: `HJ-B-${token}`, name: `Sablon uji ${token}`, typeId, taxWithholding: "PPH23" },
        select: { id: true },
      })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `H${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `FG-HJ-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    woId = (
      await prisma.workOrder.create({
        data: {
          docNumber: `WO-HJ-${token}`,
          vendorId: jahitId,
          finishedGoodId: itemId,
          plannedQty: 100,
          consumptionPlan: {},
          createdById: userId,
          status: "PARTIAL",
        },
        select: { id: true },
      })
    ).id;
    stepJahit = (
      await prisma.workOrderStep.create({
        data: { woId, sequence: 1, supplierId: jahitId, stepName: "Jahit", servicePrice: 15_000, servicePpnIncluded: false },
        select: { id: true },
      })
    ).id;
    stepSablon = (
      await prisma.workOrderStep.create({
        data: { woId, sequence: 2, supplierId: sablonId, stepName: "Sablon", servicePrice: 5_000, servicePpnIncluded: true },
        select: { id: true },
      })
    ).id;
    const terima = (n: number, qty: number, serviceCost: number | null) =>
      prisma.fGReceipt.create({
        data: {
          docNumber: `RCPT-HJ-${token}-${n}`,
          woId,
          receiptType: "GENERIC",
          qtyReceived: qty,
          qtyAccepted: qty,
          totalCostValue: 0,
          materialCost: 0,
          serviceCost,
          additionalCost: serviceCost == null ? null : 0,
          receivedById: userId,
          receivedAt: new Date(`2004-05-0${n}T03:00:00.000Z`),
        },
        select: { id: true },
      });
    // Penerimaan LAMA (sebelum ongkos jahit masuk HPP): 10 pcs tanpa hutang jasa.
    await terima(1, 10, null);
    // Penerimaan baru 40 pcs: jahit 40 × 15.000 + PPN 66.000 + sablon 40 × 5.000 (termasuk PPN).
    receiptBaru = (await terima(2, 40, 866_000)).id;
  });

  afterAll(async () => {
    await prisma.supplierPaymentAllocation.deleteMany({ where: { paymentId: { in: seededIds(paymentIds) } } });
    await prisma.supplierPayment.deleteMany({ where: { id: { in: seededIds(paymentIds) } } });
    await prisma.fGReceipt.deleteMany({ where: { woId: seededId(woId) } });
    await prisma.workOrderStep.deleteMany({ where: { woId: seededId(woId) } });
    await prisma.workOrder.deleteMany({ where: { id: seededId(woId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: { in: seededIds([jahitId, sablonId]) } } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function bayar(supplierId: string, stepId: string, amount: number, status = "POSTED") {
    const p = await prisma.supplierPayment.create({
      data: {
        docNumber: `BYR-HJ-${token}-${paymentIds.length + 1}`,
        supplierId,
        date: new Date("2004-05-20T03:00:00.000Z"),
        grossAmount: amount,
        netAmount: amount,
        status,
        createdById: userId,
        allocations: { create: [{ targetType: TARGET_ALOKASI_LANGKAH_WO, targetId: stepId, amount }] },
      },
      select: { id: true },
    });
    paymentIds.push(p.id);
  }

  it("hutang hanya atas pcs yang jasanya dijurnal; dasar potong tanpa PPN; dibayar dari pembayaran yang tidak batal", async () => {
    await bayar(jahitId, stepJahit, 500_000);
    await bayar(jahitId, stepJahit, 100_000, "CANCELLED");

    const hasil = await daftarHutangJasa({ woIds: [woId] });
    expect(hasil.map((p) => p.supplierId)).toEqual([jahitId, sablonId]);
    const [jahit, sablon] = hasil;
    expect(jahit).toMatchObject({ jenisPotong: "PPH21", adaNpwp: false, hutang: 666_000, dasarPotong: 600_000, dibayar: 500_000, sisa: 166_000 });
    expect(jahit.langkah).toEqual([
      expect.objectContaining({
        stepId: stepJahit,
        woDocNumber: `WO-HJ-${token}`,
        namaLangkah: "Jahit",
        hargaPerPcs: 15_000,
        hargaTermasukPpn: false,
        qtyTerhutang: 40,
        hutang: 666_000,
        dasarPotong: 600_000,
        ppn: 66_000,
        dibayar: 500_000,
        sisa: 166_000,
      }),
    ]);
    expect(sablon).toMatchObject({ jenisPotong: "PPH23", hutang: 200_000, dasarPotong: 180_180, dibayar: 0, sisa: 200_000 });
    // Σ hutang semua langkah = Σ serviceCost penerimaan (saldo hutang usaha yang dijurnal).
    expect(jahit.hutang + sablon.hutang).toBe(866_000);
  });

  it("saring per pemasok dan buang yang lunas", async () => {
    expect((await daftarHutangJasa({ woIds: [woId], supplierId: sablonId })).map((p) => p.supplierId)).toEqual([sablonId]);
    await bayar(sablonId, stepSablon, 200_000);
    const bersisa = await daftarHutangJasa({ woIds: [woId], hanyaBersisa: true });
    expect(bersisa.map((p) => p.supplierId)).toEqual([jahitId]);
  });

  it("bila hitungan ulang berbeda dari yang tercatat, Σ hutang tetap = yang tercatat", async () => {
    await prisma.fGReceipt.update({ where: { id: seededId(receiptBaru) }, data: { serviceCost: 866_000.03 } });
    try {
      const hasil = await daftarHutangJasa({ woIds: [woId] });
      const total = hasil.flatMap((p) => p.langkah).reduce((s, l) => s + Math.round(l.hutang * 100), 0);
      expect(total).toBe(86_600_003);
    } finally {
      await prisma.fGReceipt.update({ where: { id: seededId(receiptBaru) }, data: { serviceCost: 866_000 } });
    }
  });

  it("pemasok bukan PKP tidak memungut PPN jasa: hutang = dasar potong, PPN nol", async () => {
    // Penerimaan yang dijurnal sesudah status diisi: jahit 40 × 15.000 tanpa PPN + sablon 200.000.
    await prisma.supplier.update({ where: { id: seededId(jahitId) }, data: { isPkp: false } });
    await prisma.fGReceipt.update({ where: { id: seededId(receiptBaru) }, data: { serviceCost: 800_000 } });
    try {
      const [jahit] = await daftarHutangJasa({ woIds: [woId], supplierId: jahitId });
      expect(jahit.langkah[0]).toMatchObject({ hutang: 600_000, dasarPotong: 600_000, ppn: 0 });
    } finally {
      await prisma.fGReceipt.update({ where: { id: seededId(receiptBaru) }, data: { serviceCost: 866_000 } });
      await prisma.supplier.update({ where: { id: seededId(jahitId) }, data: { isPkp: null } });
    }
  });
});
