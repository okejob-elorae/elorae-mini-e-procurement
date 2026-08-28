/**
 * Aturan creative marketing — murni, tanpa menyentuh basis data.
 *
 * Dua di antaranya soal uang dan stok, dan keduanya bentuknya sama: YANG
 * DIJANJIKAN BUKAN YANG TERJADI. Brief yang dikirim belum tentu tayang; barang
 * yang direncanakan dikirim belum tentu berangkat. Mencampur keduanya membuat
 * anggaran marketing terbaca lebih besar daripada yang benar-benar keluar, dan
 * stok terbaca lebih kecil daripada yang benar-benar ada.
 */

export type StatusBrief =
  | 'DRAFT'
  | 'DIKIRIM'
  | 'DISETUJUI'
  | 'KONTEN_DITERIMA'
  | 'TAYANG'
  | 'SELESAI'
  | 'BATAL';

export type StatusKonten = 'IDE' | 'DRAFT' | 'REVIEW' | 'DIJADWALKAN' | 'TAYANG' | 'BATAL';

export type Platform = 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'LAINNYA';

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
 * Sudah bolehkah fee brief ini dihitung sebagai beban?
 *
 * ATURAN 1: brief terkirim BUKAN beban. Fee diakui saat kontennya benar-benar
 * TAYANG. Bentuknya persis "klaim bukan lunas" di modul piutang — sebelum ada
 * bukti bahwa yang dijanjikan terjadi, angkanya nol.
 *
 * `SELESAI` ikut diakui karena ia hanya bisa dicapai lewat `TAYANG`.
 */
export function bebanDiakui(status: StatusBrief): boolean {
  return status === 'TAYANG' || status === 'SELESAI';
}

/** Nilai fee yang boleh masuk laporan biaya. Nol selama belum tayang. */
export function nilaiBebanDiakui(status: StatusBrief, fee: number): number {
  return bebanDiakui(status) ? fee : 0;
}

/**
 * Apakah perpindahan ini yang MENGELUARKAN stok?
 *
 * ATURAN 2: stok bergerak tepat saat brief DIKIRIM, bukan saat dibuat. Draft
 * masih boleh berubah isinya; stok tidak boleh bergerak karena rencana yang
 * belum tentu jadi.
 *
 * Ditanyakan pada PERPINDAHANNYA, bukan pada statusnya. Sempat saya tulis
 * sebagai `stokSudahKeluar(status)` dan itu salah: brief `BATAL` menjawab
 * "belum keluar", padahal brief yang dibatalkan SETELAH dikirim barangnya sudah
 * ada di tangan KOL. Yang benar-benar terjadi disimpan sebagai
 * `KolBrief.stockIssuedAt` — dicatat, bukan disimpulkan.
 */
export function stokKeluarSaat(dari: StatusBrief, ke: StatusBrief): boolean {
  return dari === 'DRAFT' && ke === 'DIKIRIM';
}

/**
 * Apakah barangnya bisa ditarik kembali saat brief dibatalkan.
 *
 * TIDAK PERNAH. Begitu paket berangkat ke KOL, barangnya hilang dari gudang
 * apa pun yang terjadi pada briefnya — pembatalan adalah keputusan di atas
 * kertas, bukan kurir yang berbalik arah. Mengembalikan stoknya akan membuat
 * gudang mengaku punya barang yang tidak ada.
 *
 * Ada sebagai fungsi bernama, bukan sekadar tidak ditulis, karena "kenapa
 * pembatalan tidak mengembalikan stok" adalah pertanyaan yang pasti muncul.
 */
export function stokKembaliSaatBatal(): false {
  return false;
}

/**
 * Perpindahan status brief yang diizinkan.
 *
 * Ditulis sebagai peta, bukan rantai `if`, supaya seluruh jalannya terlihat
 * sekaligus — termasuk yang TIDAK ada: dari `SELESAI` tidak ke mana-mana, dan
 * `BATAL` tidak bisa dihidupkan lagi. Menghidupkan brief yang dibatalkan berarti
 * stoknya harus dikeluarkan ulang, dan tidak ada yang mengingatkan.
 */
const JALAN_BRIEF: Record<StatusBrief, StatusBrief[]> = {
  DRAFT: ['DIKIRIM', 'BATAL'],
  DIKIRIM: ['DISETUJUI', 'BATAL'],
  DISETUJUI: ['KONTEN_DITERIMA', 'BATAL'],
  KONTEN_DITERIMA: ['TAYANG', 'BATAL'],
  TAYANG: ['SELESAI'],
  SELESAI: [],
  BATAL: [],
};

export function bolehPindahBrief(dari: StatusBrief, ke: StatusBrief): boolean {
  return JALAN_BRIEF[dari].includes(ke);
}

/** Langkah berikutnya yang wajar dari sebuah status — untuk tombol di layar. */
export function langkahBerikutBrief(dari: StatusBrief): StatusBrief[] {
  return JALAN_BRIEF[dari];
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
