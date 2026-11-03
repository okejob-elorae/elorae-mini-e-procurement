import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bayarKomisi, kunciAngka } from "@/lib/konsinyasi/writer";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { hapusGajiUji, siapkanGajiUji } from "./gaji-pokok-uji";
import { tandaiKomisiDibayar, tandaiLaporanDicek, tetapkanKomisiToko } from "./komisi-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Beban barang hilang SPG dipotong PENUH di pembayaran berikutnya (P11, P11a), bukan dicicil per
 * persen dan bukan saat ditetapkan/dikunci: "Tetapkan" toko putus dan kunci siklus konsinyasi tidak
 * menulis `StockLossDeduction` apa pun; pembayaranlah yang memotong setiap bagian terbuka, terlama
 * dulu, dari komisi dulu lalu gaji pokok (P5), sejauh pembayarannya menutup — sisanya tetap terbuka
 * untuk pembayaran berikutnya. Dua pembayaran bersamaan untuk SPG yang sama tidak pernah memotong
 * satu bagian dua kali.
 *
 * Basis data sungguhan; semua baris diseed di sini dan dihapus lewat `seededId(s)`.
 */
d("potongan barang hilang penuh saat gaji & komisi SPG dibayar (test bed only)", () => {
  const tag = `KPH${Math.random().toString(36).slice(2, 8)}`;
  const JUL = "2026-07";
  const AGU = "2026-08";
  const sekarang = new Date("2026-09-05T10:00:00+07:00");
  let uomId = "";
  let katId = "";
  let kaos = "";
  let putus = "";
  let konsi = "";
  let spgA = "";
  let spgK = "";
  let kantor = "";
  const nota: string[] = [];
  const beban: string[] = [];
  const siklus: string[] = [];
  let nomor = 0;

  const tokoIds = () => seededIds([putus, konsi].filter(Boolean));
  const orangIds = () => [spgA, spgK, kantor].filter(Boolean);

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    // Tarif komisi per kategori: Rp 2.000 per kaos.
    katId = (await prisma.itemCategory.create({ data: { code: `K-${tag}`, name: `Kaos ${tag}`, isActive: true } })).id;
    await prisma.spgCommissionRate.create({ data: { itemCategoryId: katId, amountPerPiece: 2_000, effectiveFrom: "2020-01", createdById: "uji" } });
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, categoryId: katId, sellingPrice: 50_000 },
      })
    ).id;
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`, name: `Kantor ${tag}` } })).id;
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (
        await prisma.store.create({
          // Toko konsinyasi wajib punya pemegang — penagih tagihan siklusnya (P47).
          data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType, ...(termsType === "KONSI" ? { salesmanId: kantor } : {}) },
        })
      ).id;
    putus = await toko("PUTUS", "PUTUS");
    konsi = await toko("KONSI", "KONSI");
    const orang = async (nama: string, storeId: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`.toLowerCase(), name: `${nama} ${tag}`, assignedStoreId: storeId } })).id;
    spgA = await orang("Ani", putus);
    spgK = await orang("Kirana", konsi);
    // Gaji pokok Rp 1.000.000 dengan dasar hari yang pasti (catatan check-in diperiksa, hadir semua).
    for (const bulan of [JUL, AGU]) await siapkanGajiUji({ userId: spgA, storeId: putus, bulan, jumlah: 1_000_000, olehUserId: kantor });
    await siapkanGajiUji({ userId: spgK, storeId: konsi, bulan: AGU, jumlah: 1_000_000, olehUserId: kantor });
  });

  afterEach(async () => {
    const audit = await prisma.auditLog.findMany({
      where: { entityType: { in: ["SpgCommission", "SpgSalesCheck", "ConsignmentCommission", "ConsignmentCycle", "Receivable", "StockLoss"] } },
      select: { id: true, entityId: true, metadata: true },
    });
    const milikUji = audit
      .filter((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return (
          (typeof m?.storeId === "string" && tokoIds().includes(m.storeId)) ||
          (typeof m?.cycleId === "string" && siklus.includes(m.cycleId)) ||
          siklus.includes(a.entityId) ||
          beban.includes(a.entityId)
        );
      })
      .map((a) => a.id);
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    if (beban.length) {
      const bagian = await prisma.stockLossShare.findMany({ where: { lossId: { in: seededIds(beban) } }, select: { id: true } });
      await prisma.stockLossDeduction.deleteMany({ where: { shareId: { in: seededIds(bagian.map((b) => b.id)) } } });
      await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(beban) } } });
      beban.length = 0;
    }
    await prisma.spgCommissionCorrection.deleteMany({ where: { spgUserId: { in: seededIds(orangIds()) } } });
    await prisma.spgCommission.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSalesCheck.deleteMany({ where: { storeId: { in: tokoIds() } } });
    if (siklus.length) {
      await prisma.receivable.deleteMany({ where: { consignmentCycleId: { in: seededIds(siklus) } } });
      await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: { in: seededIds(siklus) } } } });
      await prisma.consignmentReport.deleteMany({ where: { cycleId: { in: seededIds(siklus) } } });
      await prisma.consignmentSold.deleteMany({ where: { cycleId: { in: seededIds(siklus) } } });
      await prisma.consignmentCommission.deleteMany({ where: { cycleId: { in: seededIds(siklus) } } });
      await prisma.consignmentCycle.deleteMany({ where: { id: { in: seededIds(siklus) } } });
      siklus.length = 0;
    }
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    nota.length = 0;
  });

  afterAll(async () => {
    await hapusGajiUji([spgA, spgK]);
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds(orangIds()) } } });
    if (kaos) await prisma.item.delete({ where: { id: seededId(kaos) } });
    if (katId) {
      await prisma.spgCommissionRate.deleteMany({ where: { itemCategoryId: seededId(katId) } });
      await prisma.itemCategory.delete({ where: { id: seededId(katId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  async function jual(salesmanId: string, storeId: string, bulan: string, qty: number) {
    const waktu = new Date(`${bulan}-12T10:00:00+07:00`);
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-${nomor++}`,
        salesmanId,
        storeId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: salesmanId,
        createdAt: waktu,
        // Kategori komisi disimpan di BARIS nota saat terjual (P8).
        lines: { create: [{ itemId: kaos, categoryId: katId, categoryAt: waktu, productName: "uji", qty, unitPrice: 50_000, lineTotal: 50_000 * qty }] },
      },
      select: { id: true },
    });
    nota.push(s.id);
  }

  /** Beban yang sudah diputuskan kantor: seluruhnya bagian satu SPG. */
  async function bebankan(userId: string, storeId: string, amount: number, diputuskan = "2026-07-20T10:00:00+07:00") {
    const l = await prisma.stockLoss.create({
      data: {
        storeId,
        source: "MANUAL",
        totalQty: 1,
        totalAmount: amount,
        valueBasis: "HARGA_ELORAE",
        status: "DITETAPKAN",
        decidedById: kantor,
        decidedAt: new Date(diputuskan),
        createdById: kantor,
        shares: { create: [{ bearer: "SPG", bearerUserId: userId, amount }] },
      },
      select: { id: true },
    });
    beban.push(l.id);
    return l.id;
  }

  const bagianDari = async (lossId: string) => {
    const b = await prisma.stockLossShare.findFirstOrThrow({ where: { lossId }, select: { settledAmount: true, settledAt: true } });
    return { dipotong: Number(b.settledAmount), lunas: b.settledAt !== null };
  };
  const potonganRef = (refType: string, refId: string) => prisma.stockLossDeduction.findMany({ where: { refType, refId }, select: { amount: true } });
  const potonganBeban = async (lossId: string) => {
    const bagian = await prisma.stockLossShare.findMany({ where: { lossId: seededId(lossId) }, select: { id: true } });
    const rows = await prisma.stockLossDeduction.findMany({ where: { shareId: { in: seededIds(bagian.map((b) => b.id)) } }, select: { amount: true } });
    return rows.reduce((n, p) => n + Number(p.amount), 0);
  };

  async function putusSiap(bulan: string, potong: number) {
    await jual(spgA, putus, bulan, potong);
    expect((await tandaiLaporanDicek({ storeId: putus, periode: bulan, olehUserId: kantor, sekarang })).ok).toBe(true);
    expect((await tetapkanKomisiToko({ storeId: putus, periode: bulan, olehUserId: kantor, sekarang })).ok).toBe(true);
    return prisma.spgCommission.findUniqueOrThrow({
      where: { userId_storeId_period: { userId: spgA, storeId: putus, period: bulan } },
      select: { id: true, commission: true, baseSalary: true, deduction: true },
    });
  }

  it("toko putus: Tetapkan tidak memotong apa pun; pembayaran memotong beban PENUH dari komisi dulu (P11a, P5)", async () => {
    const loss = await bebankan(spgA, putus, 5_000);
    const baris = await putusSiap(AGU, 4); // komisi 8.000, gaji pokok 1.000.000

    expect([Number(baris.commission), Number(baris.baseSalary), Number(baris.deduction)]).toEqual([8_000, 1_000_000, 0]);
    expect(await potonganRef(REF_KOMISI_SPG_PUTUS, baris.id)).toEqual([]);
    expect(await bagianDari(loss)).toEqual({ dipotong: 0, lunas: false });

    // 1.000.000 + 8.000 − 5.000: seluruh beban diambil dari komisi.
    expect(await tandaiKomisiDibayar({ commissionId: baris.id, olehUserId: kantor, jumlahDiharapkan: 1_003_000 })).toMatchObject({ ok: true, dibayar: 1_003_000 });
    const sesudah = await prisma.spgCommission.findUniqueOrThrow({ where: { id: baris.id }, select: { deduction: true, paidAt: true } });
    expect([Number(sesudah.deduction), sesudah.paidAt !== null]).toEqual([5_000, true]);
    expect((await potonganRef(REF_KOMISI_SPG_PUTUS, baris.id)).map((p) => Number(p.amount))).toEqual([5_000]);
    expect(await bagianDari(loss)).toEqual({ dipotong: 5_000, lunas: true });
  });

  it("toko putus: beban yang lebih besar dari pembayarannya diambil sejauh tertutup, sisanya tetap terbuka untuk pembayaran berikutnya", async () => {
    const loss = await bebankan(spgA, putus, 1_020_000);
    const baris = await putusSiap(AGU, 4); // 1.008.000 bisa dibayar

    expect(await tandaiKomisiDibayar({ commissionId: baris.id, olehUserId: kantor, jumlahDiharapkan: 0 })).toMatchObject({ ok: true, dibayar: 0 });
    expect(Number((await prisma.spgCommission.findUniqueOrThrow({ where: { id: baris.id }, select: { deduction: true } })).deduction)).toBe(1_008_000);
    expect(await bagianDari(loss)).toEqual({ dipotong: 1_008_000, lunas: false });
  });

  it("dua pembayaran bersamaan untuk SPG yang sama: satu bagian beban dipotong tepat sekali", async () => {
    const loss = await bebankan(spgA, putus, 5_000);
    const jul = await putusSiap(JUL, 2); // komisi 4.000
    const agu = await putusSiap(AGU, 4); // komisi 8.000

    // Kedua layar melihat beban 5.000 dipotong dari barisnya masing-masing.
    const [a, b] = await Promise.all([
      tandaiKomisiDibayar({ commissionId: jul.id, olehUserId: kantor, jumlahDiharapkan: 999_000 }),
      tandaiKomisiDibayar({ commissionId: agu.id, olehUserId: kantor, jumlahDiharapkan: 1_003_000 }),
    ]);
    // Yang kalah melihat angkanya berubah (bebannya sudah diambil yang menang) dan tidak menulis apa pun.
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const kalah = a.ok ? b : a;
    expect(kalah).toMatchObject({ ok: false, code: "ANGKA_BERUBAH" });
    expect(await potonganBeban(loss)).toBe(5_000);
    expect(await bagianDari(loss)).toEqual({ dipotong: 5_000, lunas: true });
  });

  it("konsinyasi: mengunci tidak memotong; pembayaran gaji & komisi memotong beban penuh", async () => {
    const cycleId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K`, storeId: konsi, periodYear: 2026, periodMonth: 8 } })).id;
    siklus.push(cycleId);
    for (const source of ["SPG", "TOKO"] as const) {
      await prisma.consignmentReport.create({
        data: { cycleId, source, reportedAt: sekarang, items: { create: [{ itemId: kaos, itemName: `Kaos ${tag}`, qty: 10 }] } },
      });
    }
    const loss = await bebankan(spgK, konsi, 10_000);
    // Komisi konsinyasi dari penjualan SPG itu sendiri di kasir: 10 kaos × Rp 2.000.
    await jual(spgK, konsi, AGU, 10);
    expect(
      await kunciAngka({ cycleId, olehUserId: kantor, sekarang, baris: [{ itemId: kaos, itemName: `Kaos ${tag}`, qty: 10, price: 50_000 }] }),
    ).toMatchObject({ ok: true, totalKomisi: 20_000 });
    const gaji = await prisma.consignmentCommission.findUniqueOrThrow({
      where: { cycleId_spgUserId: { cycleId, spgUserId: spgK } },
      select: { id: true, total: true, deduction: true, baseSalary: true },
    });
    expect([Number(gaji.baseSalary), Number(gaji.total), Number(gaji.deduction)]).toEqual([1_000_000, 1_020_000, 0]);
    expect(await potonganRef(REF_KOMISI_KONSI, gaji.id)).toEqual([]);
    expect(await bagianDari(loss)).toEqual({ dipotong: 0, lunas: false });

    expect(await bayarKomisi({ commissionId: gaji.id, olehUserId: kantor, jumlahDiharapkan: 1_010_000 })).toMatchObject({ ok: true, dibayar: 1_010_000 });
    expect(Number((await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: gaji.id }, select: { deduction: true } })).deduction)).toBe(10_000);
    expect((await potonganRef(REF_KOMISI_KONSI, gaji.id)).map((p) => Number(p.amount))).toEqual([10_000]);
    expect(await bagianDari(loss)).toEqual({ dipotong: 10_000, lunas: true });
  });
});
