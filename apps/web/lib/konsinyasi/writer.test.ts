import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { REF_KOMISI_KONSI } from "@/lib/spg/hilang";
import { JEJAK } from "@/lib/receivables/jejak";
import {
  batalkanPembayaranToko,
  bayarKomisi,
  bukaKunci,
  catatNomorDokumen,
  catatPembayaranToko,
  JEJAK_BAYAR_TOKO,
  kunciAngka,
} from "./writer";
import { daftarSiklus, rincianSiklus } from "./queries";

/**
 * Uang di siklus konsinyasi, terhadap basis data sungguhan.
 *
 * Angka uji: 10 Blus × Rp150.000 = tagihan Rp1.500.000 (tanpa promo, tanpa
 * beban hilang). Komisi Rp2.000/pcs = Rp20.000, gaji pokok Rp1.000.000 per SPG.
 */

const tag = `KUG${Math.random().toString(36).slice(2, 8)}`;

let tokoId = "";
let uomId = "";
let barangId = "";
let adminId = "";
let spgA = "";
let spgB = "";
let spgC = "";
let siklusId = "";
let lossId = "";

beforeEach(async () => {
  tokoId = "";
  uomId = "";
  barangId = "";
  adminId = "";
  spgA = "";
  spgB = "";
  spgC = "";
  siklusId = "";
  lossId = "";

  tokoId = (await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", isActive: true } })).id;
  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  barangId = (
    await prisma.item.create({
      data: { sku: `${tag}-A`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId, commissionPerPcs: 2_000 },
    })
  ).id;
  adminId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-adm@uji.local`, name: `${tag} Admin`, passwordHash: "x" } })).id;
  spgA = (
    await prisma.user.create({ data: { email: `${tag.toLowerCase()}-a@uji.local`, name: `${tag} A`, passwordHash: "x", assignedStoreId: tokoId } })
  ).id;
  spgB = (
    await prisma.user.create({ data: { email: `${tag.toLowerCase()}-b@uji.local`, name: `${tag} B`, passwordHash: "x", assignedStoreId: tokoId } })
  ).id;
  siklusId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K`, storeId: tokoId, periodYear: 2026, periodMonth: 9 } })).id;
  for (const source of ["SPG", "TOKO"] as const) {
    await prisma.consignmentReport.create({
      data: { cycleId: siklusId, source, reportedAt: new Date(), items: { create: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10 }] } },
    });
  }
});

afterEach(async () => {
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
  await prisma.consignmentPayment.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: seededId(siklusId) } } });
  await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
  await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
  await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  await prisma.user.deleteMany({ where: { id: { in: seededIds([adminId, spgA, spgB, spgC].filter(Boolean)) } } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
});

const kunci = () =>
  kunciAngka({
    cycleId: siklusId,
    olehUserId: adminId,
    gajiPokokPerSpg: 1_000_000,
    baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 150_000 }],
  });

const bayar = (jumlah: number, tanggal = "2026-10-03", cara = "transfer") =>
  catatPembayaranToko({
    cycleId: siklusId,
    jumlah,
    tanggal: new Date(`${tanggal}T00:00:00+07:00`),
    cara,
    catatan: "uji",
    olehUserId: adminId,
  });

const komisiSiklus = () =>
  prisma.consignmentCommission.findMany({ where: { cycleId: siklusId }, orderBy: { spgUserId: "asc" } });

