import { describe, expect, it } from "vitest";
import {
  CASH_FLOW_COVERAGE_BODY,
  INCOME_STATEMENT_COVERAGE_BODY,
  LEDGER_NOT_ACTIVE_NOTE,
  SUMBER_BELUM_BERJURNAL,
  SUMBER_BERJURNAL,
  ledgerPendingNote,
} from "./disclosures";

/*
 * Catatan "Cakupan data" dulu hanya menyebut putus dan SPG sebagai yang belum
 * berjurnal, padahal konsinyasi, pelunasan piutang, retur toko, dan barang
 * hilang juga tidak pernah membuat jurnal (audit 2026-10-06). Daftarnya kini
 * satu, dan ketiga teks dibangun darinya.
 */

describe("cakupan data laporan keuangan", () => {
  it("konsinyasi, komisi SPG, barang hilang, gudang rusak, stok manual, retur pemasok, dan biaya perjalanan sudah berjurnal (lib/finance/operasional)", () => {
    const berjurnal = SUMBER_BERJURNAL.join(" | ");
    const belum = SUMBER_BELUM_BERJURNAL.join(" | ");
    for (const kata of ["konsinyasi", "komisi SPG", "barang hilang", "gudang barang rusak", "penyesuaian stok manual", "retur ke pemasok", "biaya perjalanan"]) {
      expect(berjurnal).toContain(kata);
      expect(belum).not.toContain(kata);
    }
  });

  it("yang masih belum berjurnal disebut jujur: perubahan stok dari Jubelio dan komisi salesman", () => {
    const teks = SUMBER_BELUM_BERJURNAL.join(" | ");
    expect(teks).toContain("Jubelio");
    expect(teks).toContain("komisi salesman");
  });

  it("penjualan lapangan putus, pelunasan, retur toko putus, dan tukar barang sudah berjurnal (lib/finance/lapangan)", () => {
    const berjurnal = SUMBER_BERJURNAL.join(" | ");
    const belum = SUMBER_BELUM_BERJURNAL.join(" | ");
    for (const kata of ["putus", "pelunasan piutang", "retur toko", "tukar barang"]) {
      expect(berjurnal).toContain(kata);
      expect(belum).not.toContain(kata);
    }
  });

  it("tidak ada sumber yang disebut di kedua daftar", () => {
    const berjurnal = new Set(SUMBER_BERJURNAL);
    expect(SUMBER_BELUM_BERJURNAL.filter((s) => berjurnal.has(s))).toEqual([]);
  });

  it("Laba Rugi dan Arus Kas menyebut SEMUA sumber yang belum berjurnal", () => {
    for (const sumber of SUMBER_BELUM_BERJURNAL) {
      expect(INCOME_STATEMENT_COVERAGE_BODY).toContain(sumber);
      expect(CASH_FLOW_COVERAGE_BODY).toContain(sumber);
    }
    for (const sumber of SUMBER_BERJURNAL) {
      expect(INCOME_STATEMENT_COVERAGE_BODY).toContain(sumber);
    }
  });
});

describe("catatan buku besar di versi cetak", () => {
  it("belum aktif dan jurnal tertunda", () => {
    expect(LEDGER_NOT_ACTIVE_NOTE).toContain("Buku besar belum aktif");
    expect(ledgerPendingNote(3)).toBe("3 jurnal gagal diposting — laporan ini belum memuat dokumennya.");
  });
});
