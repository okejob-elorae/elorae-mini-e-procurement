import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { computeStoreCreditExposure } from "@/lib/finance/ar/credit-exposure";
import { daftarPiutang } from "@/lib/receivables/queries";
import { hitungUlangPiutang } from "@/lib/receivables/writer";
import { ATURAN_KREDIT_BAWAAN, MODE_KREDIT, nilaiKredit } from "./kredit";
import { keadaanTagihanToko, ringkasLewatJanji } from "./tagihan-toko";

const baris = (outstanding: number, keadaan: "lunas" | "klaim" | "tertahan" | "lewat" | "tt" | "belum", hariTerlambat?: number) => ({
  outstanding,
  keadaan,
  alasan: hariTerlambat === undefined ? {} : { hariTerlambat },
});

describe("ringkasLewatJanji", () => {
  it("faktur tanpa janji yang lewat tidak dihitung, dan yang lunas diabaikan", () => {
    expect(ringkasLewatJanji([baris(1_000, "belum"), baris(2_000, "tt"), baris(0, "lunas")], 0)).toEqual({
      lewatJanji: 0,
      fakturLewatJanji: 0,
    });
  });

  it("hanya keadaan 'lewat' yang dihitung lewat janji — klaim menunggu tidak", () => {
    expect(ringkasLewatJanji([baris(5_000, "lewat", 3), baris(4_000, "klaim", 20)], 0)).toEqual({
      lewatJanji: 5_000,
      fakturLewatJanji: 1,
    });
  });

  it("toleransi hari: terlambat 3 hari dengan toleransi 3 belum dihitung", () => {
    expect(ringkasLewatJanji([baris(5_000, "lewat", 3)], 3).lewatJanji).toBe(0);
    expect(ringkasLewatJanji([baris(5_000, "lewat", 4)], 3).lewatJanji).toBe(5_000);
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * The phone banner, the create-time decision and the approval panel read the gate's own figure
 * (Q10): `keadaanTagihanToko` builds its keadaan from `computeStoreCreditExposure`.
 */
d("keadaanTagihanToko — angka yang sama dengan gerbang (test bed only)", () => {
  let token = "";
  let seq = 0;
  let storeId = "";
  let userId = "";
  let uomId = "";
  let itemId = "";
  let orderIds: string[] = [];
  let receivableIds: string[] = [];
  let claimIds: string[] = [];
  let returnIds: string[] = [];

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);
    seq = 0;
    storeId = ""; userId = ""; uomId = ""; itemId = "";
    orderIds = []; receivableIds = []; claimIds = []; returnIds = [];
    const user = await prisma.user.create({ data: { email: `ttk-${token}@test.local`, name: `Sales ${token}` } });
    userId = user.id;
    const store = await prisma.store.create({
      data: { code: `TEST-TTK-${token}`, name: `Toko ${token}`, address: "test", termsType: "PUTUS", salesmanId: userId },
    });
    storeId = store.id;
    const uom = await prisma.uOM.create({ data: { code: `TEST-TTK-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-TTK-ITEM-${token}`, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 250_000 },
    });
    itemId = item.id;
  });

  afterEach(async () => {
    /* Claim links and deductions go with their claim (onDelete Cascade). */
    await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(claimIds) } } });
    await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(returnIds) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: seededIds(receivableIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  /** A manual invoice with both column families, as `tulisPiutangManual` writes it. */
  async function faktur(nilai: number, status: "OUTSTANDING" | "WRITTEN_OFF" = "OUTSTANDING") {
    seq += 1;
    const r = await prisma.receivable.create({
      data: {
        storeId,
        invoiceNo: `TEST-TTK-INV-${token}-${seq}`,
        source: "MANUAL",
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        amount: nilai,
        outstanding: nilai,
        originalAmount: nilai,
        outstandingAmount: nilai,
        status,
      },
    });
    receivableIds.push(r.id);
    return r.id;
  }

  it("faktur 15 jt + disetujui belum dinota 4 jt → 21 jt dengan pesanan 2 jt, di setiap mode", async () => {
    await faktur(15_000_000);
    seq += 1;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-TTK-ORD-${token}-${seq}`,
        storeId,
        salesmanId: userId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 4_000_000,
        total: 4_000_000,
        lines: { create: [{ itemId, variantSku: "", productName: "T", qty: 16, unitPrice: 250_000, lineTotal: 4_000_000 }] },
      },
    });
    orderIds.push(order.id);

    const { keadaan, baris: daftar } = await keadaanTagihanToko(storeId, 0);
    expect(keadaan).toEqual({ sisa: 15_000_000, belumDinota: 4_000_000, fakturTerbuka: 1, lewatJanji: 0, fakturLewatJanji: 0 });
    expect(daftar.map((b) => b.id)).toEqual(receivableIds);
    for (const mode of MODE_KREDIT) {
      const hasil = nilaiKredit(keadaan, { ...ATURAN_KREDIT_BAWAAN, mode, batasNilai: 20_000_000 }, {}, 2_000_000);
      expect(hasil.tingkat).toBe(mode);
      expect(hasil.alasan[0]).toMatchObject({ kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 21_000_000 });
    }
  });

  it("kolom tim sama dengan hitungan ulang sesudah hitungUlangPiutang — potongan retur yang ditahan ikut sisa", async () => {
    const receivableId = await faktur(1_000_000);
    seq += 1;
    const nrt = await prisma.storeReturn.create({
      data: { noNrt: `TEST-TTK-NRT-${token}-${seq}`, storeId, salesmanId: userId, claimDate: new Date(), claimedAmount: 300_000 },
    });
    returnIds.push(nrt.id);
    const claim = await prisma.paymentClaim.create({
      data: {
        docNo: `TEST-TTK-BKM-${token}-${seq}`,
        storeId,
        salesmanId: userId,
        createdById: userId,
        claimedTransferAt: new Date(),
        invoiceAmount: 600_000,
        deductionTotal: 300_000,
        receivedAmount: 300_000,
        status: "TERVERIFIKASI",
        receivableLinks: { create: [{ receivableId, settledAmount: 600_000 }] },
        deductions: { create: [{ name: "Retur", amount: 300_000, storeReturnId: nrt.id }] },
      },
    });
    claimIds.push(claim.id);
    await hitungUlangPiutang(prisma, receivableId);

    const [dihitungUlang] = await daftarPiutang({ receivableIds: [receivableId] });
    const eksposur = await computeStoreCreditExposure(prisma, storeId);
    expect(dihitungUlang.outstanding).toBe(700_000);
    expect(eksposur.receivableOutstanding).toBe(700_000);
    expect((await keadaanTagihanToko(storeId, 0)).keadaan.sisa).toBe(700_000);
  });

  it("faktur WRITTEN_OFF tidak ikut daftar maupun hitungan faktur terbuka, walau kolom modulnya masih terisi", async () => {
    await faktur(500_000, "WRITTEN_OFF");
    const buka = await faktur(200_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { keadaan, baris: daftar } = await keadaanTagihanToko(storeId, 0);
      expect(daftar.map((b) => b.id)).toEqual([buka]);
      expect(keadaan).toMatchObject({ sisa: 200_000, fakturTerbuka: 1 });
    } finally {
      warn.mockRestore();
    }
  });

  it("sisa di bawah satu rupiah yang sama di kedua keluarga kolom tidak dicatat sebagai selisih", async () => {
    await faktur(0.4);
    const buka = await faktur(200_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { keadaan, baris: daftar } = await keadaanTagihanToko(storeId, 0);
      expect(warn).not.toHaveBeenCalled();
      expect(daftar.map((b) => b.id)).toEqual([buka]);
      expect(keadaan.fakturTerbuka).toBe(1);
      expect(keadaan.sisa).toBeCloseTo(200_000.4, 2);
    } finally {
      warn.mockRestore();
    }
  });

  it("faktur yang terbuka di satu keluarga kolom dan lunas di yang lain tetap dicatat", async () => {
    seq += 1;
    const r = await prisma.receivable.create({
      data: {
        storeId,
        invoiceNo: `TEST-TTK-INV-${token}-${seq}`,
        source: "MANUAL",
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        amount: 100_000,
        outstanding: 100_000,
        originalAmount: 100_000,
        outstandingAmount: 0.4,
        status: "PARTIAL",
      },
    });
    receivableIds.push(r.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { baris: daftar } = await keadaanTagihanToko(storeId, 0);
      expect(warn).toHaveBeenCalledWith("[kredit] piutang %s: kolom tim dan hitung ulang berbeda", r.id);
      expect(daftar).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