async function bayarSemuaKomisi() {
  for (const k of await komisiSiklus()) {
    expect(await bayarKomisi({ commissionId: k.id, olehUserId: adminId })).toEqual({ ok: true });
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
    expect(await bayarKomisi({ commissionId: k.id, olehUserId: adminId })).toEqual({ ok: true });
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
      expect(bayarGaji).toEqual({ ok: true });
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

describe("kunciAngka ulang — baris komisi SPG yang sudah pindah toko", () => {
  /** Beban barang hilang SPG A Rp200.000, separuhnya sudah dipotong dari baris komisinya. */
  async function potonganLamaUntuk(commissionId: string) {
    lossId = (
      await prisma.stockLoss.create({
        data: {
          storeId: tokoId,
          source: "MANUAL",
          totalQty: 1,
          totalAmount: 200_000,
          valueBasis: "HARGA_TERIMA",
          status: "DITETAPKAN",
          createdById: adminId,
          decidedById: adminId,
          decidedAt: new Date(),
        },
      })
    ).id;
    const share = await prisma.stockLossShare.create({
      data: { lossId, bearer: "SPG", bearerUserId: spgA, amount: 200_000, settledAmount: 100_000 },
    });
    await prisma.stockLossDeduction.create({
      data: { shareId: share.id, amount: 100_000, refType: REF_KOMISI_KONSI, refId: commissionId, createdById: adminId },
    });
    await prisma.consignmentCommission.update({ where: { id: commissionId }, data: { deduction: 100_000 } });
    return share.id;
  }

  /*
   * KEPUTUSAN SEMENTARA PEMILIK 2026-10-06: baris SPG yang pindah toko sesudah
   * kunci pertama TETAP miliknya — tidak dihapus, dan bagiannya tidak dibagi ke
   * SPG yang baru ditugaskan. Peserta kunci ulang = peserta kunci pertama.
   */
  it("baris SPG yang pindah toko TETAP miliknya: tidak dihapus, dihitung ulang, potongan bebannya dipotong lagi, siklusnya bisa selesai", async () => {
    await kunci();
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
    const lama = (await komisiSiklus()).find((k) => k.spgUserId === spgA)!;
    const shareId = await potonganLamaUntuk(lama.id);

    // SPG A pindah toko sesudah bulan itu selesai.
    await prisma.user.update({ where: { id: spgA }, data: { assignedStoreId: null } });
    expect(await kunci()).toMatchObject({ ok: true, jumlahSpg: 2 });

    const sesudah = await komisiSiklus();
    expect(sesudah.map((k) => k.spgUserId).sort()).toEqual([spgA, spgB].sort());
    const a = sesudah.find((k) => k.spgUserId === spgA)!;
    const b = sesudah.find((k) => k.spgUserId === spgB)!;
    // Baris yang sama (id tidak berganti), angka dibagi rata seperti kunci pertama.
    expect(a.id).toBe(lama.id);
    expect([Number(a.commission), Number(a.total)]).toEqual([10_000, 1_010_000]);
    expect([Number(b.commission), Number(b.total)]).toEqual([10_000, 1_010_000]);

    // Beban barang hilang SPG A dilepas lalu dipotong lagi dari barisnya sendiri.
    const potonganA = await prisma.stockLossDeduction.findMany({ where: { refId: lama.id }, select: { amount: true } });
    const totalPotonganA = potonganA.reduce((s, p) => s + Number(p.amount), 0);
    expect(totalPotonganA).toBeGreaterThan(0);
    expect(Number(a.deduction)).toBe(totalPotonganA);
    expect(Number((await prisma.stockLossShare.findUniqueOrThrow({ where: { id: shareId } })).settledAmount)).toBe(totalPotonganA);

    // Jejak mengunci: tidak ada yang dihapus; baris SPG yang sudah pindah disebut.
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ConsignmentCycle", entityId: siklusId, action: JEJAK.KONSI_DIKUNCI },
      orderBy: { createdAt: "desc" },
    });
    const ubah = jejak.changes as {
      before: { komisiDihapus: unknown[] };
      after: { komisiSpgPindah: { id: string; spgUserId: string }[] };
    };
    expect(ubah.before.komisiDihapus).toEqual([]);
    expect(ubah.after.komisiSpgPindah).toEqual([expect.objectContaining({ id: lama.id, spgUserId: spgA })]);

    // Gaji SPG A tetap bisa dibayar; rantainya selesai.
    await bayarSemuaKomisi();
    expect(await tahapSiklusIni()).toBe("nota");
  });

  it("SPG yang baru ditugaskan sesudah kunci pertama tidak ikut dibagi saat dikunci ulang", async () => {
    await kunci();
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
    // A pindah, C menggantikannya di toko ini.
    await prisma.user.update({ where: { id: spgA }, data: { assignedStoreId: null } });
    spgC = (
      await prisma.user.create({
        data: { email: `${tag.toLowerCase()}-c@uji.local`, name: `${tag} C`, passwordHash: "x", assignedStoreId: tokoId },
      })
    ).id;

    expect(await kunci()).toMatchObject({ ok: true, jumlahSpg: 2 });
    const sesudah = await komisiSiklus();
    expect(sesudah.map((k) => k.spgUserId).sort()).toEqual([spgA, spgB].sort());
    expect(sesudah.every((k) => Number(k.commission) === 10_000)).toBe(true);

    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ConsignmentCycle", entityId: siklusId, action: JEJAK.KONSI_DIKUNCI },
      orderBy: { createdAt: "desc" },
    });
    expect((jejak.changes as { after: { spgBaruTidakIkut: string[] } }).after.spgBaruTidakIkut).toEqual([spgC]);
  });

  it("baris SPG lama yang SUDAH dibayar tidak disentuh", async () => {
    await kunci();
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
    const lama = (await komisiSiklus()).find((k) => k.spgUserId === spgA)!;
    // Keadaan lama: dibayar selagi kuncinya terbuka (sebelum bayarKomisi menolaknya).
    await prisma.consignmentCommission.update({ where: { id: lama.id }, data: { paidAt: new Date(), paidById: adminId } });
    await prisma.user.update({ where: { id: spgA }, data: { assignedStoreId: null } });

    expect(await kunci()).toMatchObject({ ok: true });
    const tetap = await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: lama.id } });
    expect(tetap.paidAt).not.toBeNull();
    expect(Number(tetap.total)).toBe(1_010_000);
    // Baris yang sudah dibayar tetap ikut dibagi: B tidak mendapat bagian A lagi.
    const b = (await komisiSiklus()).find((k) => k.spgUserId === spgB)!;
    expect(Number(b.commission)).toBe(10_000);
  });
});

