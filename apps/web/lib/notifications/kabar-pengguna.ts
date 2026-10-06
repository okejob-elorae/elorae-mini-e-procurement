import { prisma } from "@elorae/db";
import { sendNotificationToUsers } from "./recipients";

/**
 * Kabar ke SATU orang tertentu — salesman yang pesanannya disetujui, yang
 * laporan pelunasannya ditolak, dan seterusnya. Pasangan `fanOutAdminNotification`
 * yang mengirim ke semua pemegang izin.
 *
 * Tersimpan di `NotificationQueue` (dibaca layar Kabar di aplikasi HP dan
 * lonceng backoffice), dan dikirim sebagai push kalau orang itu punya token FCM.
 *
 * SELALU dipanggil SESUDAH transaksinya selesai, dan tidak pernah melempar:
 * kabar yang gagal terkirim tidak boleh membatalkan persetujuan pesanan atau
 * verifikasi uang. Keadaan sebenarnya tetap terbaca di layar masing-masing.
 */

export const JENIS_KABAR = {
  PESANAN_DISETUJUI: "PESANAN_DISETUJUI",
  PESANAN_DITOLAK: "PESANAN_DITOLAK",
  PESANAN_DIKIRIM: "PESANAN_DIKIRIM",
  PESANAN_DITUTUP: "PESANAN_DITUTUP",
  PESANAN_PORTAL: "PESANAN_PORTAL",
  PELUNASAN_TERVERIFIKASI: "PELUNASAN_TERVERIFIKASI",
  PELUNASAN_DITOLAK: "PELUNASAN_DITOLAK",
  PELUNASAN_DIBATALKAN: "PELUNASAN_DIBATALKAN",
  RETUR_DIHITUNG: "RETUR_DIHITUNG",
  RETUR_DIBEBANKAN: "RETUR_DIBEBANKAN",
  /** Kantor memindahkan nota retur sales ke toko lain (sales salah pilih toko). */
  RETUR_DIPINDAH_TOKO: "RETUR_DIPINDAH_TOKO",
  /** Kantor membatalkan nota retur yang dicatat sales. */
  RETUR_DIBATALKAN: "RETUR_DIBATALKAN",
  PERUBAHAN_TOKO_DISETUJUI: "PERUBAHAN_TOKO_DISETUJUI",
  PERUBAHAN_TOKO_DITOLAK: "PERUBAHAN_TOKO_DITOLAK",
  TOKO_BARU_DISETUJUI: "TOKO_BARU_DISETUJUI",
  TOKO_BARU_DITOLAK: "TOKO_BARU_DITOLAK",
  KONTRABON_DIKONFIRMASI: "KONTRABON_DIKONFIRMASI",
  KONTRABON_DIBATALKAN: "KONTRABON_DIBATALKAN",
  GIRO_CAIR: "GIRO_CAIR",
  GIRO_DITOLAK: "GIRO_DITOLAK",
  BIAYA_DISETUJUI: "BIAYA_DISETUJUI",
  BIAYA_DITOLAK: "BIAYA_DITOLAK",
  BIAYA_DIBAYAR: "BIAYA_DIBAYAR",
  RINGKASAN_HARIAN: "RINGKASAN_HARIAN",
  TUKAR_DISETUJUI: "TUKAR_DISETUJUI",
  TUKAR_DITOLAK: "TUKAR_DITOLAK",
  TUKAR_SELESAI: "TUKAR_SELESAI",
  TUKAR_DIBATALKAN: "TUKAR_DIBATALKAN",
  TUGAS_TAGIH_BARU: "TUGAS_TAGIH_BARU",
  JADWAL_KUNJUNGAN: "JADWAL_KUNJUNGAN",
  PENGUMUMAN: "PENGUMUMAN",
  IZIN_DISETUJUI: "IZIN_DISETUJUI",
  IZIN_DITOLAK: "IZIN_DITOLAK",
  IZIN_DIBATALKAN: "IZIN_DIBATALKAN",
  /** Mutasi antar toko: ke pembuat (disetujui/ditolak/diterima/dibatalkan) dan ke SPG toko tujuan (masuk). */
  MUTASI_DISETUJUI: "MUTASI_DISETUJUI",
  MUTASI_DITOLAK: "MUTASI_DITOLAK",
  MUTASI_MASUK: "MUTASI_MASUK",
  MUTASI_DITERIMA: "MUTASI_DITERIMA",
  MUTASI_DIBATALKAN: "MUTASI_DIBATALKAN",
  /** Kantor memproses atau menolak permintaan kiriman SPG. */
  PERMINTAAN_STOK_DIPROSES: "PERMINTAAN_STOK_DIPROSES",
  /** Ada kiriman yang menunggu dihitung dan dikonfirmasi SPG di tokonya. */
  KIRIMAN_MENUNGGU: "KIRIMAN_MENUNGGU",
  /** SPG meminta barang → salesman pemegang tokonya. */
  PERMINTAAN_SPG_MASUK: "PERMINTAAN_SPG_MASUK",
  /** Salesman merekomendasikan barang → SPG toko itu. */
  REKOMENDASI_MASUK: "REKOMENDASI_MASUK",
  /** SPG menerima/menolak rekomendasi → salesman pengirimnya. */
  REKOMENDASI_DIJAWAB: "REKOMENDASI_DIJAWAB",
  /** Barang yang dititip-pesankan pembeli sudah ada di toko → SPG toko itu ({ requestId }). */
  TITIP_PESAN_TERSEDIA: "TITIP_PESAN_TERSEDIA",
  /** Kantor menyusun/mengubah jadwal kerja SPG → SPG itu ({ day } hari pertama yang berubah). */
  JADWAL_SPG: "JADWAL_SPG",
  /** Rekan meminta tukar shift → SPG yang diminta ({ swapId }). */
  TUKAR_SHIFT_DIMINTA: "TUKAR_SHIFT_DIMINTA",
  /** Tukar shift disetujui/ditolak rekan atau kantor → pengaju ({ swapId }). */
  TUKAR_SHIFT_DIPUTUSKAN: "TUKAR_SHIFT_DIPUTUSKAN",
  /** Komisi SPG toko putus ditetapkan atau dibayar kantor → SPG itu ({ period }). */
  KOMISI_SPG: "KOMISI_SPG",
  /** Kantor memutuskan barang rusak dari kiriman → SPG yang mencatatnya ({ receiptId }). */
  KIRIMAN_RUSAK_DIPUTUSKAN: "KIRIMAN_RUSAK_DIPUTUSKAN",
  /** Malam hari: toko SPG ini sudah berjualan tapi belum mengirim laporan tutup hari ({ day }). */
  TUTUP_HARI_PENGINGAT: "TUTUP_HARI_PENGINGAT",
  /** Kantor menetapkan bagian beban barang hilang kepada orang ini (SPG/sales) ({ lossId }). */
  BEBAN_HILANG_DITETAPKAN: "BEBAN_HILANG_DITETAPKAN",
  /**
   * Barang benar-benar berangkat ke toko (pengiriman putus dicatat, pesanan konsi disetujui,
   * titipan konsinyasi dikirim) → setiap SPG toko itu ({ storeId, sourceType, sourceId }).
   */
  KIRIMAN_BERANGKAT: "KIRIMAN_BERANGKAT",
  /**
   * SPG menerima kiriman KURANG atau dengan barang RUSAK → salesman pengirimnya: salesman
   * pesanan (putus/konsi), atau pemegang toko untuk titipan ({ orderId?, storeId, sourceType, sourceId }).
   */
  KIRIMAN_DITERIMA_SELISIH: "KIRIMAN_DITERIMA_SELISIH",
} as const;

export type JenisKabar = (typeof JENIS_KABAR)[keyof typeof JENIS_KABAR];

export type Kabar = {
  jenis: JenisKabar;
  judul: string;
  isi: string;
  /** Id yang dibutuhkan layar Kabar untuk menautkan ke halamannya (nilai string). */
  data: Record<string, string>;
};

export async function kabariPengguna(userId: string | null | undefined, kabar: Kabar): Promise<void> {
  if (!userId) return;
  // Tes berjalan di basis data bersama: tanpa penjaga ini setiap spec yang
  // memanggil penulis menulis baris NotificationQueue dan bisa mengirim push ke
  // HP sungguhan. Sama dengan penjaga di `fanOutAdminNotification`. Spec yang
  // menguji kabar memalsukan modul ini, jadi tidak terpengaruh.
  if (process.env.VITEST) return;
  try {
    const pengguna = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fcmToken: true } });
    if (!pengguna) return;
    await sendNotificationToUsers([pengguna], { type: kabar.jenis, title: kabar.judul, body: kabar.isi, data: kabar.data });
  } catch (err) {
    console.error("kabariPengguna gagal", kabar.jenis, userId, err);
  }
}
