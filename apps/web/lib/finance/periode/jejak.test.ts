import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/messages/en.json";
import id from "@/lib/i18n/messages/id.json";
import { JEJAK_PERIODE } from "./jejak";
import { KODE_GALAT_PERIODE, KUNCI_PERIKSA } from "./periode";

/*
 * Setiap kode penolakan tutup buku punya teks di kedua bahasa (`tutupBuku.err.<KODE>`),
 * setiap nama tindakan jejaknya punya label, dan setiap butir daftar periksa
 * punya judul dan kalimat gagalnya — layar memetakan kode, kode tanpa teks
 * tampil sebagai kunci mentah.
 */

type Pesan = Record<string, unknown>;
const ambil = (pesan: Pesan, jalur: string): unknown =>
  jalur.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Pesan)[k] : undefined), pesan);

/** Sebab "belum berlaku" yang ditulis `queries.ts` (`bacaDataPeriksa`). */
const SEBAB_BELUM = [
  "TANPA_TANGGAL_MULAI",
  "SEBELUM_TANGGAL_MULAI",
  "BANK_BELUM_DIIMPOR",
  "TANPA_ASET_TETAP",
  "BUKAN_PKP",
  "TANPA_PENJUALAN_MARKETPLACE",
  "LAIN",
];

describe.each([
  ["id", id as Pesan],
  ["en", en as Pesan],
])("i18n tutup buku (%s)", (_bahasa, pesan) => {
  it("setiap kode penolakan punya teks", () => {
    for (const kode of KODE_GALAT_PERIODE) {
      expect(typeof ambil(pesan, `tutupBuku.err.${kode}`), kode).toBe("string");
    }
  });

  it("setiap nama tindakan jejak punya label, begitu pula entitasnya", () => {
    for (const aksi of Object.values(JEJAK_PERIODE)) {
      expect(typeof ambil(pesan, `auditActions.actions.${aksi}`), aksi).toBe("string");
    }
    expect(typeof ambil(pesan, "auditActions.entities.AccountingPeriod")).toBe("string");
    expect(typeof ambil(pesan, "auditActions.entities.AccountingYear")).toBe("string");
  });

  it("setiap butir daftar periksa punya judul dan kalimat gagal; setiap sebab belum-berlaku punya teks", () => {
    for (const b of KUNCI_PERIKSA) {
      expect(typeof ambil(pesan, `tutupBuku.periksa.butir.${b}`), b).toBe("string");
      expect(typeof ambil(pesan, `tutupBuku.periksa.gagal.${b}`), b).toBe("string");
    }
    for (const s of SEBAB_BELUM) expect(typeof ambil(pesan, `tutupBuku.periksa.belum.${s}`), s).toBe("string");
  });

  it("menu, baris Beranda, galat jurnal manual, dan galat settlement baru punya teks", () => {
    for (const k of [
      "navigation.navFinanceTutupBuku",
      "navigation.navFinanceIntegritas",
      "navigation.navFinanceMulaiBukuBesar",
      "dashboardActions.ledgerDocsWithoutJournal",
      "financeJournals.error.PERIOD_CLOSED",
      "financeJournals.sourceTypes.YEAR_END_CLOSE",
      "financeSettlements.journalErr.SEBELUM_TANGGAL_MULAI",
      "financeReports.balanceSheet.labaTahunBerjalan",
      "financeReports.balanceSheet.labaTahunLalu",
    ]) {
      expect(typeof ambil(pesan, k), k).toBe("string");
    }
  });
});
