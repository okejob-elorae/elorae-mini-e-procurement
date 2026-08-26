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

/**
 * Membaca arsip nota retur.
 *
 * Halaman arsip TIDAK BERPAGAR sama sekali sebelum ini: siapa pun yang bisa
 * masuk melihat setiap nota retur setiap toko, lengkap dengan fotonya. Itu
 * dokumen keuangan milik toko dan sales, bukan sesuatu yang terbuka bagi
 * seluruh isi kantor hanya karena mereka punya akun.
 */
export function bolehMembacaArsip(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.RECEIVABLES_VIEW);
}

/**
 * Membuka siklus konsinyasi.
 *
 * Terpisah dari `receivables:*` dengan sengaja. Brief menyebut dua peran —
 * Admin Penjualan dan Admin Pajak — yang pekerjaannya HANYA konsinyasi, dan
 * yang secara tegas tidak boleh membuka lampiran di luarnya. Kalau konsinyasi
 * memakai izin piutang, memberi mereka pekerjaannya berarti sekalian memberi
 * seluruh arsip retur.
 */
export function bolehMembukaKonsi(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.CONSIGNMENT_VIEW);
}

/**
 * Menjalankan siklus konsinyasi: kunci angka, bayar komisi, catat nomor faktur.
 *
 * SATU izin, bukan "ini ATAU yang mengelola piutang". Sempat saya tulis begitu
 * supaya orang yang sudah bekerja hari ini tidak terkunci — tapi menu sampingnya
 * hanya bisa menguji SATU izin, jadi hasilnya pintu terbuka dengan menu yang
 * tidak menampilkannya: orang yang berhak tidak akan pernah menemukannya.
 *
 * Yang benar adalah seed memberi `consignment:*` kepada setiap peran yang sudah
 * memegang `receivables:manage` — lihat `seed-consignment-permissions.sql`.
 * Dengan begitu pagar halaman dan menu menguji hal yang persis sama.
 */
export function bolehMengelolaKonsi(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.CONSIGNMENT_MANAGE);
}
