import { describe, expect, it } from 'vitest';
import {
  bolehMelapor,
  bolehMembacaArsip,
  bolehMembukaKonsi,
  bolehMemverifikasi,
  bolehMengelola,
  bolehMengelolaKonsi,
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
const KEUANGAN = ['journals:manage'];
const GUDANG = ['inventory_opname:count'];
const PIUTANG = ['receivables:manage'];
const KONSI_SAJA = ['consignment:view', 'consignment:manage'];
const ADMIN = ['*'];

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
      bolehMembukaKonsi,
      bolehMengelolaKonsi,
    ]) {
      expect(f(ADMIN)).toBe(true);
    }
  });

  it('menolak daftar izin yang tidak ada sama sekali', () => {
    // `undefined` harus dibaca sebagai tidak berhak, bukan sebagai lewati saja.
    for (const f of [bolehMemverifikasi, bolehMembacaArsip, bolehMembukaKonsi]) {
      expect(f(undefined)).toBe(false);
    }
  });
});
