import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatIDR } from "@/lib/sales-orders/format";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { payoutMonth, salesMonthLabelId, salesMonthNoteId } from "@/lib/spg-commission/payout";
import {
  aturanLama,
  bulanSudahSelesai,
  DASAR_TARIF_KATEGORI,
  JEJAK_KOMISI_SPG,
  periodeSah,
  rencanaTetapkan,
  type IsiResmi,
  type NamaJejakKomisiSpg,
} from "./komisi";
import { hitunganPutus, keBarisResmi } from "./komisi-queries";
import { REF_KOMISI_SPG_PUTUS } from "./hilang";
import { lepasPotonganHilang, potongBebanHilang } from "./hilang-potong";

/**
 * Laporan penjualan SPG toko putus: dicek, ditetapkan komisinya, dibayar (`SpgSalesCheck`,
 * `SpgCommission`). Angkanya dari satu hitungan (`lib/spg-commission/payout.ts`): tarif per
 * kategori bulan penjualan × potong yang dijual SPG itu sendiri.
 *
 * - "Tandai laporan dicek" hanya untuk bulan WIB yang SUDAH SELESAI. Bulan WIB saat dicek = bulan
 *   pembayarannya; catatannya bulan penjualan ("Komisi penjualan Oktober 2026" dibayar November).
 * - Batal dicek boleh selama belum ada komisi toko × bulan itu yang dibayar; baris yang sudah
 *   ditetapkan ikut dihapus (potongan beban hilangnya dilepas) — tanpa tanda dicek tidak ada
 *   komisi yang boleh dibayar. Setiap langkah menulis jejak di transaksi yang sama.
 * - Menetapkan butuh laporan yang sudah dicek; boleh diulang selama belum ada baris toko × bulan
 *   itu yang dibayar; setiap baris yang tergantikan hidup di jejaknya (before/after).
 * - Membayar butuh laporan yang sudah dicek DAN baris yang ditetapkan dengan tarif kategori: baris
 *   aturan lama (tarif barang / dibagi rata) ditolak sampai ditetapkan ulang — tidak ada uang baru
 *   yang keluar dari sumber angka yang sudah dipensiunkan. Penjaganya `paidAt = null` di dalam
 *   `runSerializable` — dua klik bersamaan tidak membayar dua kali.
 * - Mencek ditolak kalau toko × bulan itu sudah punya komisi yang dibayar (aturan lama): rekap
 *   akan menghitung bulan itu lagi dengan hitungan baru, padahal uangnya sudah keluar.
 * - Kabar `KOMISI_SPG` ke SPG yang bersangkutan SESUDAH transaksi.
 * - Beban barang hilang milik SPG itu dipotong SAAT komisi ditetapkan dan dibekukan di `deduction`
 *   (`StockLossDeduction` dengan `refId` baris ini). `commission` tetap komisi kotor — itulah yang
 *   dibandingkan dengan hitungan ulang (`sudahBerbeda`); yang diterima SPG = `commission − deduction`.
 */

export type KodeTolakTetapkan =
  | "PERIODE_TIDAK_SAH"
  | "BULAN_BELUM_SELESAI"
  | "TOKO_TIDAK_DITEMUKAN"
  | "BUKAN_TOKO_PUTUS"
  | "LAPORAN_BELUM_DICEK"
  | "TANPA_SPG"
  | "SUDAH_DIBAYAR";

export type HasilTetapkanKomisi =
  | { ok: true; ulang: boolean; ditulis: number; dihapus: number; totalToko: number }
  | { ok: false; code: KodeTolakTetapkan };

export type KodeTolakCek =
  | "PERIODE_TIDAK_SAH"
  | "BULAN_BELUM_SELESAI"
  | "TOKO_TIDAK_DITEMUKAN"
  | "BUKAN_TOKO_PUTUS"
  | "TANPA_PENJUALAN"
  | "SUDAH_DICEK"
  /** Toko × bulan itu sudah punya komisi yang dibayar (aturan lama) — dicek berarti dihitung dua kali. */
  | "SUDAH_DIBAYAR";

export type HasilCekLaporan = { ok: true; bulanBayar: string } | { ok: false; code: KodeTolakCek };

export type KodeTolakBatalCek = "PERIODE_TIDAK_SAH" | "BELUM_DICEK" | "SUDAH_DIBAYAR" | "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG";

export type HasilBatalCek = { ok: true; dihapus: number } | { ok: false; code: KodeTolakBatalCek };

