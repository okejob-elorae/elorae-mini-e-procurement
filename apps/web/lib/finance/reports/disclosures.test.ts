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
  it("daftar yang belum berjurnal lengkap menurut audit", () => {
    const teks = SUMBER_BELUM_BERJURNAL.join(" | ");
    for (const kata of ["putus", "konsinyasi", "SPG", "pelunasan piutang", "retur toko", "barang hilang"]) {
      expect(teks).toContain(kata);
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
