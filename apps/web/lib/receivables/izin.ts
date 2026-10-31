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

/*
 * Membaca halaman kantor modul ini.
 *
 * Rute modul piutang SENGAJA tidak dipetakan di ROUTE_PERMISSIONS: peta itu
 * hanya bisa menguji satu izin, padahal pembaca sahnya lintas tugas (keuangan
 * membuka BKM yang ia verifikasi, gudang membuka nota retur yang ia hitung).
 * Akibatnya proxy meloloskan rutenya, dan setiap halaman — juga aksi cetaknya —
 * WAJIB memagari dirinya sendiri dengan salah satu fungsi di bawah, SEBELUM
 * membaca data. Sebelum pagar ini, salesman, SPG, dan orang produksi membuka
 * piutang seluruh toko cukup dengan mengetik alamatnya.
 *
 * Melapor (`bolehMelapor`) tidak termasuk: sales melaporkan apa yang ia
 * saksikan di tokonya, bukan membaca buku piutang seluruh perusahaan.
 */

/**
 * Piutang, kontrabon, beban selisih, dasbor pelunasan, cetak faktur.
 *
 * Orang piutang saja — izin yang sama dengan menu sampingnya, ditambah yang
 * mengelola (tidak masuk akal boleh mengelola tetapi tidak boleh membaca).
 */
export function bolehMembacaPiutang(izin: string[] | undefined): boolean {
  return bolehMembacaArsip(izin) || bolehMengelola(izin);
}

/**
 * BKM: daftar, rincian, cetak.
 *
 * Ditambah keuangan (`journals:manage`): BKM yang menunggu verifikasi dan
 * permintaan koreksinya dikabarkan ke keuangan, dan tautannya menuju rincian
 * BKM. Tanpa ini yang harus memverifikasi justru tidak bisa membukanya.
 */
export function bolehMembacaPelunasan(izin: string[] | undefined): boolean {
  return bolehMembacaPiutang(izin) || bolehMemverifikasi(izin);
}

/**
 * Nota retur toko: daftar kerja, rincian, cetak.
 *
 * Ditambah gudang (`inventory_opname:count`) yang menghitung fisiknya, dan
 * keuangan yang memverifikasi: potongan retur di rincian BKM menaut ke nota ini,
 * dan nilai tertahannya hanya bisa dipahami dari sana.
 */
export function bolehMembacaRetur(izin: string[] | undefined): boolean {
  return bolehMembacaPiutang(izin) || bolehMenghitung(izin) || bolehMemverifikasi(izin);
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