export type KodeTolakBayar =
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIBAYAR"
  | "CATATAN_TERLALU_PANJANG"
  | "LAPORAN_BELUM_DICEK"
  /** Ditetapkan dengan aturan lama (tarif barang / dibagi rata) — tetapkan ulang dulu. */
  | "ATURAN_LAMA";

export type HasilBayarKomisi = { ok: true } | { ok: false; code: KodeTolakBayar };

const BATAS_CATATAN = 500;

type KabarTertunda = { userId: string; kabar: Kabar };

async function kirimKabar(daftar: KabarTertunda[]): Promise<void> {
  for (const k of daftar) await kabariPengguna(k.userId, k.kabar);
}

/** "2026-09" → "September 2026" — nama bulan tetap, kabar dibaca apa adanya. */
export function labelBulanKomisi(periode: string): string {
  return salesMonthLabelId(periode);
}

async function jejak(
  tx: Prisma.TransactionClient,
  isi: {
    userId: string;
    action: NamaJejakKomisiSpg;
    entityType?: "SpgCommission" | "SpgSalesCheck";
    entityId: string;
    before: unknown;
    after: unknown;
    metadata: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: isi.userId,
      action: isi.action,
      entityType: isi.entityType ?? "SpgCommission",
      entityId: isi.entityId,
      changes: { before: isi.before, after: isi.after } as Prisma.InputJsonValue,
      metadata: isi.metadata as Prisma.InputJsonValue,
      reason: isi.reason?.trim() || null,
    },
  });
}

const samaRupiah = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Kalimat komisi di kabar SPG. Dengan potongan beban barang hilang, yang disebut dulu adalah yang
 * DITERIMA — itu yang dicocokkan SPG dengan uangnya.
 */
export function kalimatKomisi(komisi: number, potongan: number): string {
  if (potongan <= 0) return `komisi Anda ${formatIDR(komisi)}.`;
  return `komisi Anda ${formatIDR(komisi)}, dipotong beban barang hilang ${formatIDR(potongan)} — diterima ${formatIDR(Math.max(0, komisi - potongan))}.`;
}

const samaIsi = (a: IsiResmi, b: IsiResmi) =>
  a.unitsSold === b.unitsSold && Math.round(a.commission * 100) === Math.round(b.commission * 100) && a.basis === b.basis;

const unik = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * "Tandai laporan dicek": kantor menyatakan penjualan SPG satu toko putus × satu bulan sudah
 * diperiksa. Bulan WIB saat ini menjadi bulan pembayaran komisinya.
 */
export async function tandaiLaporanDicek(input: {
  storeId: string;
  periode: string;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilCekLaporan> {
  if (!periodeSah(input.periode)) return { ok: false, code: "PERIODE_TIDAK_SAH" };
  const sekarang = input.sekarang ?? new Date();
  if (!bulanSudahSelesai(input.periode, bulanWib(sekarang))) return { ok: false, code: "BULAN_BELUM_SELESAI" };

  try {
    return await runSerializable(async (tx): Promise<HasilCekLaporan> => {
      const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true, termsType: true } });
      if (!toko) return { ok: false, code: "TOKO_TIDAK_DITEMUKAN" };
      if (toko.termsType !== "PUTUS") return { ok: false, code: "BUKAN_TOKO_PUTUS" };
      const ada = await tx.spgSalesCheck.findUnique({ where: { storeId_period: { storeId: toko.id, period: input.periode } }, select: { id: true } });
      if (ada) return { ok: false, code: "SUDAH_DICEK" };
      // Komisi bulan itu sudah dibayar (aturan lama, tanpa tanda dicek): tanda dicek akan membuat
      // rekap menghitungnya lagi di bulan dicek — dan tidak bisa dibatalkan karena sudah dibayar.
      const dibayar = await tx.spgCommission.findFirst({
        where: { storeId: toko.id, period: input.periode, paidAt: { not: null } },
        select: { id: true },
      });
      if (dibayar) return { ok: false, code: "SUDAH_DIBAYAR" };

      const { hasil } = await hitunganPutus(tx, toko.id, input.periode, sekarang);
      if (!hasil.perSpg.some((p) => p.penerima)) return { ok: false, code: "TANPA_PENJUALAN" };

      const waktu = sekarang;
      const cek = await tx.spgSalesCheck.create({
        data: { storeId: toko.id, period: input.periode, checkedById: input.olehUserId, checkedAt: waktu },
        select: { id: true },
      });
      const bulanBayar = payoutMonth(waktu);
      await jejak(tx, {
        userId: input.olehUserId,
        action: JEJAK_KOMISI_SPG.LAPORAN_DICEK,
        entityType: "SpgSalesCheck",
        entityId: cek.id,
        before: null,
        after: { storeId: toko.id, period: input.periode, checkedAt: waktu.toISOString() },
        metadata: {
          storeId: toko.id,
          period: input.periode,
          bulanBayar,
          catatan: salesMonthNoteId(input.periode),
          potongToko: hasil.potongToko,
          totalToko: hasil.totalToko,
          potongTanpaTarif: hasil.potongTanpaTarif,
        },
      });
      return { ok: true, bulanBayar };
    });
  } catch (e) {
    // Dua klik bersamaan: basis data menolak tanda dicek kedua (toko × bulan unik).
    if (unik(e)) return { ok: false, code: "SUDAH_DICEK" };
    throw e;
  }
}

