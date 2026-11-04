/**
 * ER dan rata-rata views di tingkat KOL (`Kol.engagementRate` / `Kol.avgViews`) MENGIKUTI angka terukur
 * akun TikTok utamanya (pemantauan ekstensi) selama tidak ada yang mengetik angka lain — pemilik
 * 2026-10-09: "kenapa ER, rata-rata views … tidak bisa diisi otomatis, padahal di extension sudah ada
 * datanya". Murni dan aman untuk klien (formulir KOL memakainya untuk keterangan di bawah isian).
 *
 * "Mengetik angka lain" dibaca dari datanya sendiri, tanpa kolom penanda: angka KOL yang KOSONG, atau
 * SAMA dengan angka terukur sebelum pembaruan ini, berarti belum pernah ditimpa tangan, jadi ikut angka
 * baru. Angka yang berbeda dibiarkan — itu ketikan pemilik (mis. ER dari Instagram). Mengosongkan isian
 * di formulir membuatnya mengikuti lagi pada pembacaan berikutnya.
 */

/** ER disimpan 2 desimal (Decimal(6,2)) di kedua tempat; selisih di bawah ini dianggap sama. */
export const TOLERANSI_ER = 0.005;

/** Nilai baru untuk angka KOL, atau `null` bila angka KOL tidak boleh disentuh (diketik tangan / tidak berubah). */
export function ikutiTerukur(
  nilaiKol: number | null,
  terukurLama: number | null,
  terukurBaru: number | null,
  toleransi = 0,
): number | null {
  if (terukurBaru === null) return null;
  const mengikuti = nilaiKol === null || samaDenganTerukur(nilaiKol, terukurLama, toleransi);
  if (!mengikuti) return null;
  return nilaiKol !== null && Math.abs(nilaiKol - terukurBaru) <= toleransi ? null : terukurBaru;
}

export function samaDenganTerukur(nilai: number | null, terukur: number | null, toleransi = 0): boolean {
  return nilai !== null && terukur !== null && Math.abs(nilai - terukur) <= toleransi;
}

/** Akun utama sebuah KOL di satu platform: pengikut terbanyak, seri → id terkecil (stabil). */
export function akunUtama<T extends { id: string; followers: number }>(akun: readonly T[]): T | null {
  let utama: T | null = null;
  for (const a of akun) {
    if (!utama || a.followers > utama.followers || (a.followers === utama.followers && a.id < utama.id)) utama = a;
  }
  return utama;
}
