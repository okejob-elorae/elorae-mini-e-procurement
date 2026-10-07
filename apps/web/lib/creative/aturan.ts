/**
 * Aturan creative marketing — murni, tanpa menyentuh basis data.
 *
 * Dua di antaranya soal uang dan stok, dan keduanya bentuknya sama: YANG
 * DIJANJIKAN BUKAN YANG TERJADI. Kolaborasi yang disepakati belum tentu tayang;
 * sampel yang direncanakan belum tentu berangkat. Mencampur keduanya membuat
 * anggaran marketing terbaca lebih besar daripada yang benar-benar keluar, dan
 * stok terbaca lebih kecil daripada yang benar-benar ada.
 *
 * Tahap kolaborasi (13 tahap + 3 jalur keluar) ada di `tahap.ts`; berkas ini
 * menyimpan tier, aturan beban/stok yang dibaca lintas layar, dan aturan
 * rencana konten (grid feed).
 */

import { feeDiakui, type Tahap } from './tahap';

export type StatusKonten = 'IDE' | 'DRAFT' | 'REVIEW' | 'DIJADWALKAN' | 'TAYANG' | 'BATAL';

export type Platform = 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'SHOPEE' | 'LAINNYA';

/** Urutan tampil platform. */
export const SEMUA_PLATFORM: readonly Platform[] = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'SHOPEE', 'LAINNYA'];

/** Label platform untuk teks buatan mesin (pesan WA, rekap). Layar memakai i18n `creative.platform*`. */
export const LABEL_PLATFORM: Record<Platform, string> = {
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  SHOPEE: 'Shopee',
  LAINNYA: 'Lainnya',
};

export type Tier = 'nano' | 'mikro' | 'makro' | 'mega';

/**
 * Tier seorang KOL, DIHITUNG dari pengikut terbanyak di antara akun-akunnya.
 *
 * Tidak disimpan. Tier yang diketik akan basi begitu pengikutnya bertambah dan
 * tidak ada yang memperbaruinya — pola yang sama dengan sisa piutang dan stok
 * titipan di modul sebelah: dihitung ulang dari sumbernya, tidak pernah diketik.
 *
 * Ambangnya mengikuti kebiasaan pasar Indonesia. Kalau nanti berubah, ia berubah
 * di SATU tempat dan seluruh layar ikut.
 */
export function tierKol(pengikut: number[]): Tier {
  const puncak = pengikut.length ? Math.max(...pengikut) : 0;
  if (puncak >= 1_000_000) return 'mega';
  if (puncak >= 100_000) return 'makro';
  if (puncak >= 10_000) return 'mikro';
  return 'nano';
}

/**
 * Sudah bolehkah fee kolaborasi ini dihitung sebagai beban?
 *
 * ATURAN 1: kolaborasi yang disepakati BUKAN beban. Fee diakui saat kontennya
 * benar-benar TAYANG (lalu ANGKA_MASUK, DIBAYAR, SELESAI). Bentuknya persis
 * "klaim bukan lunas" di modul piutang — sebelum ada bukti bahwa yang
 * dijanjikan terjadi, angkanya nol.
 */
export function bebanDiakui(tahap: Tahap): boolean {
  return feeDiakui(tahap);
}

/** Nilai fee yang boleh masuk laporan biaya. Nol selama belum tayang. */
export function nilaiBebanDiakui(tahap: Tahap, fee: number): number {
  return bebanDiakui(tahap) ? fee : 0;
}

/**
 * Sudah berangkatkah sebuah pengiriman sampel?
 *
 * ATURAN 2: stok keluar TEPAT SEKALI, saat pengiriman berangkat — tanggal
 * kirim DAN nomor resi terisi — bukan saat kolaborasi disepakati atau saat
 * sampelnya direncanakan. Yang benar-benar terjadi dicatat di
 * `KolShipment.stockIssuedAt`, tidak disimpulkan dari tahap.
 */
export function pengirimanBerangkat(p: { sentAt: Date | string | null; trackingNo: string | null }): boolean {
  return p.sentAt !== null && Boolean(p.trackingNo?.trim());
}

/** Perlukah stok dikeluarkan sekarang untuk pengiriman ini? Sekali saja per pengiriman. */
export function stokPerluKeluar(p: {
  sentAt: Date | string | null;
  trackingNo: string | null;
  stockIssuedAt: Date | string | null;
}): boolean {
  return pengirimanBerangkat(p) && p.stockIssuedAt === null;
}

/**
 * Apakah barangnya bisa ditarik kembali saat kolaborasi dibatalkan.
 *
 * TIDAK PERNAH. Begitu paket berangkat ke KOL, barangnya hilang dari gudang
 * apa pun yang terjadi pada kolaborasinya — pembatalan adalah keputusan di
 * atas kertas, bukan kurir yang berbalik arah. Mengembalikan stoknya akan
 * membuat gudang mengaku punya barang yang tidak ada.
 *
 * Ada sebagai fungsi bernama, bukan sekadar tidak ditulis, karena "kenapa
 * pembatalan tidak mengembalikan stok" adalah pertanyaan yang pasti muncul.
 */
export function stokKembaliSaatBatal(): false {
  return false;
}

const JALAN_KONTEN: Record<StatusKonten, StatusKonten[]> = {
  IDE: ['DRAFT', 'BATAL'],
  DRAFT: ['REVIEW', 'BATAL'],
  REVIEW: ['DIJADWALKAN', 'DRAFT', 'BATAL'],
  DIJADWALKAN: ['TAYANG', 'REVIEW', 'BATAL'],
  TAYANG: [],
  BATAL: ['IDE'],
};

export function bolehPindahKonten(dari: StatusKonten, ke: StatusKonten): boolean {
  return JALAN_KONTEN[dari].includes(ke);
}

export function langkahBerikutKonten(dari: StatusKonten): StatusKonten[] {
  return JALAN_KONTEN[dari];
}

/**
 * Apakah sebuah konten terlambat dari jadwalnya.
 *
 * Yang sudah tayang atau batal TIDAK PERNAH terlambat — tanggalnya sudah lewat,
 * tapi pekerjaannya selesai. Menandainya merah membuat daftar penuh peringatan
 * yang tidak menuntut apa pun, dan orang berhenti melihat peringatan.
 */
export function kontenTerlambat(
  status: StatusKonten,
  jadwal: Date | null,
  sekarang: Date,
): boolean {
  if (status === 'TAYANG' || status === 'BATAL') return false;
  return jadwal !== null && jadwal < sekarang;
}