/**
 * Batalkan tanda dicek — selama belum ada komisi toko × bulan itu yang dibayar. Komisi yang sudah
 * ditetapkan dari laporan itu ikut dihapus (potongan beban hilangnya kembali menjadi sisa beban
 * SPG-nya) dan SPG-nya dikabari; jejak menyimpan tanda dicek dan setiap baris yang dihapus.
 */
export async function batalkanTandaDicek(input: {
  storeId: string;
  periode: string;
  olehUserId: string;
  alasan: unknown;
}): Promise<HasilBatalCek> {
  if (!periodeSah(input.periode)) return { ok: false, code: "PERIODE_TIDAK_SAH" };
  const alasan = typeof input.alasan === "string" ? input.alasan.trim() : "";
  if (!alasan) return { ok: false, code: "ALASAN_WAJIB" };
  if (alasan.length > BATAS_CATATAN) return { ok: false, code: "ALASAN_TERLALU_PANJANG" };

  let kabar: KabarTertunda[] = [];
  const hasil = await runSerializable(async (tx): Promise<HasilBatalCek> => {
    kabar = [];
    const cek = await tx.spgSalesCheck.findUnique({
      where: { storeId_period: { storeId: input.storeId, period: input.periode } },
      select: { id: true, checkedAt: true, checkedById: true },
    });
    if (!cek) return { ok: false, code: "BELUM_DICEK" };
    const baris = await tx.spgCommission.findMany({
      where: { storeId: input.storeId, period: input.periode },
      select: { id: true, userId: true, unitsSold: true, commission: true, deduction: true, basis: true, paidAt: true },
    });
    if (baris.some((b) => b.paidAt !== null)) return { ok: false, code: "SUDAH_DIBAYAR" };

    const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { name: true } });
    const bulan = salesMonthLabelId(input.periode);
    for (const b of baris) {
      await lepasPotonganHilang(tx, { refType: REF_KOMISI_SPG_PUTUS, refId: b.id, userId: input.olehUserId });
      await tx.spgCommission.delete({ where: { id: b.id } });
      await jejak(tx, {
        userId: input.olehUserId,
        action: JEJAK_KOMISI_SPG.DITETAPKAN_ULANG,
        entityId: b.id,
        before: { unitsSold: b.unitsSold, commission: Number(b.commission), basis: b.basis, deduction: Number(b.deduction) },
        after: null,
        metadata: { storeId: input.storeId, period: input.periode, spgUserId: b.userId, dihapus: true, sebab: "BATAL_DICEK" },
        reason: alasan,
      });
      kabar.push({
        userId: b.userId,
        kabar: {
          jenis: JENIS_KABAR.KOMISI_SPG,
          judul: `Komisi penjualan ${bulan} diperiksa ulang`,
          isi: `${toko?.name ?? "Toko"}: kantor membuka lagi laporan penjualan ${bulan}. Komisinya ditetapkan lagi sesudah dicek.`,
          data: { period: input.periode },
        },
      });
    }
    await tx.spgSalesCheck.delete({ where: { id: cek.id } });
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_KOMISI_SPG.LAPORAN_BATAL_DICEK,
      entityType: "SpgSalesCheck",
      entityId: cek.id,
      before: { storeId: input.storeId, period: input.periode, checkedAt: cek.checkedAt.toISOString(), checkedById: cek.checkedById },
      after: null,
      metadata: { storeId: input.storeId, period: input.periode, bulanBayar: payoutMonth(cek.checkedAt), komisiDihapus: baris.length },
      reason: alasan,
    });
    return { ok: true, dihapus: baris.length };
  });

  if (hasil.ok) await kirimKabar(kabar);
  return hasil;
}

