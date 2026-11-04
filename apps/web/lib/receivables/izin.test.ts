import { describe, expect, it } from 'vitest';
import {
  bolehMelapor,
  bolehMembacaArsip,
  bolehMembacaPelunasan,
  bolehMembacaPiutang,
  bolehMembacaRetur,
  bolehMembayarKomisiSpg,
  bolehMembukaKonsi,
  bolehMemutuskanBeban,
  bolehMemutuskanSelisihRetur,
  bolehMemverifikasi,
  bolehMencatatNomorKonsi,
  bolehMengelola,
  bolehMengelolaKonsi,
  bolehMengunciKonsi,
  bolehMenghitung,
} from './izin';

/**
 * Pemisahan tugas.
 *
 * Bukan soal senioritas melainkan soal siapa boleh mengesahkan pekerjaan siapa
 * — dan pemisahan itulah yang membuat kedua aturan uangnya berarti. Diuji
 * karena satu izin yang dilonggarkan tidak terlihat sebagai kerusakan; ia
 * terlihat sebagai halaman yang tiba-tiba terbuka.
 */

const SALES = ['pwa:access'];
const KEUANGAN = ["payments:verify"];
/** Pekerjaan jurnal saja — sebelum 2026-11-01 inilah izin pemeriksa BKM. */
const JURNAL_SAJA = ["journals:manage"];
const GUDANG = ['inventory_opname:count'];
const PIUTANG = ['receivables:manage'];
const KONSI_SAJA = ['consignment:view', 'consignment:manage'];
const ADMIN = ['*'];
const PIUTANG_LIHAT = ['receivables:view'];
const SPG = ['pwa:access', 'spg_sales:record'];
const PRODUKSI = ['dashboard:view', 'work_orders:view', 'inventory_opname:view'];
const PEMBELIAN = ['dashboard:view', 'purchase_orders:view'];

describe('pemisahan tugas', () => {
  it('sales boleh melapor tapi TIDAK boleh mengesahkan laporannya sendiri', () => {
    // Kalau pelapor bisa mengesahkan laporannya sendiri, seluruh Aturan 1 runtuh.
    expect(bolehMelapor(SALES)).toBe(true);
    expect(bolehMemverifikasi(SALES)).toBe(false);
  });

  it('keuangan mengesahkan, tapi tidak menghitung fisik barang', () => {
    expect(bolehMemverifikasi(KEUANGAN)).toBe(true);
    expect(bolehMenghitung(KEUANGAN)).toBe(false);
  });

  it('gudang menghitung fisik, tapi tidak memutuskan penagihan', () => {
    expect(bolehMenghitung(GUDANG)).toBe(true);
    expect(bolehMengelola(GUDANG)).toBe(false);
  });

  it('yang mengelola piutang tetap tidak boleh mengesahkan klaim', () => {
    expect(bolehMengelola(PIUTANG)).toBe(true);
    expect(bolehMemverifikasi(PIUTANG)).toBe(false);
  });

  it("pekerjaan jurnal saja TIDAK lagi berarti boleh mengesahkan uang masuk", () => {
    /*
     * Sampai 2026-11-01 pemeriksa BKM menumpang `journals:manage`. Pemilik
     * meminta izin "periksa pembayaran" sendiri, supaya orang yang membuat
     * jurnal tidak otomatis mengesahkan pembayaran toko — dan sebaliknya.
     */
    expect(bolehMemverifikasi(JURNAL_SAJA)).toBe(false);
    expect(bolehMembacaPelunasan(JURNAL_SAJA)).toBe(false);
    expect(bolehMembacaRetur(JURNAL_SAJA)).toBe(false);
    // Pemeriksa pembayaran tidak ikut mendapat pekerjaan piutang lainnya.
    expect(bolehMengelola(KEUANGAN)).toBe(false);
    expect(bolehMelapor(KEUANGAN)).toBe(false);
  });
});

