import { prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatDisplayDate } from "@/lib/date-only";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { adaKegiatan, awalHari, jumlahkanMetrik, kalimatRingkasan, kalimatRingkasanTim, sahKunciHari } from "./metrik-lapangan";
import { kinerjaSemuaSales } from "./metrik-queries";

/**
 * Ringkasan harian otomatis (dijadwalkan 18.30 WIB): setiap sales yang
 * berkegiatan hari itu mendapat satu kabar berisi angkanya sendiri, dan atasan
 * mendapat SATU ringkasan tim di lonceng backoffice.
 *
 * PALING BANYAK SEKALI per tanggal. Baris `AdminNotification` ringkasan tim
 * adalah penandanya dan ditulis SEBELUM kabar ke sales dikirim: kalau proses
 * mati di tengah jalan, sebagian sales tidak menerima kabar hari itu — angkanya
 * tetap terbaca di layar "Hari ini" — tapi tidak ada yang menerima dua kali.
 * Kabar ganda lebih merusak daripada kabar yang hilang: sales berhenti membaca
 * kabar yang sering berulang.
 */

export const KATEGORI_RINGKASAN_SALES = "RINGKASAN_SALES_HARIAN";

export type HasilRingkasanHarian =
  | { status: "SUDAH_TERKIRIM"; tanggal: string; adminNotificationId: string }
  | { status: "SEPI"; tanggal: string }
  | { status: "TERKIRIM"; tanggal: string; adminNotificationId: string; salesDikabari: string[] };

/**
 * Penanda ringkasan tanggal ini, bila sudah ada. Dicocokkan di memori, bukan
 * lewat penyaring JSON di basis data (tidak andal di adaptor MariaDB); baris
 * yang dibaca hanya kategori ini yang ditulis sejak tanggal itu — satu per hari.
 */
async function penandaTanggal(tanggal: string): Promise<string | null> {
  const rows = await prisma.adminNotification.findMany({
    where: { category: KATEGORI_RINGKASAN_SALES, createdAt: { gte: awalHari(tanggal) } },
    select: { id: true, metadata: true },
  });
  const ada = rows.find((r) => {
    const m = r.metadata;
    return m !== null && typeof m === "object" && !Array.isArray(m) && (m as Record<string, unknown>).tanggal === tanggal;
  });
  return ada?.id ?? null;
}

/**
 * @param tanggal hari WIB (`YYYY-MM-DD`, atau instan yang dibaca sebagai hari WIB-nya).
 * @param opsi.salesmanIds batasi ke sales ini (tes) — tanpa ini semua sales.
 */
export async function kirimRingkasanHarian(
  tanggal: string | Date,
  opsi: { salesmanIds?: string[]; sekarang?: Date } = {},
): Promise<HasilRingkasanHarian> {
  const hari = typeof tanggal === "string" ? tanggal : kunciHariWib(tanggal);
  if (!sahKunciHari(hari)) throw new Error(`kirimRingkasanHarian: tanggal tidak sah: ${String(tanggal)}`);

  const sudah = await penandaTanggal(hari);
  if (sudah) return { status: "SUDAH_TERKIRIM", tanggal: hari, adminNotificationId: sudah };

  const tim = await kinerjaSemuaSales(
    { dari: hari, sampai: hari },
    { sekarang: opsi.sekarang, salesmanIds: opsi.salesmanIds, denganRencana: false },
  );
  const aktif = tim.baris.filter((b) => adaKegiatan(b.metrik));
  // Hari tanpa kegiatan (Minggu, libur) tidak menulis apa pun: lonceng yang
  // setiap Minggu berbunyi "0 kunjungan" cepat diabaikan.
  if (aktif.length === 0) return { status: "SEPI", tanggal: hari };

  const total = jumlahkanMetrik(aktif.map((b) => b.metrik));
  const label = formatDisplayDate(awalHari(hari));
  const penanda = await prisma.adminNotification.create({
    data: {
      category: KATEGORI_RINGKASAN_SALES,
      severity: "INFO",
      title: `Ringkasan sales lapangan ${label}`,
      message: kalimatRingkasanTim(total, aktif.length),
      metadata: {
        tanggal: hari,
        href: `/backoffice/sales-lapangan?rentang=kustom&dari=${hari}&sampai=${hari}`,
        salesAktif: aktif.length,
        kunjungan: total.kunjungan,
        persenEfektif: total.persenEfektif,
        pesanan: total.pesanan.jumlah,
        nilaiPutus: total.pesanan.nilaiPutus,
        pelunasan: total.pelunasan.dilaporkan,
        janggal: total.janggal,
      },
    },
  });

  for (const b of aktif) {
    // Berurutan dan di-await: fungsi ini berjalan di cron, tidak ada pengguna
    // yang menunggu, dan `kabariPengguna` tidak pernah melempar.
    await kabariPengguna(b.salesmanId, {
      jenis: JENIS_KABAR.RINGKASAN_HARIAN,
      judul: `Ringkasan kerja ${label}`,
      isi: kalimatRingkasan(b.metrik),
      data: { tanggal: hari },
    });
  }
  void fanOutAdminNotification(penanda);

  return {
    status: "TERKIRIM",
    tanggal: hari,
    adminNotificationId: penanda.id,
    salesDikabari: aktif.map((b) => b.salesmanId),
  };
}