export async function tetapkanKomisiToko(input: {
  storeId: string;
  periode: string;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilTetapkanKomisi> {
  if (!periodeSah(input.periode)) return { ok: false, code: "PERIODE_TIDAK_SAH" };
  if (!bulanSudahSelesai(input.periode, bulanWib(input.sekarang ?? new Date()))) return { ok: false, code: "BULAN_BELUM_SELESAI" };

  let kabar: KabarTertunda[] = [];
  const hasil = await runSerializable(async (tx): Promise<HasilTetapkanKomisi> => {
    // Callback ini bisa diulang: kabar dari percobaan yang gagal tidak boleh ikut terkirim.
    kabar = [];
    const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true, termsType: true } });
    if (!toko) return { ok: false, code: "TOKO_TIDAK_DITEMUKAN" };
    if (toko.termsType !== "PUTUS") return { ok: false, code: "BUKAN_TOKO_PUTUS" };
    const cek = await tx.spgSalesCheck.findUnique({
      where: { storeId_period: { storeId: toko.id, period: input.periode } },
      select: { checkedAt: true },
    });
    if (!cek) return { ok: false, code: "LAPORAN_BELUM_DICEK" };

    const ada = await tx.spgCommission.findMany({
      where: { storeId: toko.id, period: input.periode },
      select: { id: true, userId: true, unitsSold: true, commission: true, deduction: true, basis: true, paidAt: true },
    });
    const potonganLama = new Map(ada.map((b) => [b.id, Number(b.deduction)]));
    const { hasil: hitung } = await hitunganPutus(tx, toko.id, input.periode, cek.checkedAt, ada.map((b) => b.userId));
    const rencana = rencanaTetapkan(hitung, ada.map(keBarisResmi));
    if (!rencana.ok) return { ok: false, code: rencana.code };

    const waktu = new Date();
    const bulan = salesMonthLabelId(input.periode);
    const bulanBayar = payoutMonth(cek.checkedAt);
    const labelBayar = salesMonthLabelId(bulanBayar);
    const tanpaTarif = new Map(hitung.perSpg.map((p) => [p.userId, p.potongTanpaTarif]));
    const meta = (spgUserId: string) => ({
      storeId: toko.id,
      period: input.periode,
      spgUserId,
      dasar: DASAR_TARIF_KATEGORI,
      bulanBayar,
      catatan: salesMonthNoteId(input.periode),
    });
    for (const t of rencana.tulis) {
      const baris = await tx.spgCommission.upsert({
        where: { userId_storeId_period: { userId: t.userId, storeId: toko.id, period: input.periode } },
        create: {
          userId: t.userId,
          storeId: toko.id,
          period: input.periode,
          unitsSold: t.isi.unitsSold,
          commission: t.isi.commission,
          basis: t.isi.basis,
          lockedById: input.olehUserId,
          lockedAt: waktu,
        },
        update: {
          unitsSold: t.isi.unitsSold,
          commission: t.isi.commission,
          basis: t.isi.basis,
          lockedById: input.olehUserId,
          lockedAt: waktu,
        },
        select: { id: true },
      });
      const lama = potonganLama.get(baris.id) ?? 0;
      await lepasPotonganHilang(tx, { refType: REF_KOMISI_SPG_PUTUS, refId: baris.id, userId: input.olehUserId });
      const potong = await potongBebanHilang(tx, {
        userId: t.userId,
        bruto: t.isi.commission,
        refType: REF_KOMISI_SPG_PUTUS,
        refId: baris.id,
        createdById: input.olehUserId,
        note: `${salesMonthNoteId(input.periode)} · ${toko.name}`,
      });
      await tx.spgCommission.update({ where: { id: baris.id }, data: { deduction: potong } });
      await jejak(tx, {
        userId: input.olehUserId,
        action: t.sebelum ? JEJAK_KOMISI_SPG.DITETAPKAN_ULANG : JEJAK_KOMISI_SPG.DITETAPKAN,
        entityId: baris.id,
        before: t.sebelum ? { unitsSold: t.sebelum.unitsSold, commission: t.sebelum.commission, basis: t.sebelum.basis, deduction: lama } : null,
        after: { ...t.isi, deduction: potong },
        metadata: { ...meta(t.userId), potongTanpaTarif: tanpaTarif.get(t.userId) ?? 0 },
      });
      if (!t.sebelum || !samaIsi(t.sebelum, t.isi) || !samaRupiah(lama, potong)) {
        kabar.push({
          userId: t.userId,
          kabar: {
            jenis: JENIS_KABAR.KOMISI_SPG,
            judul: t.sebelum ? `Komisi penjualan ${bulan} diperbarui` : `Komisi penjualan ${bulan} ditetapkan`,
            isi: `${toko.name}: ${kalimatKomisi(t.isi.commission, potong)} Dibayar ${labelBayar} setelah kantor menandainya.`,
            data: { period: input.periode },
          },
        });
      }
    }
    for (const h of rencana.hapus) {
      // Potongan beban yang menempel di baris ini kembali menjadi sisa beban SPG-nya.
      await lepasPotonganHilang(tx, { refType: REF_KOMISI_SPG_PUTUS, refId: h.id, userId: input.olehUserId });
      await tx.spgCommission.delete({ where: { id: h.id } });
      await jejak(tx, {
        userId: input.olehUserId,
        action: JEJAK_KOMISI_SPG.DITETAPKAN_ULANG,
        entityId: h.id,
        before: { ...h.sebelum, deduction: potonganLama.get(h.id) ?? 0 },
        after: null,
        metadata: { ...meta(h.userId), dihapus: true },
      });
    }
    return { ok: true, ulang: ada.length > 0, ditulis: rencana.tulis.length, dihapus: rencana.hapus.length, totalToko: hitung.totalToko };
  });

  if (hasil.ok) await kirimKabar(kabar);
  return hasil;
}

