import { hasPermission, PERMISSIONS } from '@/lib/rbac';

/**
 * Siapa boleh apa di modul piutang.
 *
 * Dipisah jadi fungsi bernama karena pembagiannya bukan soal senioritas
 * melainkan soal PEMISAHAN TUGAS — dan pemisahan itulah yang membuat kedua
 * aturan uangnya berarti.
 */

/**
 * Melaporkan pelunasan dan memotret nota retur.
 *
 * Ini pekerjaan sales di lapangan, jadi `pwa:access` cukup. Sempat saya kunci
 * ke `receivables:manage` — yang berarti orang yang seharusnya melapor tidak
 * bisa melapor, dan admin kantor mengetikkan laporan yang tidak ia saksikan.
 */
export function bolehMelapor(izin: string[] | undefined): boolean {
  const p = izin ?? [];
  return hasPermission(p, PERMISSIONS.RECEIVABLES_MANAGE) || p.includes('pwa:access');
}

/**
 * Memverifikasi klaim ke mutasi rekening.
 *
 * Keuangan, dan HANYA keuangan. Kalau pelapor bisa mengesahkan laporannya
 * sendiri, seluruh Aturan 1 runtuh.
 */
export function bolehMemverifikasi(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.JOURNALS_MANAGE);
}

/** Menghitung fisik barang retur — gudang, bukan yang mengklaim. */
export function bolehMenghitung(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT);
}

/** Menetapkan beban, menjodohkan, membatalkan — keputusan penagihan. */
export function bolehMengelola(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.RECEIVABLES_MANAGE);
}