describe('arsip nota retur', () => {
  it('TIDAK terbuka hanya karena seseorang punya akun', () => {
    /*
     * Sebelum pagar ini ada, halaman arsip hanya menuntut sudah masuk — jadi
     * setiap orang di kantor membuka setiap nota retur setiap toko, lengkap
     * dengan fotonya. Itu dokumen keuangan milik toko dan sales.
     */
    expect(bolehMembacaArsip([])).toBe(false);
    expect(bolehMembacaArsip(SALES)).toBe(false);
    expect(bolehMembacaArsip(['receivables:view'])).toBe(true);
  });

  it('TIDAK terbuka bagi yang pekerjaannya hanya konsinyasi', () => {
    // Permintaan tegas di brief: Admin Penjualan dan Admin Pajak tidak boleh
    // membuka lampiran di luar konsinyasi.
    expect(bolehMembacaArsip(KONSI_SAJA)).toBe(false);
    expect(bolehMembukaKonsi(KONSI_SAJA)).toBe(true);
  });
});

describe('membaca halaman modul piutang', () => {
  /*
   * Halaman piutang, BKM, retur, kontrabon, dan cetakannya dulu hanya menuntut
   * sudah masuk. Rutenya tidak dipetakan di ROUTE_PERMISSIONS dan layout
   * backoffice tidak menjaga, jadi salesman, SPG, dan orang produksi membuka
   * piutang SELURUH toko lewat alamat yang diketik.
   */
  const LUAR = [[], SALES, SPG, PRODUKSI, PEMBELIAN, KONSI_SAJA];

  it('piutang, kontrabon, beban selisih, dasbor: hanya orang piutang', () => {
    expect(bolehMembacaPiutang(PIUTANG_LIHAT)).toBe(true);
    // Yang mengelola tentu boleh membaca yang ia kelola.
    expect(bolehMembacaPiutang(PIUTANG)).toBe(true);
    for (const izin of [...LUAR, GUDANG, KEUANGAN]) expect(bolehMembacaPiutang(izin)).toBe(false);
  });

  it('BKM: orang piutang, ATAU keuangan yang memverifikasinya', () => {
    // Keuangan dikabari klaim baru dan permintaan koreksi BKM — tautannya
    // menuju rincian BKM, jadi pintunya harus terbuka untuk keuangan.
    expect(bolehMembacaPelunasan(KEUANGAN)).toBe(true);
    expect(bolehMembacaPelunasan(PIUTANG_LIHAT)).toBe(true);
    expect(bolehMembacaPelunasan(PIUTANG)).toBe(true);
    for (const izin of [...LUAR, GUDANG]) expect(bolehMembacaPelunasan(izin)).toBe(false);
  });

  it('nota retur toko: orang piutang, gudang yang menghitung, keuangan yang memverifikasi', () => {
    // Rincian BKM menautkan potongan returnya ke nota retur — keuangan yang
    // memverifikasi perlu membuka nota yang menahan nilainya.
    expect(bolehMembacaRetur(GUDANG)).toBe(true);
    expect(bolehMembacaRetur(KEUANGAN)).toBe(true);
    expect(bolehMembacaRetur(PIUTANG_LIHAT)).toBe(true);
    for (const izin of LUAR) expect(bolehMembacaRetur(izin)).toBe(false);
  });

  it('pelapor lapangan tidak membaca kantor: melapor bukan membaca seluruh toko', () => {
    expect(bolehMelapor(SALES)).toBe(true);
    expect(bolehMembacaPiutang(SALES)).toBe(false);
    expect(bolehMembacaPelunasan(SALES)).toBe(false);
    expect(bolehMembacaRetur(SALES)).toBe(false);
  });
});