export async function tandaiKomisiDibayar(input: { commissionId: string; olehUserId: string; catatan?: unknown }): Promise<HasilBayarKomisi> {
  const catatan = typeof input.catatan === "string" ? input.catatan.trim() : "";
  if (catatan.length > BATAS_CATATAN) return { ok: false, code: "CATATAN_TERLALU_PANJANG" };

  let kabar: KabarTertunda[] = [];
  const hasil = await runSerializable(async (tx): Promise<HasilBayarKomisi> => {
    kabar = [];
    const b = await tx.spgCommission.findUnique({
      where: { id: input.commissionId },
      select: { id: true, userId: true, storeId: true, period: true, commission: true, deduction: true, basis: true, paidAt: true },
    });
    if (!b) return { ok: false, code: "TIDAK_DITEMUKAN" };
    if (b.paidAt) return { ok: false, code: "SUDAH_DIBAYAR" };
    // Tanpa laporan yang dicek tidak ada komisi yang boleh dibayar — termasuk baris aturan lama,
    // yang dicek lalu ditetapkan ulang dengan tarif kategori lebih dulu.
    const cek = await tx.spgSalesCheck.findUnique({
      where: { storeId_period: { storeId: b.storeId, period: b.period } },
      select: { checkedAt: true },
    });
    if (!cek) return { ok: false, code: "LAPORAN_BELUM_DICEK" };
    // Laporannya sudah dicek, tapi angkanya masih dari tarif barang / dibagi rata: tetapkan ulang.
    if (aturanLama(b.basis)) return { ok: false, code: "ATURAN_LAMA" };
    const waktu = new Date();
    const r = await tx.spgCommission.updateMany({
      where: { id: b.id, paidAt: null },
      data: { paidAt: waktu, paidById: input.olehUserId, ...(catatan ? { note: catatan } : {}) },
    });
    if (r.count !== 1) return { ok: false, code: "SUDAH_DIBAYAR" };
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_KOMISI_SPG.DIBAYAR,
      entityId: b.id,
      before: { paidAt: null },
      after: { paidAt: waktu.toISOString() },
      metadata: {
        storeId: b.storeId,
        period: b.period,
        spgUserId: b.userId,
        commission: Number(b.commission),
        deduction: Number(b.deduction),
        bulanBayar: payoutMonth(cek.checkedAt),
        catatan: salesMonthNoteId(b.period),
      },
      reason: catatan || null,
    });
    const toko = await tx.store.findUnique({ where: { id: b.storeId }, select: { name: true } });
    kabar.push({
      userId: b.userId,
      kabar: {
        jenis: JENIS_KABAR.KOMISI_SPG,
        judul: `${salesMonthNoteId(b.period)} dibayar`,
        isi:
          Number(b.deduction) > 0
            ? `${toko?.name ?? "Toko"}: ${formatIDR(Math.max(0, Number(b.commission) - Number(b.deduction)))} sudah dibayar (komisi ${formatIDR(Number(b.commission))} dipotong beban barang hilang ${formatIDR(Number(b.deduction))}).`
            : `${toko?.name ?? "Toko"}: komisi ${formatIDR(Number(b.commission))} sudah dibayar.`,
        data: { period: b.period },
      },
    });
    return { ok: true };
  });

  if (hasil.ok) await kirimKabar(kabar);
  return hasil;
}
