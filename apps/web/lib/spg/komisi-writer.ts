import { Prisma, prisma, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatIDR } from "@/lib/sales-orders/format";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { commissionRates, putusReportOf } from "@/lib/spg-commission/laporan-queries";
import { commissionPerSpg, payoutMonth, putusReportKey, salesMonthLabelId, salesMonthNoteId } from "@/lib/spg-commission/payout";
import { ingatkanCatatanHadirPerlu, sebarPengingatCatatan } from "./absen-catatan-hadir-writer";
import type { AlasanTahanBayar, HasilGaji } from "./gaji-pokok";
import { kunciGaji, kunciTokoBulan, muatGajiPokok, muatPesertaGaji } from "./gaji-pokok-queries";
import {
  bulanSudahSelesai,
  DASAR_TARIF_KATEGORI,
  JEJAK_KOMISI_SPG,
  laporanPerluDicek,
  periodeSah,
  potongTanpaKategori,
  rencanaTetapkan,
  type IsiResmi,
  type TanpaKategori,
  type NamaJejakKomisiSpg,
} from "./komisi";
import { terapkanPembayaran } from "./komisi-bayar";
import { hitunganPutus, keBarisResmi } from "./komisi-queries";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { rangkaiDalamBatas } from "./antaran";
import { kalimatKoreksiKabar, kalimatPotongKabar } from "./koreksi";
import { unitKomisiSpg } from "./koreksi-queries";
import { catatHitungUlangSaatBayar, KomisiBerubahError, siapkanBayarKomisi } from "./koreksi-writer";

/**
 * Laporan penjualan SPG toko putus: dicek, ditetapkan gaji & komisinya, dibayar (`SpgSalesCheck`,
 * `SpgCommission`). Komisi dari satu hitungan (`lib/spg-commission/payout.ts`): tarif per kategori
 * bulan penjualan × potong yang dijual SPG itu sendiri. Gaji pokok dari jadwal / catatan check-in
 * bulan itu (`lib/spg/gaji-pokok.ts`) — SPG toko putus juga digaji lewat sistem (P63).
 *
 * - "Tandai laporan dicek" hanya untuk bulan WIB yang SUDAH SELESAI, dan hanya untuk bulan yang
 *   mengonfirmasi potong ATAU punya peserta gaji (`laporanPerluDicek`; tanpa keduanya `TANPA_PESERTA`).
 *   Bulan WIB saat dicek = bulan pembayarannya.
 * - Batal dicek boleh selama belum ada baris toko × bulan itu yang dibayar; baris yang sudah
 *   ditetapkan ikut dihapus. Setiap langkah menulis jejak di transaksi yang sama.
 * - Menetapkan butuh laporan yang sudah dicek; satu baris untuk SETIAP peserta gaji, walau komisinya
 *   nol, dengan potret gaji pokoknya (B19, B21); boleh diulang selama belum ada yang dibayar. Baris
 *   yang dasar gajinya belum pasti (P60) tetap ditulis, tertahan, dan kantor diingatkan (P7e).
 * - Membayar butuh laporan yang sudah dicek (keputusan 7 — tidak ada jalan lain). Yang dibayar SELALU
 *   gaji & komisi yang dihitung ulang di transaksi pembayarannya (`siapkanBayarKomisi`); baris yang
 *   ditahan ditolak dengan sebabnya. Beban barang hilang, beban retur pembeli dan utang SPG dipotong
 *   PENUH saat dibayar — dari komisi dulu, baru gaji pokok (P5, P11a, P13a) — tidak pernah saat
 *   ditetapkan. `jumlahDiharapkan` = yang dilihat kantor; berbeda → `ANGKA_BERUBAH`, tidak ada yang
 *   tertulis. Penjaganya `paidAt = null` di dalam `runSerializable`.
 * - Kabar `KOMISI_SPG` ke SPG yang bersangkutan SESUDAH transaksi; baris yang ditahan tanpa rupiah.
 */

export type KodeTolakTetapkan =
  | "PERIODE_TIDAK_SAH"
  | "BULAN_BELUM_SELESAI"
  | "TOKO_TIDAK_DITEMUKAN"
  | "BUKAN_TOKO_PUTUS"
  | "LAPORAN_BELUM_DICEK"
  | "TANPA_PESERTA"
  | "SUDAH_DIBAYAR";

