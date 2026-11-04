import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { REF_KOMISI_KONSI } from "@/lib/spg/hilang";
import { JEJAK } from "@/lib/receivables/jejak";
import { hapusGajiUji, siapkanGajiUji } from "@/lib/spg/gaji-pokok-uji";
import { bayarKomisi, bukaKunci, catatNomorDokumen, kunciAngka } from "./writer";
import { daftarSiklus, rincianSiklus } from "./queries";
import { payoutMonth } from "@/lib/spg-commission/payout";
import { daftarKomisiKantor } from "@/lib/spg/komisi-queries";

/**
 * Uang di siklus konsinyasi, terhadap basis data sungguhan.
 *
 * Angka uji: 10 Blus × Rp150.000 = tagihan Rp1.500.000 (tanpa promo, tanpa
 * beban hilang). Komisi memakai satu hitungan (keputusan pemilik 2026-11-01):
 * tarif kategori Blus Rp2.000/pcs × potong yang dijual masing-masing SPG di
 * kasir — A dan B masing-masing 5 → Rp10.000 per SPG; gaji pokok Rp1.000.000
 * per SPG, dari gaji bulanan + catatan check-in yang sudah diperiksa (`siapkanGajiUji`) — tidak
 * diketik saat mengunci lagi. Tarif di master barang sengaja diisi lain dan tidak boleh terbaca.
 * Kategori komisi dibaca dari BARIS nota (P8/P69), jadi baris nota uji membawa kategorinya. Mengunci
 * melahirkan tagihan siklus di Piutang (toko butuh salesman pemegang).
 */

const tag = `KUG${Math.random().toString(36).slice(2, 8)}`;

let tokoId = "";
let uomId = "";
let barangId = "";
let kategoriId = "";
let adminId = "";
let spgA = "";
let spgB = "";
let spgC = "";
let siklusId = "";
let lossId = "";
const notaSpg: string[] = [];