describe('konsinyasi', () => {
  it('menguji SATU izin, sama persis dengan yang diuji menu sampingnya', () => {
    /*
     * Sempat ditulis "ini ATAU yang mengelola piutang" supaya tidak ada yang
     * terkunci. Tapi menu sampingnya hanya bisa menguji SATU izin, jadi
     * hasilnya pintu terbuka dengan menu yang tidak menampilkannya — orang yang
     * berhak tidak akan pernah menemukannya. Yang memberi izin ke peran lama
     * adalah seed, bukan klausa OR di sini.
     */
    expect(bolehMembukaKonsi(PIUTANG)).toBe(false);
    expect(bolehMengelolaKonsi(PIUTANG)).toBe(false);
    expect(bolehMembukaKonsi(['consignment:view'])).toBe(true);
  });

  it('melihat siklus tidak berarti boleh menguncinya', () => {
    expect(bolehMembukaKonsi(['consignment:view'])).toBe(true);
    expect(bolehMengelolaKonsi(['consignment:view'])).toBe(false);
    expect(bolehMengunciKonsi(['consignment:view'])).toBe(false);
  });

  it("mengelola siklus tidak membawa kunci angka, kedua nomor, maupun bayar gaji SPG", () => {
    /*
     * Dulu SATU izin konsinyasi mencakup semuanya, jadi admin penjualan yang
     * mengetik nomor nota sekaligus bisa mengunci angka, mengetik faktur pajak,
     * dan menandai gaji SPG dibayar (keputusan pemilik 2026-11-01).
     */
    expect(bolehMengelolaKonsi(KONSI_SAJA)).toBe(true);
    expect(bolehMengunciKonsi(KONSI_SAJA)).toBe(false);
    expect(bolehMencatatNomorKonsi(KONSI_SAJA, "NOTA")).toBe(false);
    expect(bolehMencatatNomorKonsi(KONSI_SAJA, "PAJAK")).toBe(false);
    expect(bolehMembayarKomisiSpg(KONSI_SAJA)).toBe(false);
  });

  it("nomor nota milik admin penjualan, nomor faktur pajak milik admin pajak", () => {
    const ADMIN_PENJUALAN = ["consignment:view", "consignment:note_number"];
    const ADMIN_PAJAK = ["consignment:view", "consignment:tax_number", "tax_invoices:manage"];
    expect(bolehMencatatNomorKonsi(ADMIN_PENJUALAN, "NOTA")).toBe(true);
    expect(bolehMencatatNomorKonsi(ADMIN_PENJUALAN, "PAJAK")).toBe(false);
    expect(bolehMencatatNomorKonsi(ADMIN_PAJAK, "PAJAK")).toBe(true);
    expect(bolehMencatatNomorKonsi(ADMIN_PAJAK, "NOTA")).toBe(false);
    // Antrean faktur pajak nota tagihan tidak sekaligus membuka nomor faktur konsi.
    expect(bolehMencatatNomorKonsi(["tax_invoices:manage"], "PAJAK")).toBe(false);
    // Jenis lain dari aksi server tidak dibaca sebagai PAJAK, bahkan untuk admin.
    expect(bolehMencatatNomorKonsi(ADMIN, "KONSI" as unknown as "NOTA")).toBe(false);
    expect(bolehMencatatNomorKonsi(ADMIN_PAJAK, "" as unknown as "PAJAK")).toBe(false);
    // Tidak satu pun dari keduanya bisa mengunci angka.
    expect(bolehMengunciKonsi(ADMIN_PENJUALAN)).toBe(false);
    expect(bolehMengunciKonsi(ADMIN_PAJAK)).toBe(false);
  });

  it("mengunci angka dan membayar gaji SPG: masing-masing izinnya sendiri", () => {
    expect(bolehMengunciKonsi(["consignment:lock"])).toBe(true);
    expect(bolehMembayarKomisiSpg(["consignment:lock"])).toBe(false);
    expect(bolehMembayarKomisiSpg(["spg_commission:pay"])).toBe(true);
    expect(bolehMengunciKonsi(["spg_commission:pay"])).toBe(false);
    // Mengatur tarif komisi bukan membayar komisi.
    expect(bolehMembayarKomisiSpg(["spg_commission:manage"])).toBe(false);
  });
});