describe("pembayaran toko per siklus", () => {
  it("menolak mencatat pembayaran sebelum angkanya dikunci", async () => {
    expect(await bayar(500_000)).toEqual({ ok: false, alasan: "BELUM_DIKUNCI" });
  });

  it("boleh dicicil; sisa = tagihan beku − pembayaran; rincian dan jejak mencatatnya", async () => {
    await kunci();
    expect(await bayar(600_000)).toMatchObject({ ok: true, sisa: 900_000 });

    const r = await rincianSiklus(siklusId);
    expect(r!.tagihan.total).toBe(1_500_000);
    expect(r!.pelunasan).toMatchObject({ dibayar: 600_000, sisa: 900_000, lunas: false });
    expect(r!.pelunasan.pembayaran).toEqual([
      expect.objectContaining({ jumlah: 600_000, cara: "transfer", catatan: "uji", dibatalkanPada: null }),
    ]);

    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ConsignmentCycle", entityId: siklusId, action: JEJAK_BAYAR_TOKO.DICATAT },
    });
    expect(jejak.changes).toMatchObject({ before: { dibayar: 0, sisa: 1_500_000 }, after: { dibayar: 600_000, sisa: 900_000 } });

    expect(await bayar(900_000, "2026-10-04", "giro")).toMatchObject({ ok: true, sisa: 0 });
    expect((await rincianSiklus(siklusId))!.pelunasan).toMatchObject({ dibayar: 1_500_000, sisa: 0, lunas: true });
    expect(await bayar(1)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
  });

  it("sisa memakai tagihan BEKU utuh (− promo Elorae + beban hilang) dan lunas tepat sampai sen", async () => {
    // 3 × Rp133.333,33 (harga konsi hasil gross-up) = Rp399.999,99.
    expect(
      await kunciAngka({
        cycleId: siklusId,
        olehUserId: adminId,
        baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 3, price: 133_333.33 }],
      }),
    ).toMatchObject({ ok: true });
    // Nilai beku hasil kunci (di sini diisi langsung): promo Elorae Rp12.345,67, beban hilang ke toko Rp50.000,10.
    await prisma.consignmentCycle.update({
      where: { id: siklusId },
      data: { promoBorneByElorae: 12_345.67, lossChargedToStore: 50_000.1 },
    });
    // 399.999,99 − 12.345,67 + 50.000,10 = 437.654,42
    expect((await rincianSiklus(siklusId))!.tagihan.total).toBe(437_654.42);

    expect(await bayar(400_000)).toMatchObject({ ok: true, sisa: 37_654.42 });
    expect(await bayar(37_654.43)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect(await bayar(37_654.42)).toMatchObject({ ok: true, sisa: 0 });
    expect((await rincianSiklus(siklusId))!.pelunasan).toMatchObject({ dibayar: 437_654.42, sisa: 0, lunas: true });
    expect((await daftarSiklus()).find((b) => b.id === siklusId)?.sisaTagihan).toBe(0);
  });

  it("menolak jumlah melebihi sisa, jumlah tidak sah, cara bayar asing, dan tanggal di masa depan", async () => {
    await kunci();
    expect(await bayar(1_500_000.01)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect(await bayar(0)).toEqual({ ok: false, alasan: "NILAI_TIDAK_VALID" });
    expect(await bayar(-5_000)).toEqual({ ok: false, alasan: "NILAI_TIDAK_VALID" });
    expect(await bayar(Number.NaN)).toEqual({ ok: false, alasan: "NILAI_TIDAK_VALID" });
    expect(await bayar(10_000, "2026-10-03", "cek")).toEqual({ ok: false, alasan: "CARA_BAYAR_TIDAK_VALID" });
    const besok = new Date(Date.now() + 2 * 86_400_000);
    expect(
      await catatPembayaranToko({ cycleId: siklusId, jumlah: 10_000, tanggal: besok, cara: "tunai", olehUserId: adminId }),
    ).toEqual({ ok: false, alasan: "TANGGAL_DI_DEPAN" });
    expect(await prisma.consignmentPayment.count({ where: { cycleId: siklusId } })).toBe(0);
  });

  it("tahap menunggu pembayaran toko sesudah faktur pajak, sampai lunas", async () => {
    await kunci();
    await bayarSemuaKomisi();
    await catatNomorDokumen({ cycleId: siklusId, jenis: "NOTA", nomor: "NT-1", olehUserId: adminId });
    await catatNomorDokumen({ cycleId: siklusId, jenis: "PAJAK", nomor: "FP-1", olehUserId: adminId });
    expect(await tahapSiklusIni()).toBe("bayar_toko");
    expect((await daftarSiklus()).find((b) => b.id === siklusId)?.giliran).toBe("keuangan");

    await bayar(1_000_000);
    expect(await tahapSiklusIni()).toBe("bayar_toko");
    await bayar(500_000);
    expect(await tahapSiklusIni()).toBe("selesai");
  });

  it("buka kunci DITOLAK selama ada pembayaran; pembayaran yang dibatalkan tidak dihitung", async () => {
    await kunci();
    const p = await bayar(400_000);
    if (!p.ok) throw new Error("pembayaran gagal");
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: false, alasan: "ADA_PEMBAYARAN_TOKO" });

    expect(await batalkanPembayaranToko({ paymentId: p.id, alasan: "  ", olehUserId: adminId })).toEqual({
      ok: false,
      alasan: "ALASAN_WAJIB",
    });
    expect(await batalkanPembayaranToko({ paymentId: p.id, alasan: "salah toko", olehUserId: adminId })).toEqual({
      ok: true,
      sisa: 1_500_000,
    });
    expect(await batalkanPembayaranToko({ paymentId: p.id, alasan: "lagi", olehUserId: adminId })).toEqual({
      ok: false,
      alasan: "SUDAH_DIBATALKAN",
    });

    const r = await rincianSiklus(siklusId);
    expect(r!.pelunasan).toMatchObject({ dibayar: 0, sisa: 1_500_000, lunas: false });
    expect(r!.pelunasan.pembayaran[0]).toMatchObject({ jumlah: 400_000, alasanBatal: "salah toko" });
    expect(r!.pelunasan.pembayaran[0].dibatalkanPada).not.toBeNull();
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ConsignmentCycle", entityId: siklusId, action: JEJAK_BAYAR_TOKO.DIBATALKAN },
    });
    expect(jejak.reason).toBe("salah toko");
    expect(jejak.changes).toMatchObject({ before: { dibayar: 400_000, sisa: 1_100_000 }, after: { dibayar: 0, sisa: 1_500_000 } });

    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
  });

  it("balapan: dua pembayaran Rp1.000.000 atas tagihan Rp1.500.000 — hanya satu yang tercatat", async () => {
    await kunci();
    const hasil = await Promise.all([bayar(1_000_000), bayar(1_000_000)]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, alasan: "MELEBIHI_SISA" }]);
    const rows = await prisma.consignmentPayment.findMany({ where: { cycleId: siklusId } });
    expect(rows.reduce((n, x) => n + Number(x.amount), 0)).toBe(1_000_000);
  });

  it("balapan: buka kunci dan mencatat pembayaran tidak bisa sama-sama berhasil", async () => {
    await kunci();
    const [buka, catat] = await Promise.all([bukaKunci({ cycleId: siklusId, olehUserId: adminId }), bayar(300_000)]);
    if (buka.ok) {
      expect(catat).toEqual({ ok: false, alasan: "BELUM_DIKUNCI" });
      expect(await prisma.consignmentPayment.count({ where: { cycleId: siklusId } })).toBe(0);
    } else {
      expect(buka).toEqual({ ok: false, alasan: "ADA_PEMBAYARAN_TOKO" });
      expect(catat).toMatchObject({ ok: true, sisa: 1_200_000 });
      expect((await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } })).lockedAt).not.toBeNull();
    }
  });
});