beforeEach(async () => {
  tokoId = "";
  uomId = "";
  barangId = "";
  kategoriId = "";
  adminId = "";
  notaSpg.length = 0;
  spgA = "";
  spgB = "";
  spgC = "";
  siklusId = "";
  lossId = "";

  // Toko ber-PPN: tes di berkas ini memakai alur faktur pajak; toko tanpa PPN diuji tersendiri.
  tokoId = (
    await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", isActive: true, consignmentVat: true } })
  ).id;
  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  kategoriId = (await prisma.itemCategory.create({ data: { code: `K-${tag}`, name: `${tag} Blus`, isActive: true } })).id;
  await prisma.spgCommissionRate.create({ data: { itemCategoryId: kategoriId, amountPerPiece: 2_000, effectiveFrom: "2020-01", createdById: "uji" } });
  barangId = (
    await prisma.item.create({
      data: { sku: `${tag}-A`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId, categoryId: kategoriId, commissionPerPcs: 7_777 },
    })
  ).id;
  adminId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-adm@uji.local`, name: `${tag} Admin`, passwordHash: "x" } })).id;
  spgA = (
    await prisma.user.create({ data: { email: `${tag.toLowerCase()}-a@uji.local`, name: `${tag} A`, passwordHash: "x", assignedStoreId: tokoId } })
  ).id;
  spgB = (
    await prisma.user.create({ data: { email: `${tag.toLowerCase()}-b@uji.local`, name: `${tag} B`, passwordHash: "x", assignedStoreId: tokoId } })
  ).id;
  // Penagih tagihan siklus (P47) dan dasar gaji pokok yang pasti (P60) — bukan pokok tes di sini.
  await prisma.store.update({ where: { id: tokoId }, data: { salesmanId: adminId } });
  for (const spg of [spgA, spgB]) await siapkanGajiUji({ userId: spg, storeId: tokoId, bulan: "2026-09", jumlah: 1_000_000, olehUserId: adminId });
  siklusId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K`, storeId: tokoId, periodYear: 2026, periodMonth: 9 } })).id;
  // Penjualan SPG di kasir bulan siklus: komisinya milik yang menjual.
  for (const [i, spg] of [spgA, spgB].entries()) {
    const nota = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-N${i}`,
        salesmanId: spg,
        storeId: tokoId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: spg,
        createdAt: new Date("2026-09-15T10:00:00+07:00"),
        lines: {
          create: [
            {
              itemId: barangId,
              categoryId: kategoriId,
              categoryAt: new Date("2026-09-15T10:00:00+07:00"),
              productName: `${tag} Blus`,
              qty: 5,
              unitPrice: 150_000,
              lineTotal: 750_000,
            },
          ],
        },
      },
      select: { id: true },
    });
    notaSpg.push(nota.id);
  }
  for (const source of ["SPG", "TOKO"] as const) {
    await prisma.consignmentReport.create({
      data: { cycleId: siklusId, source, reportedAt: new Date(), items: { create: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10 }] } },
    });
  }
});

afterEach(async () => {
  await prisma.spgCommissionCorrection.deleteMany({ where: { spgUserId: { in: seededIds([spgA, spgB, spgC].filter(Boolean)) } } });
  const komisi = await prisma.consignmentCommission.findMany({ where: { cycleId: seededId(siklusId) }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: seededIds([adminId].filter(Boolean)) } } });
  await prisma.stockLossDeduction.deleteMany({ where: { refId: { in: seededIds(komisi.map((k) => k.id)) } } });
  // Potongan yang menunjuk baris komisi yang sudah dihapus tidak terjangkau lewat
  // `komisi` di atas — dihapus lewat bagian bebannya.
  const bagian = lossId
    ? await prisma.stockLossShare.findMany({ where: { lossId: seededId(lossId) }, select: { id: true } })
    : [];
  await prisma.stockLossDeduction.deleteMany({ where: { shareId: { in: seededIds(bagian.map((b) => b.id)) } } });
  await prisma.stockLossShare.deleteMany({ where: { lossId: seededId(lossId) } });
  await prisma.stockLoss.deleteMany({ where: { id: seededId(lossId) } });
  await prisma.receivable.deleteMany({ where: { consignmentCycleId: seededId(siklusId) } });
  await hapusGajiUji([spgA, spgB, spgC]);
  await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: seededId(siklusId) } } });
  await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
  await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaSpg) } } });
  await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
  await prisma.spgCommissionRate.deleteMany({ where: { itemCategoryId: seededId(kategoriId) } });
  await prisma.itemCategory.deleteMany({ where: { id: seededId(kategoriId) } });
  await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  await prisma.user.deleteMany({ where: { id: { in: seededIds([adminId, spgA, spgB, spgC].filter(Boolean)) } } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
});

const kunci = () =>
  kunciAngka({
    cycleId: siklusId,
    olehUserId: adminId,
    baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 150_000 }],
  });

const komisiSiklus = () =>
  prisma.consignmentCommission.findMany({ where: { cycleId: siklusId }, orderBy: { spgUserId: "asc" } });

async function bayarSemuaKomisi() {
  for (const k of await komisiSiklus()) {
    expect(await bayarKomisi({ commissionId: k.id, olehUserId: adminId })).toMatchObject({ ok: true });
  }
}

const tahapSiklusIni = async () => (await daftarSiklus()).find((b) => b.id === siklusId)?.tahap;

describe("bayarKomisi hanya untuk siklus terkunci", () => {
  it("menolak membayar baris komisi dari siklus yang kuncinya sudah dibuka", async () => {
    expect(await kunci()).toMatchObject({ ok: true, jumlahSpg: 2 });
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });

    // Barisnya masih ada (angka lama), tapi angka itu bisa berubah saat dikunci ulang.
    const [k] = await komisiSiklus();
    expect(await bayarKomisi({ commissionId: k.id, olehUserId: adminId })).toEqual({ ok: false, alasan: "BELUM_DIKUNCI" });
    expect((await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: k.id } })).paidAt).toBeNull();
  });

  it("membayar baris komisi siklus yang terkunci", async () => {
    await kunci();
    const [k] = await komisiSiklus();
    expect(Number(k.total)).toBe(1_010_000);
    expect(await bayarKomisi({ commissionId: k.id, olehUserId: adminId, jumlahDiharapkan: 1_010_000 })).toMatchObject({
      ok: true,
      cycleId: siklusId,
      diubah: false,
      dibayar: 1_010_000,
      koreksi: 0,
    });
  });

  it("yang dibayarkan berbeda dari yang dilihat kantor: ANGKA_BERUBAH, tidak ada yang tertulis", async () => {
    await kunci();
    const [k] = await komisiSiklus();
    expect(await bayarKomisi({ commissionId: k.id, olehUserId: adminId, jumlahDiharapkan: 1_000_000 })).toEqual({ ok: false, alasan: "ANGKA_BERUBAH" });
    const tetap = await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: k.id }, select: { paidAt: true, commission: true, total: true } });
    expect([tetap.paidAt, Number(tetap.commission), Number(tetap.total)]).toEqual([null, 10_000, 1_010_000]);
    expect(await prisma.auditLog.count({ where: { action: JEJAK.KONSI_GAJI_DIBAYAR, entityId: seededId(k.id) } })).toBe(0);
  });

  it("dua klik bersamaan pada baris yang sama: satu dibayar, satu SUDAH_DIBAYAR, satu jejak", async () => {
    await kunci();
    const [k] = await komisiSiklus();
    const hasil = await Promise.all([
      bayarKomisi({ commissionId: k.id, olehUserId: adminId, jumlahDiharapkan: 1_010_000 }),
      bayarKomisi({ commissionId: k.id, olehUserId: adminId, jumlahDiharapkan: 1_010_000 }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, alasan: "SUDAH_DIBAYAR" }]);
    expect(await prisma.auditLog.count({ where: { action: JEJAK.KONSI_GAJI_DIBAYAR, entityId: seededId(k.id) } })).toBe(1);
  });
});

describe("balapan buka kunci", () => {
  it("buka kunci dan membayar gaji SPG tidak bisa sama-sama berhasil", async () => {
    await kunci();
    const [k] = await komisiSiklus();
    const [buka, bayarGaji] = await Promise.all([
      bukaKunci({ cycleId: siklusId, olehUserId: adminId }),
      bayarKomisi({ commissionId: k.id, olehUserId: adminId }),
    ]);
    if (buka.ok) {
      expect(bayarGaji).toEqual({ ok: false, alasan: "BELUM_DIKUNCI" });
      expect((await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: k.id } })).paidAt).toBeNull();
    } else {
      expect(buka).toEqual({ ok: false, alasan: "ADA_GAJI_SUDAH_DIBAYAR" });
      expect(bayarGaji).toMatchObject({ ok: true });
      expect((await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } })).lockedAt).not.toBeNull();
    }
  });

  it("buka kunci dan mencatat nomor nota tidak bisa sama-sama berhasil", async () => {
    await kunci();
    const [buka, nota] = await Promise.all([
      bukaKunci({ cycleId: siklusId, olehUserId: adminId }),
      catatNomorDokumen({ cycleId: siklusId, jenis: "NOTA", nomor: "NT-9", olehUserId: adminId }),
    ]);
    const c = await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } });
    if (buka.ok) {
      expect(nota).toEqual({ ok: false, alasan: "BELUM_DIKUNCI" });
      expect(c.noNota).toBeNull();
    } else {
      expect(buka).toEqual({ ok: false, alasan: "ADA_NOTA" });
      expect(nota).toEqual({ ok: true });
      expect(c.lockedAt).not.toBeNull();
    }
  });
});

describe("bukaKunci ditolak sesudah nota atau faktur pajak", () => {
  it("menolak membuka kunci sesudah nomor nota dicatat", async () => {
    await kunci();
    expect(await catatNomorDokumen({ cycleId: siklusId, jenis: "NOTA", nomor: "NT-77", olehUserId: adminId })).toEqual({ ok: true });
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: false, alasan: "ADA_NOTA" });
    expect((await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } })).lockedAt).not.toBeNull();
  });

  it("menolak membuka kunci sesudah nomor faktur pajak dicatat", async () => {
    await kunci();
    expect(await catatNomorDokumen({ cycleId: siklusId, jenis: "PAJAK", nomor: "010.000-26.1", olehUserId: adminId })).toEqual({
      ok: true,
    });
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: false, alasan: "ADA_FAKTUR_PAJAK" });
  });

  it("tanpa nota, faktur, pembayaran toko, dan gaji dibayar, kunci masih bisa dibuka", async () => {
    await kunci();
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
  });
});

describe("PPN tagihan konsinyasi per toko", () => {
  it("toko tanpa PPN: dibekukan saat dikunci, tahap faktur pajak dilewati, nomor faktur ditolak", async () => {
    await prisma.store.update({ where: { id: tokoId }, data: { consignmentVat: false } });
    await kunci();
    expect((await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } })).vatApplied).toBe(false);
    await bayarSemuaKomisi();
    expect(await catatNomorDokumen({ cycleId: siklusId, jenis: "NOTA", nomor: "NT-5", olehUserId: adminId })).toEqual({ ok: true });
    // Tanpa PPN tidak ada faktur pajak: langsung menunggu pembayaran toko.
    expect(await tahapSiklusIni()).toBe("bayar_toko");
    expect(await catatNomorDokumen({ cycleId: siklusId, jenis: "PAJAK", nomor: "010.000-26.9", olehUserId: adminId })).toEqual({
      ok: false,
      alasan: "TANPA_PPN",
    });
    expect((await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } })).noFakturPajak).toBeNull();
    expect((await rincianSiklus(siklusId))?.tagihan.pakaiPpn).toBe(false);
  });

  it("sakelar toko yang diubah sesudah dikunci tidak mengubah siklus terkunci; sebelum dikunci kartu mengikuti sakelar", async () => {
    expect((await rincianSiklus(siklusId))?.tagihan.pakaiPpn).toBe(true);
    await kunci();
    await prisma.store.update({ where: { id: tokoId }, data: { consignmentVat: false } });
    expect((await rincianSiklus(siklusId))?.tagihan.pakaiPpn).toBe(true);
    await bayarSemuaKomisi();
    await catatNomorDokumen({ cycleId: siklusId, jenis: "NOTA", nomor: "NT-6", olehUserId: adminId });
    expect(await tahapSiklusIni()).toBe("pajak");
  });
});

describe("kunciAngka — komisi SPG dari satu hitungan (tarif kategori × penjualan masing-masing)", () => {
  it("dibagi menurut penjualan masing-masing SPG, bukan rata; tarif kategori disalin ke baris resmi; bulan kunci = bulan bayar", async () => {
    // A menjual 5 lagi: di kasir A 10, B 5. Angka resmi 15 → A 10 × Rp2.000, B 5 × Rp2.000.
    const lagi = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-N9`,
        salesmanId: spgA,
        storeId: tokoId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: spgA,
        createdAt: new Date("2026-09-20T10:00:00+07:00"),
        lines: { create: [{ itemId: barangId, productName: `${tag} Blus`, qty: 5, unitPrice: 150_000, lineTotal: 750_000 }] },
      },
      select: { id: true },
    });
    notaSpg.push(lagi.id);

    const h = await kunciAngka({
      cycleId: siklusId,
      olehUserId: adminId,
        baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 15, price: 150_000 }],
    });
    expect(h).toMatchObject({ ok: true, totalKomisi: 30_000, jumlahSpg: 2 });
    const komisi = await komisiSiklus();
    expect(new Map(komisi.map((k) => [k.spgUserId, Number(k.commission)]))).toEqual(
      new Map([
        [spgA, 20_000],
        [spgB, 10_000],
      ]),
    );
    // Tarif di master barang (7.777) tidak terbaca; yang disalin tarif kategori bulan penjualan.
    const resmi = await prisma.consignmentSold.findMany({ where: { cycleId: siklusId }, select: { commissionPerPcs: true } });
    expect(resmi.map((r) => Number(r.commissionPerPcs))).toEqual([2_000]);

    const siklus = await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId }, select: { lockedAt: true } });
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ConsignmentCycle", entityId: siklusId, action: JEJAK.KONSI_DIKUNCI },
      orderBy: { createdAt: "desc" },
    });
    expect(jejak.metadata).toMatchObject({
      aturanKomisi: "TARIF_KATEGORI",
      bulanJual: "2026-09",
      bulanBayar: payoutMonth(siklus.lockedAt!),
      catatanKomisi: "Komisi penjualan September 2026",
    });
  });

  it("angka resmi di bawah catatan kasir membatasi potong terkonfirmasi; dikunci ulang tidak menggandakan baris", async () => {
    // Di kasir A 5, B 5; angka resmi 6 → 6 dibagi 5:5 → 3 dan 3.
    const kunciEnam = () =>
      kunciAngka({ cycleId: siklusId, olehUserId: adminId, baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 6, price: 150_000 }] });
    expect(await kunciEnam()).toMatchObject({ ok: true, totalKomisi: 12_000 });
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
    expect(await kunciEnam()).toMatchObject({ ok: true, totalKomisi: 12_000 });
    const komisi = await komisiSiklus();
    expect(komisi).toHaveLength(2);
    expect(komisi.map((k) => Number(k.commission))).toEqual([6_000, 6_000]);
  });

  it("halaman Komisi SPG menyandingkan hitungan sekarang dengan angka yang dikunci, dan menandai bedanya (mis. siklus aturan lama)", async () => {
    await kunci();
    const { lockedAt } = await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId }, select: { lockedAt: true } });
    const kartu = async () => (await daftarKomisiKantor(payoutMonth(lockedAt!), new Date())).konsi.find((k) => k.cycleId === siklusId);

    const sama = await kartu();
    expect(sama).toMatchObject({ totalHitung: 20_000, totalTersimpan: 20_000, berbeda: false, adaDibayar: false });
    expect(sama?.baris.map((b) => [b.komisiHitung, b.komisi, b.gajiPokok])).toEqual([
      [10_000, 10_000, 1_000_000],
      [10_000, 10_000, 1_000_000],
    ]);

    // Siklus yang dikunci dengan aturan lama (tarif barang, dibagi rata) menyimpan angka lain.
    await prisma.consignmentCommission.updateMany({ where: { cycleId: seededId(siklusId) }, data: { commission: 38_885, total: 1_038_885 } });
    const lama = await kartu();
    expect(lama).toMatchObject({ totalHitung: 20_000, totalTersimpan: 77_770, berbeda: true });
    expect(lama?.baris.map((b) => b.komisiHitung)).toEqual([10_000, 10_000]);
    // Yang AKAN dibayar adalah komisi per SPG sekarang — kunci tidak perlu dibuka.
    const [baris] = lama!.baris;
    expect(baris.bayar).toMatchObject({ berubah: true, komisiLama: 38_885, komisiBaru: 10_000, dibayar: 1_010_000 });
    expect(await bayarKomisi({ commissionId: baris.id, olehUserId: adminId, jumlahDiharapkan: 1_010_000 })).toMatchObject({ ok: true, diubah: true, dibayar: 1_010_000 });
    const dibayar = await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: baris.id }, select: { commission: true, total: true, paidAt: true } });
    expect([Number(dibayar.commission), Number(dibayar.total), dibayar.paidAt !== null]).toEqual([10_000, 1_010_000, true]);
  });
});

