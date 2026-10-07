import { describe, expect, it } from "vitest";
import { POSTING_ROLES } from "@/lib/constants/journal-roles";
import type { BalanceRow } from "@/lib/finance/reports/balances";
import { buildIncomeStatement } from "@/lib/finance/reports/income-statement";
import {
  PERAN_OPSIONAL,
  PERAN_WAJIB,
  adaMutasi,
  adaMutasiLabaRugi,
  adaMutasiPohon,
  nilaiKesiapan,
  periodeLaporan,
  perluSpanduk,
} from "./kesiapan";

/*
 * Spanduk "Buku besar belum aktif" di Jurnal dan keempat laporan keuangan.
 * Tanpanya pemilik membaca "Laba bersih Rp 0" sebagai angka sungguhan
 * (audit 2026-10-06: Beranda Rp 22,8 jt terealisasi, laporan semua Rp 0).
 */

const SEMUA_WAJIB = [...PERAN_WAJIB];

describe("peran wajib dan opsional", () => {
  it("peran wajib = semua peran posting kecuali yang opsional; opsional punya cadangan atau belum dipakai", () => {
    expect(PERAN_WAJIB.length + PERAN_OPSIONAL.length).toBe(POSTING_ROLES.length);
    expect(PERAN_WAJIB).toContain("MARKETPLACE_FEE");
    expect(PERAN_WAJIB).toContain("AP");
    expect(PERAN_OPSIONAL).toContain("TAX");
    expect(PERAN_OPSIONAL).toContain("MARKETPLACE_FEE_OTHER");
    expect(PERAN_WAJIB).toHaveLength(11);
  });
});

describe("nilaiKesiapan", () => {
  it("keadaan lokal/prod hari ini: 0 peran, 0 jurnal, tanpa tanggal mulai → belum aktif dengan tiga alasan", () => {
    const k = nilaiKesiapan({ peranTerpetakan: [], jumlahJurnal: 0, tanggalMulai: null, jurnalTertunda: 1 });
    expect(k.aktif).toBe(false);
    expect(k.alasan).toEqual(["PEMETAAN", "TANPA_JURNAL", "TANPA_TANGGAL_MULAI"]);
    expect(k.jumlahTerpetakan).toBe(0);
    expect(k.totalPeran).toBe(17);
    expect(k.jumlahWajibTerpetakan).toBe(0);
    expect(k.totalPeranWajib).toBe(11);
    expect(k.peranWajibBelum).toEqual(SEMUA_WAJIB);
    expect(perluSpanduk(k)).toBe(true);
  });

  it("semua peran wajib terpetakan + ada jurnal + tanggal mulai → aktif; peran opsional tidak menahan", () => {
    const k = nilaiKesiapan({
      peranTerpetakan: SEMUA_WAJIB,
      jumlahJurnal: 12,
      tanggalMulai: "2026-10-01",
      jurnalTertunda: 0,
    });
    expect(k.aktif).toBe(true);
    expect(k.alasan).toEqual([]);
    expect(k.jumlahTerpetakan).toBe(11);
    expect(k.jumlahWajibTerpetakan).toBe(11);
    expect(perluSpanduk(k)).toBe(false);
  });

  it("satu peran wajib kurang → belum aktif dan peran itu disebut", () => {
    const k = nilaiKesiapan({
      peranTerpetakan: SEMUA_WAJIB.filter((p) => p !== "CASH"),
      jumlahJurnal: 3,
      tanggalMulai: "2026-10-01",
      jurnalTertunda: 0,
    });
    expect(k.aktif).toBe(false);
    expect(k.alasan).toEqual(["PEMETAAN"]);
    expect(k.peranWajibBelum).toEqual(["CASH"]);
  });

  it("peran tak dikenal dan duplikat tidak menggelembungkan hitungan", () => {
    const k = nilaiKesiapan({
      peranTerpetakan: ["AP", "AP", "BUKAN_PERAN", "TAX"],
      jumlahJurnal: 0,
      tanggalMulai: null,
      jurnalTertunda: 0,
    });
    expect(k.jumlahTerpetakan).toBe(2);
    expect(k.jumlahWajibTerpetakan).toBe(1);
  });

  it("aktif tetapi ada jurnal tertunda → spanduk tetap tampil", () => {
    const k = nilaiKesiapan({
      peranTerpetakan: SEMUA_WAJIB,
      jumlahJurnal: 5,
      tanggalMulai: "2026-10-01",
      jurnalTertunda: 2,
    });
    expect(k.aktif).toBe(true);
    expect(perluSpanduk(k)).toBe(true);
  });
});