describe("persetujuan: bawaannya hanya admin", () => {
  /*
   * "Manager" = admin (keputusan pemilik 2026-10-29). Persetujuan yang dulu
   * menumpang izin kelola yang lebar kini izinnya sendiri, supaya pemegang izin
   * kelola tidak diam-diam ikut memutuskan — pemilik yang memberikannya.
   */
  it("memutuskan beban selisih bukan bagian dari mengelola piutang", () => {
    expect(bolehMemutuskanBeban(PIUTANG)).toBe(false);
    expect(bolehMemutuskanBeban([...PIUTANG, ...PIUTANG_LIHAT])).toBe(false);
    expect(bolehMemutuskanBeban(KEUANGAN)).toBe(false);
    expect(bolehMemutuskanBeban(["receivables:decide_bearer"])).toBe(true);
    // Yang memutuskan beban tidak otomatis mengelola piutang lainnya.
    expect(bolehMengelola(["receivables:decide_bearer"])).toBe(false);
  });

  it("memutuskan selisih retur toko punya izinnya sendiri, terpisah dari barang hilang (P22)", () => {
    expect(bolehMemutuskanSelisihRetur(["store_returns:decide_shortfall"])).toBe(true);
    expect(bolehMemutuskanSelisihRetur(["receivables:decide_bearer"])).toBe(false);
    expect(bolehMemutuskanSelisihRetur(PIUTANG)).toBe(false);
    expect(bolehMemutuskanSelisihRetur(KEUANGAN)).toBe(false);
    expect(bolehMemutuskanBeban(["store_returns:decide_shortfall"])).toBe(false);
  });

  it("tidak satu pun persetujuan lolos untuk peran kantor yang hanya memegang izin kerja", () => {
    const KERJA_KANTOR = [
      "receivables:view",
      "receivables:manage",
      "consignment:view",
      "consignment:manage",
      "consignment:note_number",
      "consignment:tax_number",
      "tax_invoices:manage",
      "journals:manage",
      "payments:verify",
      "stores:manage",
      "field_sales_orders:approve",
      "spg_commission:manage",
    ];
    expect(bolehMemutuskanBeban(KERJA_KANTOR)).toBe(false);
    expect(bolehMemutuskanSelisihRetur(KERJA_KANTOR)).toBe(false);
    expect(bolehMengunciKonsi(KERJA_KANTOR)).toBe(false);
    expect(bolehMembayarKomisiSpg(KERJA_KANTOR)).toBe(false);
  });
});

describe('admin', () => {
  it('lolos semuanya lewat wildcard', () => {
    // Wildcard-nya diberikan di KODE (RoleDefinition.isSystem), bukan oleh baris
    // Permission — jadi seed yang tertinggal tidak pernah mengunci admin.
    for (const f of [
      bolehMelapor,
      bolehMemverifikasi,
      bolehMenghitung,
      bolehMengelola,
      bolehMembacaArsip,
      bolehMembacaPiutang,
      bolehMembacaPelunasan,
      bolehMembacaRetur,
      bolehMembukaKonsi,
      bolehMengelolaKonsi,
      bolehMengunciKonsi,
      bolehMemutuskanBeban,
      bolehMemutuskanSelisihRetur,
      bolehMembayarKomisiSpg,
    ]) {
      expect(f(ADMIN)).toBe(true);
    }
    expect(bolehMencatatNomorKonsi(ADMIN, "NOTA")).toBe(true);
    expect(bolehMencatatNomorKonsi(ADMIN, "PAJAK")).toBe(true);
  });

  it('menolak daftar izin yang tidak ada sama sekali', () => {
    // `undefined` harus dibaca sebagai tidak berhak, bukan sebagai lewati saja.
    for (const f of [
      bolehMemverifikasi,
      bolehMembacaArsip,
      bolehMembukaKonsi,
      bolehMembacaPiutang,
      bolehMembacaPelunasan,
      bolehMembacaRetur,
      bolehMengunciKonsi,
      bolehMemutuskanBeban,
      bolehMemutuskanSelisihRetur,
      bolehMembayarKomisiSpg,
    ]) {
      expect(f(undefined)).toBe(false);
    }
    expect(bolehMencatatNomorKonsi(undefined, "NOTA")).toBe(false);
    expect(bolehMencatatNomorKonsi(undefined, "PAJAK")).toBe(false);
  });
});