export type HasilTetapkanKomisi =
  | { ok: true; ulang: boolean; ditulis: number; dihapus: number; totalToko: number; ditahan: number }
  | { ok: false; code: KodeTolakTetapkan };

export type KodeTolakCek = "PERIODE_TIDAK_SAH" | "BULAN_BELUM_SELESAI" | "TOKO_TIDAK_DITEMUKAN" | "BUKAN_TOKO_PUTUS" | "TANPA_PESERTA" | "SUDAH_DICEK";

/** Potong yang masih tanpa kategori di laporan itu — komisinya menyusul begitu kategorinya diisi (P69). */
export { potongTanpaKategori, type TanpaKategori } from "./komisi";

export type HasilCekLaporan = { ok: true; bulanBayar: string; tanpaKategori: TanpaKategori[] } | { ok: false; code: KodeTolakCek };

export type KodeTolakBatalCek = "PERIODE_TIDAK_SAH" | "BELUM_DICEK" | "SUDAH_DIBAYAR" | "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG";

export type HasilBatalCek = { ok: true; dihapus: number } | { ok: false; code: KodeTolakBatalCek };

export type KodeTolakBayar =
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIBAYAR"
  | "CATATAN_TERLALU_PANJANG"
  | "LAPORAN_BELUM_DICEK"
  /** Yang dibayarkan berbeda dari yang dilihat kantor — halaman dimuat ulang. */
  | "ANGKA_BERUBAH"
  /** Dasar gaji bulan itu belum pasti — seluruh pembayaran menunggu (P60). */
  | AlasanTahanBayar;

export type HasilBayarKomisi =
  | { ok: true; storeId: string; periode: string; diubah: boolean; dibayar: number; koreksi: number; utang: number }
  | { ok: false; code: KodeTolakBayar; jumlah?: number; hari?: string[] };

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

/** Kalimat gaji & komisi di kabar penetapan; tanpa rupiah selama ditahan (B34). */
export function kalimatKomisi(komisi: number, gajiPokok: number, ditahan: AlasanTahanBayar | null): string {
  if (ditahan) return "pembayarannya menunggu kantor melengkapi dasar gaji bulan itu.";
  return gajiPokok > 0 ? `gaji pokok ${formatIDR(gajiPokok)} + komisi ${formatIDR(komisi)}.` : `komisi Anda ${formatIDR(komisi)}.`;
}

const samaIsi = (a: IsiResmi & { baseSalary: number }, b: IsiResmi & { baseSalary: number }) =>
  a.unitsSold === b.unitsSold && samaRupiah(a.commission, b.commission) && a.basis === b.basis && samaRupiah(a.baseSalary, b.baseSalary);

const unik = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";


/**
 * Gaji satu SPG × bulan sudah dihitung di baris KONSINYASI (toko yang berganti syarat): penunjuknya,
 * supaya baris putus menulis Rp 0 dan gaji sebulan tidak dibayar dua kali.
 */
async function gajiDiBarisKonsi(tx: Prisma.TransactionClient, userIds: readonly string[], periode: string): Promise<Map<string, { refType: string; refId: string }>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.consignmentCommission.findMany({
    where: { spgUserId: { in: [...userIds] }, cycle: { periodYear: Number(periode.slice(0, 4)), periodMonth: Number(periode.slice(5, 7)) } },
    select: { id: true, spgUserId: true, salaryDetail: true },
  });
  const hasil = new Map<string, { refType: string; refId: string }>();
  for (const r of rows) {
    const d = r.salaryDetail as { jenis?: unknown } | null;
    if (d?.jenis === "DI_BARIS_LAIN") continue;
    hasil.set(r.spgUserId, { refType: REF_KOMISI_KONSI, refId: r.id });
  }
  return hasil;
}

/**
 * "Tandai laporan dicek": kantor menyatakan penjualan SPG satu toko putus × satu bulan sudah
 * diperiksa. Bulan WIB saat ini menjadi bulan pembayaran gaji & komisinya.
 */