describe("kunciAngka — tagihan siklus di Piutang dan gerbangnya", () => {
  it("mengunci melahirkan satu tagihan bernomor konsi untuk salesman pemegang; buka kunci membatalkannya", async () => {
    const r = await kunci();
    expect(r).toMatchObject({ ok: true });
    const tagihan = await prisma.receivable.findMany({ where: { consignmentCycleId: siklusId } });
    expect(tagihan).toHaveLength(1);
    expect(tagihan[0]).toMatchObject({ invoiceNo: `${tag}/K`, isConsignment: true, salesmanId: adminId });
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
    const batal = await prisma.receivable.findUniqueOrThrow({ where: { id: tagihan[0].id }, select: { status: true } });
    expect(batal.status).toBe("VOIDED");
  });

  it("tagihan bertanggal akhir bulan siklus; jatuh tempo = hari dikunci (WIB) + tempo toko (P54)", async () => {
    await prisma.store.update({ where: { id: tokoId }, data: { paymentTempo: 30 } });
    const r = await kunciAngka({
      cycleId: siklusId,
      olehUserId: adminId,
      sekarang: new Date("2026-10-05T10:00:00+07:00"),
      baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 150_000 }],
    });
    expect(r).toMatchObject({ ok: true });
    const t = await prisma.receivable.findFirstOrThrow({ where: { consignmentCycleId: seededId(siklusId) }, select: { invoiceDate: true, dueDate: true } });
    expect(t.invoiceDate.toISOString()).toBe(new Date("2026-09-30T00:00:00+07:00").toISOString());
    expect(t.dueDate.toISOString()).toBe(new Date("2026-11-04T00:00:00+07:00").toISOString());
  });

  it("toko tanpa salesman pemegang tidak bisa dikunci (TOKO_TANPA_PEMEGANG)", async () => {
    await prisma.store.update({ where: { id: tokoId }, data: { salesmanId: null } });
    expect(await kunci()).toEqual({ ok: false, alasan: "TOKO_TANPA_PEMEGANG" });
  });

  it("bulan siklus yang belum selesai tidak bisa dikunci (BULAN_BELUM_SELESAI)", async () => {
    expect(
      await kunciAngka({
        cycleId: siklusId,
        olehUserId: adminId,
        sekarang: new Date("2026-09-20T10:00:00+07:00"),
        baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 150_000 }],
      }),
    ).toEqual({ ok: false, alasan: "BULAN_BELUM_SELESAI" });
  });

  it("gaji pokok dihitung dari gaji bulanan dan catatan check-in, tidak diketik", async () => {
    expect(await kunci()).toMatchObject({ ok: true });
    const rows = await komisiSiklus();
    expect(rows.map((k) => Number(k.baseSalary))).toEqual([1_000_000, 1_000_000]);
  });
});
