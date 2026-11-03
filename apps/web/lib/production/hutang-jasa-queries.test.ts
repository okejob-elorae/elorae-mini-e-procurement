import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Hutang jasa produksi per pemasok, per langkah WO — bahan untuk pembayaran
 * pemasok. Basis data uji nyata, data sendiri, dibatasi `woIds`. Pengaturan PPN
 * ditiru (tes tidak menulis SystemSetting bersama). Jurnal tagihan vendor ditulis
 * langsung dengan akun uji, tanpa mengubah pemetaan akun bersama. Peran AP ditiru
 * (kosong = belum dipetakan) supaya koreksi selisih harga dibaca dari akun uji saja.
 */

const peta = vi.hoisted(() => ({ ap: "" }));
vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      if (role === "AP" && peta.ap) return peta.ap;
      throw new m.UnmappedRoleError(role);
    }),
  };
});

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
  let billId = "";
  const extraBillIds: string[] = [];
  const vendorPaymentIds: string[] = [];
  const accountIds: string[] = [];
  const koreksiIds: string[] = [];

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
    billId = "";
    extraBillIds.length = 0;
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
    if (vendorPaymentIds.length > 0) {
      await prisma.vendorPaymentAllocation.deleteMany({ where: { paymentId: { in: seededIds(vendorPaymentIds) } } });
      await prisma.vendorPayment.deleteMany({ where: { id: { in: seededIds(vendorPaymentIds) } } });
    }
    if (billId) {
      await prisma.journal.deleteMany({ where: { sourceType: { in: ["VENDOR_BILL", "VENDOR_BILL_REVERSAL"] }, sourceId: seededId(billId) } });
      await prisma.vendorBillLine.deleteMany({ where: { billId: seededId(billId) } });
      await prisma.vendorBill.deleteMany({ where: { id: seededId(billId) } });
    }
    if (extraBillIds.length > 0) {
      await prisma.journal.deleteMany({ where: { sourceType: { in: ["VENDOR_BILL", "VENDOR_BILL_REVERSAL"] }, sourceId: { in: seededIds(extraBillIds) } } });
      await prisma.vendorBillLine.deleteMany({ where: { billId: { in: seededIds(extraBillIds) } } });
      await prisma.vendorBill.deleteMany({ where: { id: { in: seededIds(extraBillIds) } } });
    }
    if (koreksiIds.length > 0) {
      await prisma.journal.deleteMany({
        where: { sourceType: { in: ["SUPPLIER_PAYABLE_CORRECTION", "SUPPLIER_PAYABLE_CORRECTION_REVERSAL"] }, sourceId: { in: seededIds(koreksiIds) } },
      });
      await prisma.supplierPayableCorrection.deleteMany({ where: { id: { in: seededIds(koreksiIds) } } });
    }
    if (accountIds.length > 0) await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(accountIds) } } });
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

  it("jasa pcs lama yang dijurnal tagihan vendor ikut hutang, pembayaran vendor yang berlaku ikut dibayar", async () => {
    const akun = async (n: number, type: "HPP" | "LIABILITAS") => {
      const id = (await prisma.chartAccount.create({ data: { code: `9HJ${token}${n}`, name: `Akun uji ${token}`, type, depth: 1 }, select: { id: true } })).id;
      accountIds.push(id);
      return id;
    };
    const jasaId = await akun(1, "HPP");
    const apId = await akun(2, "LIABILITAS");
    // Tagihan 50 pcs jahit: 40 sudah dijurnal di penerimaan; 10 pcs penerimaan lama dijurnal tagihannya sendiri.
    billId = (
      await prisma.vendorBill.create({
        data: {
          docNumber: `VB-HJ-${token}`,
          supplierId: jahitId,
          vendorInvoiceNo: `INV-HJ-${token}`,
          billDate: new Date("2004-05-10T03:00:00.000Z"),
          total: 750_000,
          createdById: userId,
          lines: { create: [{ type: "WO_STEP", woStepId: stepJahit, qty: 50, price: 15_000, amount: 750_000, refPrice: 15_000 }] },
        },
        select: { id: true },
      })
    ).id;
    const jurnal = (sourceType: string, debit: string, credit: string) =>
      prisma.journal.create({
        data: {
          date: new Date("2004-05-10T03:00:00.000Z"),
          description: `Tagihan uji ${token}`,
          sourceType,
          sourceId: billId,
          postedById: userId,
          lines: {
            create: [
              { chartAccountId: debit, debit: 150_000, credit: 0 },
              { chartAccountId: credit, debit: 0, credit: 150_000 },
            ],
          },
        },
      });
    await jurnal("VENDOR_BILL", jasaId, apId);
    const bayarVendor = async (amount: number, voidedAt: Date | null) => {
      const p = await prisma.vendorPayment.create({
        data: {
          docNumber: `VPAY-HJ-${token}-${vendorPaymentIds.length + 1}`,
          supplierId: jahitId,
          paidAt: new Date("2004-05-21T03:00:00.000Z"),
          method: "BANK",
          amount,
          createdById: userId,
          voidedAt,
          allocations: { create: { billId, amount } },
        },
        select: { id: true },
      });
      vendorPaymentIds.push(p.id);
    };
    await bayarVendor(300_000, null);
    await bayarVendor(50_000, new Date("2004-05-22T03:00:00.000Z"));

    const [jahit] = await daftarHutangJasa({ woIds: [woId], supplierId: jahitId });
    // 666.000 dari penerimaan + 150.000 dari tagihan (harga belum termasuk PPN: seluruhnya dasar potong).
    expect(jahit.langkah[0]).toMatchObject({ qtyTerhutang: 50, hutang: 816_000, dasarPotong: 750_000, ppn: 66_000, dibayar: 800_000, sisa: 16_000 });

    // WO yang semua penerimaannya lama tetap muncul lewat tagihannya.
    await prisma.fGReceipt.update({ where: { id: seededId(receiptBaru) }, data: { serviceCost: null } });
    try {
      const [lama] = await daftarHutangJasa({ woIds: [woId], supplierId: jahitId });
      expect(lama.langkah[0]).toMatchObject({ hutang: 150_000, dibayar: 800_000 });
    } finally {
      await prisma.fGReceipt.update({ where: { id: seededId(receiptBaru) }, data: { serviceCost: 866_000 } });
    }

    // Tagihan dibatalkan (pembayarannya dulu): jurnalnya dibalik, keduanya keluar lagi.
    await prisma.vendorPaymentAllocation.deleteMany({ where: { paymentId: { in: seededIds(vendorPaymentIds) } } });
    await prisma.vendorPayment.deleteMany({ where: { id: { in: seededIds(vendorPaymentIds) } } });
    vendorPaymentIds.length = 0;
    await prisma.vendorBill.update({ where: { id: seededId(billId) }, data: { status: "VOID", voidedAt: new Date("2004-05-23T03:00:00.000Z") } });
    await jurnal("VENDOR_BILL_REVERSAL", apId, jasaId);
    const [batal] = await daftarHutangJasa({ woIds: [woId], supplierId: jahitId });
    expect(batal.langkah[0]).toMatchObject({ qtyTerhutang: 40, hutang: 666_000, dasarPotong: 600_000, dibayar: 500_000, sisa: 166_000 });
  });

  it("dua tagihan berlaku atas langkah yang sama: hutang jahit lama dihitung sekali, di satu baris", async () => {
    const akun = async (n: number, type: "HPP" | "LIABILITAS") => {
      const id = (await prisma.chartAccount.create({ data: { code: `9HJ${token}${n}`, name: `Akun uji ${token}`, type, depth: 1 }, select: { id: true } })).id;
      accountIds.push(id);
      return id;
    };
    const jasaId = await akun(3, "HPP");
    const apId = await akun(4, "LIABILITAS");
    const tagihan = async (no: string, qty: number) => {
      const id = (
        await prisma.vendorBill.create({
          data: {
            docNumber: `VB2-HJ-${token}-${no}`,
            supplierId: jahitId,
            vendorInvoiceNo: `INV2-HJ-${token}-${no}`,
            billDate: new Date("2004-05-24T03:00:00.000Z"),
            total: qty * 15_000,
            createdById: userId,
            lines: { create: [{ type: "WO_STEP", woStepId: stepJahit, qty, price: 15_000, amount: qty * 15_000, refPrice: 15_000 }] },
          },
          select: { id: true },
        })
      ).id;
      extraBillIds.push(id);
      return id;
    };
    // Tagihan pertama memegang 10 pcs lama dan menjurnal jasanya sendiri; yang kedua menagih 40 pcs yang sudah dijurnal penerimaan.
    const lama = await tagihan("A", 10);
    await prisma.journal.create({
      data: {
        date: new Date("2004-05-24T03:00:00.000Z"),
        description: `Tagihan uji ${token} A`,
        sourceType: "VENDOR_BILL",
        sourceId: lama,
        postedById: userId,
        lines: {
          create: [
            { chartAccountId: jasaId, debit: 150_000, credit: 0 },
            { chartAccountId: apId, debit: 0, credit: 150_000 },
          ],
        },
      },
    });
    await tagihan("B", 40);

    const [jahit] = await daftarHutangJasa({ woIds: [woId], supplierId: jahitId });
    expect(jahit.langkah).toHaveLength(1);
    // 666.000 dari penerimaan + 150.000 dari tagihan pertama — tagihan kedua tidak menambah hutang.
    expect(jahit.langkah[0]).toMatchObject({ stepId: stepJahit, qtyTerhutang: 50, hutang: 816_000, dibayar: 500_000, sisa: 316_000 });
  });

  it("selisih harga invoice yang diterima menambah hutang dan DPP langkahnya; pembaliknya mengembalikan (buku pembantu = buku besar)", async () => {
    const akun = async (n: number, type: "HPP" | "LIABILITAS") => {
      const id = (await prisma.chartAccount.create({ data: { code: `9HJ${token}${n}`, name: `Akun uji ${token}`, type, depth: 1 }, select: { id: true } })).id;
      accountIds.push(id);
      return id;
    };
    const jasaId = await akun(5, "HPP");
    const apId = await akun(6, "LIABILITAS");
    peta.ap = apId;
    try {
      const [awal] = await daftarHutangJasa({ woIds: [woId], supplierId: jahitId });
      const sebelum = awal.langkah[0];
      expect(sebelum.hutangTanpaKoreksi).toBe(sebelum.hutang);
      // 40 pcs ditagih 16.000 terhadap harga WO 15.000: DPP +40.000, PPN pemasok +4.400 (tarif efektif 11%).
      const k = (
        await prisma.supplierPayableCorrection.create({
          data: {
            billId: `vb-hj-${token}`,
            billLineId: `vbl-hj-${token}`,
            supplierId: jahitId,
            sourceType: "WO_STEP",
            sourceId: stepJahit,
            itemId,
            variantSku: null,
            qty: 40,
            recordedPrice: 15_000,
            invoicePrice: 16_000,
            amount: 44_400,
            dppAmount: 40_000,
            ppnInputAmount: 0,
            inventoryAmount: 44_400,
            breakdown: [],
            status: "DITERIMA",
            decidedAt: new Date("2004-05-25T03:00:00.000Z"),
            decidedById: userId,
            createdById: userId,
          },
          select: { id: true },
        })
      ).id;
      koreksiIds.push(k);
      const jurnal = (sourceType: string, debit: string, credit: string) =>
        prisma.journal.create({
          data: {
            date: new Date("2004-05-25T03:00:00.000Z"),
            description: `Koreksi uji ${token}`,
            sourceType,
            sourceId: k,
            postedById: userId,
            lines: { create: [{ chartAccountId: debit, debit: 44_400, credit: 0 }, { chartAccountId: credit, debit: 0, credit: 44_400 }] },
          },
        });
      await jurnal("SUPPLIER_PAYABLE_CORRECTION", jasaId, apId);
      const [diterima] = await daftarHutangJasa({ woIds: [woId], supplierId: jahitId });
      expect(diterima.langkah[0]).toMatchObject({
        hutangTanpaKoreksi: sebelum.hutangTanpaKoreksi,
        hutang: sebelum.hutang + 44_400,
        dasarPotong: sebelum.dasarPotong + 40_000,
        ppn: sebelum.ppn + 4_400,
        dibayar: sebelum.dibayar,
        sisa: sebelum.sisa + 44_400,
      });
      expect(diterima.hutang).toBe(awal.hutang + 44_400);

      // Tagihannya dibatalkan: koreksi DIBATALKAN dengan jurnal pembaliknya — hutang, DPP, PPN kembali.
      await prisma.supplierPayableCorrection.update({ where: { id: seededId(k) }, data: { status: "DIBATALKAN", cancelledAt: new Date(), cancelReason: "uji" } });
      await jurnal("SUPPLIER_PAYABLE_CORRECTION_REVERSAL", apId, jasaId);
      const [dibalik] = await daftarHutangJasa({ woIds: [woId], supplierId: jahitId });
      expect(dibalik.langkah[0]).toMatchObject({ hutang: sebelum.hutang, hutangTanpaKoreksi: sebelum.hutangTanpaKoreksi, dasarPotong: sebelum.dasarPotong, ppn: sebelum.ppn, sisa: sebelum.sisa });
    } finally {
      peta.ap = "";
    }
  });
});