describe("adaMutasi — keadaan kosong laporan", () => {
  it("benar hanya bila ada akun dengan debit atau kredit pada periode itu", () => {
    expect(adaMutasi([])).toBe(false);
    expect(adaMutasi([{ debit: 0, credit: 0 }, { debit: 0, credit: 0 }])).toBe(false);
    expect(adaMutasi([{ debit: 0, credit: 0 }, { debit: 0, credit: 150_000 }])).toBe(true);
  });
});

describe("periodeLaporan — laporan selalu menyebut periodenya", () => {
  it("isian kosong → sejak awal sampai hari ini (WIB)", () => {
    expect(periodeLaporan({ dari: "", sampai: "" }, "2026-10-06")).toEqual({ dari: null, sampai: "2026-10-06" });
  });

  it("isian terisi dipakai apa adanya; isian rusak diabaikan seperti di server", () => {
    expect(periodeLaporan({ dari: "2026-01-01", sampai: "2026-03-31" }, "2026-10-06")).toEqual({
      dari: "2026-01-01",
      sampai: "2026-03-31",
    });
    expect(periodeLaporan({ dari: "kemarin", sampai: "31/03/2026" }, "2026-10-06")).toEqual({
      dari: null,
      sampai: "2026-10-06",
    });
  });
});

describe("adaMutasiPohon — keadaan kosong versi cetak (pohon akun laporan)", () => {
  const simpul = (debit: number, credit: number, children: unknown[] = []) => ({ debit, credit, children });
  it("melihat sampai akun daun", () => {
    expect(adaMutasiPohon([])).toBe(false);
    expect(adaMutasiPohon([simpul(0, 0, [simpul(0, 0)])] as never)).toBe(false);
    expect(adaMutasiPohon([simpul(0, 0, [simpul(0, 0, [simpul(25_000, 0)])])] as never)).toBe(true);
  });
});

describe("adaMutasiLabaRugi — keadaan kosong Laba Rugi (layar dan cetak sama)", () => {
  const baris = (accountId: string, type: BalanceRow["type"], debit: number, credit: number): BalanceRow => ({
    accountId,
    code: accountId,
    name: accountId,
    type,
    parentId: null,
    depth: 0,
    isActive: true,
    hasChildren: false,
    debit,
    credit,
    signed: debit - credit,
  });

  it("jurnal yang hanya menyentuh akun neraca (penerimaan barang 1,5 jt) → Laba Rugi kosong", () => {
    const report = buildIncomeStatement([
      baris("1301", "ASET", 1_500_000, 0),
      baris("2101", "LIABILITAS", 0, 1_500_000),
      baris("4101", "PENDAPATAN", 0, 0),
      baris("5101", "HPP", 0, 0),
    ]);
    expect(adaMutasiLabaRugi(report)).toBe(false);
  });

  it("penjualan 250 rb di akun pendapatan → Laba Rugi berisi", () => {
    const report = buildIncomeStatement([
      baris("1102", "ASET", 250_000, 0),
      baris("4101", "PENDAPATAN", 0, 250_000),
    ]);
    expect(adaMutasiLabaRugi(report)).toBe(true);
  });

  it("beban saja (biaya 75 rb) juga berisi", () => {
    const report = buildIncomeStatement([baris("1101", "ASET", 0, 75_000), baris("6101", "BEBAN", 75_000, 0)]);
    expect(adaMutasiLabaRugi(report)).toBe(true);
  });
});