export async function tandaiLaporanDicek(input: { storeId: string; periode: string; olehUserId: string; sekarang?: Date }): Promise<HasilCekLaporan> {
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

      const [{ laporan, hasil }, pesertaPer] = await Promise.all([
        hitunganPutus(tx, toko.id, input.periode, sekarang),
        muatPesertaGaji(tx, [{ storeId: toko.id, bulan: input.periode }]),
      ]);
      const peserta = pesertaPer.get(kunciTokoBulan(toko.id, input.periode)) ?? [];
      // Satu definisi dengan antrean "menunggu dicek" dan Beranda (`pasanganPutusTertunda`).
      if (!laporanPerluDicek(laporan, peserta)) return { ok: false, code: "TANPA_PESERTA" };

      const cek = await tx.spgSalesCheck.create({
        data: { storeId: toko.id, period: input.periode, checkedById: input.olehUserId, checkedAt: sekarang },
        select: { id: true },
      });
      const bulanBayar = payoutMonth(sekarang);
      const tanpaKategori = potongTanpaKategori(laporan);
      await jejak(tx, {
        userId: input.olehUserId,
        action: JEJAK_KOMISI_SPG.LAPORAN_DICEK,
        entityType: "SpgSalesCheck",
        entityId: cek.id,
        before: null,
        after: { storeId: toko.id, period: input.periode, checkedAt: sekarang.toISOString() },
        metadata: {
          storeId: toko.id,
          period: input.periode,
          bulanBayar,
          catatan: salesMonthNoteId(input.periode),
          potongToko: hasil.potongToko,
          totalToko: hasil.totalToko,
          potongTanpaTarif: hasil.potongTanpaTarif,
          peserta,
          tanpaKategori,
        },
      });
      return { ok: true, bulanBayar, tanpaKategori };
    });
  } catch (e) {
    // Dua klik bersamaan: basis data menolak tanda dicek kedua (toko × bulan unik).
    if (unik(e)) return { ok: false, code: "SUDAH_DICEK" };
    throw e;
  }
}

/**
 * Batalkan tanda dicek — selama belum ada baris toko × bulan itu yang dibayar. Baris yang sudah
 * ditetapkan ikut dihapus dan SPG-nya dikabari; jejak menyimpan tanda dicek dan setiap baris yang
 * dihapus. Tidak ada potongan beban yang dilepas: beban hanya dipotong saat dibayar.
 */
