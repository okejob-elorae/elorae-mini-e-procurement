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
 * Memverifikasi klaim ke mutasi rekening — juga menandai giro cair/ditolak,
 * membatalkan BKM atau menautkan ulang potongannya, dan mencatat pembayaran
 * toko konsinyasi (uang yang sudah terlihat di rekening).
 *
 * Izinnya sendiri, `payments:verify` ("periksa pembayaran", keputusan pemilik
 * 2026-10-29): admin dan orang keuangan. Dulu menumpang `journals:manage`,
 * sehingga memberi seseorang pekerjaan jurnal berarti sekalian memberi hak
 * mengesahkan uang masuk. Kalau pelapor bisa mengesahkan laporannya sendiri,
 * seluruh Aturan 1 runtuh — penulisnya tetap menolak pemeriksa yang sama
 * dengan pelapor atau pencatatnya (`PEMERIKSA_SAMA`), termasuk admin.
 */
export function bolehMemverifikasi(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.PAYMENTS_VERIFY);
}

/** Menghitung fisik barang retur — gudang, bukan yang mengklaim. */
export function bolehMenghitung(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT);
}

/** Menjodohkan, membatalkan, mengimpor, menugaskan — pekerjaan penagihan. */
export function bolehMengelola(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.RECEIVABLES_MANAGE);
}

/**
 * Memutuskan siapa menanggung BARANG HILANG — di toko ber-SPG (hitungan toko)
 * maupun di perjalanan, termasuk hasil klaim ekspedisinya: putuskan, ubah
 * keputusan, dan membatalkan catatan yang sudah diputuskan (pembatalan menghapus
 * bagian penanggungnya, jadi itu juga keputusan).
 *
 * Selisih retur toko TIDAK lagi di sini (P22): keputusannya punya izin sendiri,
 * `store_returns:decide_shortfall` (`bolehMemutuskanSelisihRetur`, paket selisih
 * retur sales). Setiap peran yang memegang izin ini mendapat izin itu sekali.
 *
 * Keputusan manager, jadi izinnya terpisah dari `receivables:manage`
 * (keputusan pemilik 2026-11-01): bawaannya hanya admin, dan pemilik boleh
 * memberikannya ke peran lain di Peran & izin. Orang yang mengelola piutang
 * tetap mencatat dan menjodohkan, tapi tidak lagi memutuskan bebannya.
 */
export function bolehMemutuskanBeban(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.RECEIVABLES_DECIDE_BEARER);
}

/**
 * Memutuskan siapa menanggung SELISIH RETUR toko — sales pemegang toko, toko,
 * atau perusahaan — dan mengalihkannya (P22, P84). Izinnya sendiri,
 * `store_returns:decide_shortfall`; bawaannya hanya admin.
 */
export function bolehMemutuskanSelisihRetur(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.STORE_RETURNS_DECIDE_SHORTFALL);
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
 * Ditambah pemeriksa pembayaran (`payments:verify`): BKM yang menunggu
 * verifikasi dan permintaan koreksinya dikabarkan ke keuangan, dan tautannya
 * menuju rincian BKM. Tanpa ini yang harus memverifikasi justru tidak bisa
 * membukanya.
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
 * Menjalankan siklus konsinyasi: membuka siklus, mencatat kiriman titipan dan
 * laporan SPG/toko.
 *
 * SATU izin, bukan "ini ATAU yang mengelola piutang". Sempat saya tulis begitu
 * supaya orang yang sudah bekerja hari ini tidak terkunci — tapi menu sampingnya
 * hanya bisa menguji SATU izin, jadi hasilnya pintu terbuka dengan menu yang
 * tidak menampilkannya: orang yang berhak tidak akan pernah menemukannya.
 *
 * Yang benar adalah seed memberi `consignment:view`/`consignment:manage` kepada
 * setiap peran yang sudah memegang `receivables:manage` — lihat
 * `seed-max-features-permissions.sql`. Dengan begitu pagar halaman dan menu
 * menguji hal yang persis sama.
 *
 * Mengunci angka, kedua nomor dokumen, dan menandai gaji SPG dibayar TIDAK lagi
 * di sini (keputusan pemilik 2026-11-01): masing-masing izinnya sendiri di
 * bawah, supaya admin penjualan bisa mengetik nomor nota tanpa ikut bisa
 * mengunci angka atau mengetik faktur pajak. Seed-nya sengaja TIDAK memberikan
 * izin-izin itu ke pemegang `consignment:manage` yang sudah ada.
 */
export function bolehMengelolaKonsi(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.CONSIGNMENT_MANAGE);
}

/** Mengunci dan membuka kunci angka terjual resmi siklus — keputusan manager. */
export function bolehMengunciKonsi(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.CONSIGNMENT_LOCK);
}

/**
 * Mencatat salah satu dari dua nomor milik orang lain di kartu "Tiga nomor":
 * nomor nota milik admin penjualan (`NOTA`), nomor faktur pajak milik admin
 * pajak (`PAJAK`). Nomor konsi kita dibuat sistem, jadi tidak punya izin.
 */
export function bolehMencatatNomorKonsi(izin: string[] | undefined, jenis: "NOTA" | "PAJAK"): boolean {
  // `jenis` datang dari aksi server, jadi nilai lain ditolak — bukan dibaca sebagai PAJAK.
  const kode =
    jenis === "NOTA"
      ? PERMISSIONS.CONSIGNMENT_NOTE_NUMBER
      : jenis === "PAJAK"
        ? PERMISSIONS.CONSIGNMENT_TAX_NUMBER
        : null;
  return kode !== null && hasPermission(izin ?? [], kode);
}

/**
 * Menandai gaji pokok & komisi SPG sudah dibayar — toko konsinyasi (siklus)
 * dan toko putus (Komisi SPG). Terpisah dari menetapkan komisinya: yang
 * menghitung tidak otomatis yang mengeluarkan uang.
 */
export function bolehMembayarKomisiSpg(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.SPG_COMMISSION_PAY);
}

/**
 * Membuka halaman Komisi SPG: pembaca penjualan SPG, ATAU yang membayar komisi
 * dan gaji SPG (P28: Keuangan "hanya halaman Komisi SPG"). Keuangan memegang
 * `spg_commission:pay` saja, jadi halaman itu memagari dirinya dengan fungsi ini,
 * bukan dengan ROUTE_PERMISSIONS yang hanya bisa menguji satu izin.
 */
export function bolehMembukaKomisiSpg(izin: string[] | undefined): boolean {
  const p = izin ?? [];
  return hasPermission(p, PERMISSIONS.SPG_SALES_VIEW) || hasPermission(p, PERMISSIONS.SPG_COMMISSION_PAY);
}