export async function batalkanTandaDicek(input: { storeId: string; periode: string; olehUserId: string; alasan: unknown }): Promise<HasilBatalCek> {
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
      select: { id: true, userId: true, unitsSold: true, commission: true, deduction: true, baseSalary: true, basis: true, paidAt: true },
    });
    if (baris.some((b) => b.paidAt !== null)) return { ok: false, code: "SUDAH_DIBAYAR" };

    const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { name: true } });
    const bulan = salesMonthLabelId(input.periode);
    for (const b of baris) {
      await tx.spgCommission.delete({ where: { id: b.id } });
      await jejak(tx, {
        userId: input.olehUserId,
        action: JEJAK_KOMISI_SPG.DITETAPKAN_ULANG,
        entityId: b.id,
        before: { unitsSold: b.unitsSold, commission: Number(b.commission), baseSalary: Number(b.baseSalary), basis: b.basis, deduction: Number(b.deduction) },
        after: null,
        metadata: { storeId: input.storeId, period: input.periode, spgUserId: b.userId, dihapus: true, sebab: "BATAL_DICEK" },
        reason: alasan,
      });
      kabar.push({
        userId: b.userId,
        kabar: {
          jenis: JENIS_KABAR.KOMISI_SPG,
          judul: `Gaji & komisi penjualan ${bulan} diperiksa ulang`,
          isi: `${toko?.name ?? "Toko"}: kantor membuka lagi laporan penjualan ${bulan}. Gaji & komisinya ditetapkan lagi sesudah dicek.`,
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

export async function tetapkanKomisiToko(input: { storeId: string; periode: string; olehUserId: string; sekarang?: Date }): Promise<HasilTetapkanKomisi> {
  if (!periodeSah(input.periode)) return { ok: false, code: "PERIODE_TIDAK_SAH" };
  if (!bulanSudahSelesai(input.periode, bulanWib(input.sekarang ?? new Date()))) return { ok: false, code: "BULAN_BELUM_SELESAI" };

  let kabar: KabarTertunda[] = [];
  let pengingat: (AdminNotification | null)[] = [];
  const hasil = await runSerializable(async (tx): Promise<HasilTetapkanKomisi> => {
    // Callback ini bisa diulang: kabar dan pengingat dari percobaan yang gagal tidak boleh ikut terkirim.
    kabar = [];
    pengingat = [];
    const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true, termsType: true } });
    if (!toko) return { ok: false, code: "TOKO_TIDAK_DITEMUKAN" };
    if (toko.termsType !== "PUTUS") return { ok: false, code: "BUKAN_TOKO_PUTUS" };
    const cek = await tx.spgSalesCheck.findUnique({ where: { storeId_period: { storeId: toko.id, period: input.periode } }, select: { checkedAt: true } });
    if (!cek) return { ok: false, code: "LAPORAN_BELUM_DICEK" };

    const ada = await tx.spgCommission.findMany({
      where: { storeId: toko.id, period: input.periode },
      select: { id: true, userId: true, unitsSold: true, commission: true, deduction: true, baseSalary: true, salaryDetail: true, basis: true, paidAt: true },
    });
    const pesertaPer = await muatPesertaGaji(tx, [{ storeId: toko.id, bulan: input.periode }]);
    const peserta = pesertaPer.get(kunciTokoBulan(toko.id, input.periode)) ?? [];
    const { hasil: hitung } = await hitunganPutus(tx, toko.id, input.periode, cek.checkedAt, [...ada.map((b) => b.userId), ...peserta]);
    const ikut = [...new Set([...peserta, ...hitung.perSpg.filter((p) => p.penerima).map((p) => p.userId)])];
    const [gajiPer, diKonsi] = await Promise.all([
      muatGajiPokok(tx, ikut.map((userId) => ({ userId, storeId: toko.id, bulan: input.periode }))),
      gajiDiBarisKonsi(tx, ikut, input.periode),
    ]);
    const gaji = new Map<string, HasilGaji | null>(ikut.map((u) => [u, gajiPer.get(kunciGaji(u, input.periode)) ?? null]));
    const rencana = rencanaTetapkan(hitung, ada.map(keBarisResmi), peserta, gaji, diKonsi);
    if (!rencana.ok) return { ok: false, code: rencana.code };

    const waktu = new Date();
    const bulan = salesMonthLabelId(input.periode);
    const bulanBayar = payoutMonth(cek.checkedAt);
    const labelBayar = salesMonthLabelId(bulanBayar);
    const perSpg = new Map(hitung.perSpg.map((p) => [p.userId, p]));
    let ditahan = 0;
    for (const t of rencana.tulis) {
      const salaryDetail = (t.isi.salaryDetail ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull;
      const isi = {
        unitsSold: t.isi.unitsSold,
        commission: t.isi.commission,
        basis: t.isi.basis,
        baseSalary: t.isi.baseSalary,
        salaryDetail,
        deduction: 0,
        lockedById: input.olehUserId,
        lockedAt: waktu,
      };
      const baris = await tx.spgCommission.upsert({
        where: { userId_storeId_period: { userId: t.userId, storeId: toko.id, period: input.periode } },
        create: { userId: t.userId, storeId: toko.id, period: input.periode, ...isi },
        update: isi,
        select: { id: true },
      });
      const g = gaji.get(t.userId) ?? null;
      const tahan = g && !g.ok ? g.alasan : null;
      if (tahan) ditahan += 1;
      if (g && !g.ok && g.alasan === "CATATAN_HADIR_BELUM_DIMASUKKAN") {
        pengingat.push(await ingatkanCatatanHadirPerlu(tx, { userId: t.userId, storeId: toko.id, bulan: input.periode, hari: g.hari }));
      }
      await jejak(tx, {
        userId: input.olehUserId,
        action: t.sebelum ? JEJAK_KOMISI_SPG.DITETAPKAN_ULANG : JEJAK_KOMISI_SPG.DITETAPKAN,
        entityId: baris.id,
        before: t.sebelum ? { unitsSold: t.sebelum.unitsSold, commission: t.sebelum.commission, basis: t.sebelum.basis, baseSalary: t.sebelum.baseSalary } : null,
        after: { unitsSold: t.isi.unitsSold, commission: t.isi.commission, basis: t.isi.basis, baseSalary: t.isi.baseSalary, gaji: t.isi.salaryDetail },
        metadata: {
          storeId: toko.id,
          period: input.periode,
          spgUserId: t.userId,
          dasar: DASAR_TARIF_KATEGORI,
          bulanBayar,
          catatan: salesMonthNoteId(input.periode),
          potongTanpaTarif: perSpg.get(t.userId)?.potongTanpaTarif ?? 0,
          ditahan: tahan,
        },
      });
      if (!t.sebelum || !samaIsi(t.sebelum, { ...t.isi })) {
        kabar.push({
          userId: t.userId,
          kabar: {
            jenis: JENIS_KABAR.KOMISI_SPG,
            judul: t.sebelum ? `Gaji & komisi penjualan ${bulan} diperbarui` : `Gaji & komisi penjualan ${bulan} ditetapkan`,
            isi: rangkaiDalamBatas([`${toko.name}: ${kalimatKomisi(t.isi.commission, t.isi.baseSalary, tahan)}`, tahan ? null : `Dibayar ${labelBayar} setelah kantor menandainya.`], 191),
            data: { period: input.periode },
          },
        });
      }
    }
    for (const h of rencana.hapus) {
      await tx.spgCommission.delete({ where: { id: h.id } });
      await jejak(tx, {
        userId: input.olehUserId,
        action: JEJAK_KOMISI_SPG.DITETAPKAN_ULANG,
        entityId: h.id,
        before: h.sebelum,
        after: null,
        metadata: { storeId: toko.id, period: input.periode, spgUserId: h.userId, dihapus: true, sebab: "BUKAN_PESERTA" },
      });
    }
    return { ok: true, ulang: ada.length > 0, ditulis: rencana.tulis.length, dihapus: rencana.hapus.length, totalToko: hitung.totalToko, ditahan };
  });

  if (hasil.ok) {
    await kirimKabar(kabar);
    await sebarPengingatCatatan(pengingat);
  }
  return hasil;
}

export async function tandaiKomisiDibayar(input: {
  commissionId: string;
  olehUserId: string;
  catatan?: unknown;
  /** Yang dilihat kantor di layar; tidak diisi = tanpa penjaga (hanya tes). */
  jumlahDiharapkan?: number;
}): Promise<HasilBayarKomisi> {
  const catatan = typeof input.catatan === "string" ? input.catatan.trim() : "";
  if (catatan.length > BATAS_CATATAN) return { ok: false, code: "CATATAN_TERLALU_PANJANG" };

  const pemilik = await prisma.spgCommission.findUnique({ where: { id: input.commissionId }, select: { userId: true } });
  if (!pemilik) return { ok: false, code: "TIDAK_DITEMUKAN" };
  // Laporan lain SPG ini dimuat sebelum transaksi; keadaan baris, tanda dicek, gaji, beban, dan
  // koreksinya dibaca ulang di dalam transaksi.
  const praMuat = (await unitKomisiSpg(prisma, [pemilik.userId])).get(pemilik.userId) ?? [];

  let kabar: KabarTertunda[] = [];
  let notifikasi: AdminNotification[] = [];
  try {
    const hasil = await runSerializable(async (tx): Promise<HasilBayarKomisi> => {
      kabar = [];
      notifikasi = [];
      const b = await tx.spgCommission.findUnique({
        where: { id: input.commissionId },
        select: { id: true, userId: true, storeId: true, period: true, unitsSold: true, commission: true, deduction: true, baseSalary: true, basis: true, paidAt: true },
      });
      if (!b) return { ok: false, code: "TIDAK_DITEMUKAN" };
      if (b.paidAt) return { ok: false, code: "SUDAH_DIBAYAR" };
      const cek = await tx.spgSalesCheck.findUnique({ where: { storeId_period: { storeId: b.storeId, period: b.period } }, select: { checkedAt: true } });
      if (!cek) return { ok: false, code: "LAPORAN_BELUM_DICEK" };

      const [rates, laporan] = await Promise.all([commissionRates(tx), putusReportOf(tx, b.storeId, b.period, cek.checkedAt)]);
      const sendiri = commissionPerSpg(laporan, rates).find((r) => r.salesmanId === b.userId);
      const kunci = putusReportKey(b.storeId, b.period);
      const rencana = await siapkanBayarKomisi(tx, {
        userId: b.userId,
        kunci,
        praMuat,
        angkaSendiri: { komisi: sendiri?.amount ?? 0, potong: sendiri?.pieces ?? 0, potongTanpaTarif: sendiri?.noRatePieces ?? 0 },
        storeId: b.storeId,
        bulanKerja: b.period,
        refType: REF_KOMISI_SPG_PUTUS,
        refId: b.id,
      });
      if (rencana.ditahan) return { ok: false, code: rencana.ditahan, hari: rencana.hariTahan };
      // Sebelum menulis apa pun: yang dibayarkan harus yang dilihat kantor.
      if (input.jumlahDiharapkan !== undefined && !samaRupiah(rencana.dibayar, input.jumlahDiharapkan)) throw new KomisiBerubahError(rencana.dibayar);

      const waktu = new Date();
      const r = await tx.spgCommission.updateMany({
        where: { id: b.id, paidAt: null },
        data: { paidAt: waktu, paidById: input.olehUserId, ...(catatan ? { note: catatan } : {}) },
      });
      if (r.count !== 1) return { ok: false, code: "SUDAH_DIBAYAR" };

      const bulanBayar = payoutMonth(cek.checkedAt);
      const sesudahBayar = await terapkanPembayaran(tx, {
        userId: b.userId,
        rencana,
        bulanBayar,
        olehUserId: input.olehUserId,
        waktu,
        catatan: `${salesMonthNoteId(b.period)} · dibayar`,
      });
      notifikasi = sesudahBayar.notifikasi;

      // Baris ditulis ulang dengan angka yang dibayar: komisi, gaji pokok + rinciannya (beku), dan
      // beban barang hilang yang diambil (`deduction`).
      const salaryDetail = (rencana.gaji ? { jenis: "RINCIAN", rincian: rencana.gaji } : Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull;
      await tx.spgCommission.update({
        where: { id: b.id },
        data: {
          commission: rencana.komisiBaru,
          unitsSold: rencana.potongBaru,
          basis: DASAR_TARIF_KATEGORI,
          baseSalary: rencana.gajiPokok,
          ...(rencana.gaji ? { salaryDetail } : {}),
          deduction: rencana.potonganHilang,
        },
      });
      if (rencana.berubah) {
        await catatHitungUlangSaatBayar(tx, {
          olehUserId: input.olehUserId,
          entityType: REF_KOMISI_SPG_PUTUS,
          entityId: b.id,
          spgUserId: b.userId,
          storeId: b.storeId,
          kunci,
          sebelum: { komisi: Number(b.commission), potong: b.unitsSold, dasar: b.basis, potonganHilang: Number(b.deduction), gajiPokok: Number(b.baseSalary) },
          sesudah: { komisi: rencana.komisiBaru, potong: rencana.potongBaru, dasar: DASAR_TARIF_KATEGORI, potonganHilang: rencana.potonganHilang, gajiPokok: rencana.gajiPokok },
        });
      }

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
          commission: rencana.komisiBaru,
          gajiPokok: rencana.gajiPokok,
          gaji: rencana.gaji,
          potong: rencana.potong,
          dariKomisi: rencana.dariKomisi,
          dariGaji: rencana.dariGaji,
          diubah: rencana.berubah,
          koreksi: sesudahBayar.koreksi.map((k) => ({ id: k.id, sumber: k.sumber, jumlah: k.jumlah, gaji: k.gaji })),
          utang: sesudahBayar.utangBaru,
          akhir: rencana.akhir,
          dibayar: rencana.dibayar,
          bulanBayar,
          catatan: salesMonthNoteId(b.period),
        },
        reason: catatan || null,
      });
      const toko = await tx.store.findUnique({ where: { id: b.storeId }, select: { name: true } });
      const tambahan = [kalimatKoreksiKabar(rencana.koreksi), kalimatPotongKabar(rencana)].filter(Boolean);
      kabar.push({
        userId: b.userId,
        kabar: {
          jenis: JENIS_KABAR.KOMISI_SPG,
          judul: `Gaji & komisi penjualan ${salesMonthLabelId(b.period)} dibayar`,
          // Kolom kabar 191 karakter: kalimat utuh yang muat saja, tidak pernah terpotong di tengah.
          isi: rangkaiDalamBatas(
            [`${toko?.name ?? "Toko"}: diterima ${formatIDR(rencana.dibayar)} (gaji pokok ${formatIDR(rencana.gajiPokok)} + komisi ${formatIDR(rencana.komisiBaru)}).`, ...tambahan],
            191,
          ),
          data: { period: b.period },
        },
      });
      return {
        ok: true,
        storeId: b.storeId,
        periode: b.period,
        diubah: rencana.berubah,
        dibayar: rencana.dibayar,
        koreksi: rencana.jumlahKoreksi,
        utang: sesudahBayar.utangBaru.reduce((n, u) => n + u.jumlah, 0),
      };
    });
    if (hasil.ok) {
      await kirimKabar(kabar);
      await sebarPengingatCatatan(notifikasi);
    }
    return hasil;
  } catch (e) {
    if (e instanceof KomisiBerubahError) return { ok: false, code: "ANGKA_BERUBAH", jumlah: e.jumlah };
    throw e;
  }
}
