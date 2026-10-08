import { describe, expect, it } from "vitest";
import {
  bacaIdSumberPenyusutan,
  barisPelepasan,
  bulanTerakhirSebelumLepas,
  idSumberPenyusutan,
  periksaIsianAset,
  selisihAkumulasiAwal,
  spekDariAset,
  type IsianAset,
} from "./aturan";
import { tarifSaldoMenurunBawaan } from "./kelompok";

const HARI_INI = "2026-10-08";

function isian(x: Partial<IsianAset> = {}): IsianAset {
  return {
    nama: "Laptop admin",
    kategori: "KELOMPOK_1",
    tanggalPerolehan: "2026-10-01",
    biaya: "12.000.000",
    cara: "JURNAL",
    akunLawanId: "akun-bank",
    ...x,
  };
}

describe("isian aset tetap", () => {
  it("kelompok fiskal: umur, metode, dan tarif dari kelompoknya; mulai disusutkan = bulan perolehan", () => {
    const r = periksaIsianAset(isian({ metode: "DECLINING_BALANCE", umurBulan: 7, tarifSaldoMenurun: 3 }), HARI_INI);
    expect(r).toMatchObject({
      ok: true,
      aset: { biaya: 12_000_000, nilaiSisa: 0, umurBulan: 48, metode: "DECLINING_BALANCE", tarifSaldoMenurun: 50, mulaiDisusutkan: { tahun: 2026, bulan: 10 } },
    });
  });

  it("bangunan hanya garis lurus; nilai sisa hanya untuk komersial", () => {
    expect(periksaIsianAset(isian({ kategori: "BANGUNAN_PERMANEN", metode: "DECLINING_BALANCE" }), HARI_INI)).toEqual({ ok: false, kode: "METODE_TIDAK_SAH" });
    expect(periksaIsianAset(isian({ nilaiSisa: "1.000.000" }), HARI_INI)).toEqual({ ok: false, kode: "NILAI_SISA_FISKAL" });
    const k = periksaIsianAset(isian({ kategori: "KOMERSIAL", umurBulan: 36, nilaiSisa: "1.000.000" }), HARI_INI);
    expect(k).toMatchObject({ ok: true, aset: { umurBulan: 36, nilaiSisa: 1_000_000, metode: "STRAIGHT_LINE" } });
  });

  it("komersial: umur wajib 1–600 bulan; tarif saldo menurun bawaan dua kali garis lurus", () => {
    expect(periksaIsianAset(isian({ kategori: "KOMERSIAL" }), HARI_INI)).toEqual({ ok: false, kode: "UMUR_TIDAK_SAH" });
    expect(periksaIsianAset(isian({ kategori: "KOMERSIAL", umurBulan: 601 }), HARI_INI)).toEqual({ ok: false, kode: "UMUR_TIDAK_SAH" });
    const r = periksaIsianAset(isian({ kategori: "KOMERSIAL", umurBulan: 60, metode: "DECLINING_BALANCE" }), HARI_INI);
    expect(r).toMatchObject({ ok: true, aset: { tarifSaldoMenurun: 40 } });
    expect(tarifSaldoMenurunBawaan(48)).toBe(50);
    expect(periksaIsianAset(isian({ kategori: "KOMERSIAL", umurBulan: 60, metode: "DECLINING_BALANCE", tarifSaldoMenurun: "101" }), HARI_INI)).toEqual({
      ok: false,
      kode: "TARIF_TIDAK_SAH",
    });
  });

  it("tanggal: tidak boleh di masa depan; mulai disusutkan tidak sebelum bulan perolehan", () => {
    expect(periksaIsianAset(isian({ tanggalPerolehan: "2026-10-09" }), HARI_INI)).toEqual({ ok: false, kode: "TANGGAL_MASA_DEPAN" });
    expect(periksaIsianAset(isian({ tanggalPerolehan: "2026-02-31" }), HARI_INI)).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    expect(periksaIsianAset(isian({ mulaiDisusutkan: "2026-09" }), HARI_INI)).toEqual({ ok: false, kode: "MULAI_SEBELUM_PEROLEHAN" });
    expect(periksaIsianAset(isian({ mulaiDisusutkan: "2026-12" }), HARI_INI)).toMatchObject({ ok: true, aset: { mulaiDisusutkan: { tahun: 2026, bulan: 12 } } });
  });

  it("akumulasi awal hanya untuk aset yang sudah dicatat / saldo awal, dan tidak melebihi yang bisa disusutkan", () => {
    expect(periksaIsianAset(isian({ akumulasiAwal: "1.000.000" }), HARI_INI)).toEqual({ ok: false, kode: "AKUMULASI_PEMBELIAN_BARU" });
    expect(periksaIsianAset(isian({ cara: "SALDO_AWAL", akumulasiAwal: "13.000.000" }), HARI_INI)).toEqual({ ok: false, kode: "AKUMULASI_TIDAK_SAH" });
    expect(periksaIsianAset(isian({ cara: "SALDO_AWAL", akumulasiAwal: "6.000.000", akunLawanId: "x" }), HARI_INI)).toMatchObject({
      ok: true,
      aset: { akumulasiAwal: 6_000_000, akunLawanId: null },
    });
  });

  it("jurnal perolehan butuh akun lawan; cara harus dikenal; biaya positif", () => {
    expect(periksaIsianAset(isian({ akunLawanId: null }), HARI_INI)).toEqual({ ok: false, kode: "AKUN_LAWAN_WAJIB" });
    expect(periksaIsianAset(isian({ cara: "LAIN" }), HARI_INI)).toEqual({ ok: false, kode: "CARA_TIDAK_SAH" });
    expect(periksaIsianAset(isian({ biaya: "0" }), HARI_INI)).toEqual({ ok: false, kode: "BIAYA_TIDAK_SAH" });
    expect(periksaIsianAset(isian({ biaya: "abc" }), HARI_INI)).toEqual({ ok: false, kode: "BIAYA_TIDAK_SAH" });
    expect(periksaIsianAset(isian({ nama: "  " }), HARI_INI)).toEqual({ ok: false, kode: "NAMA_WAJIB" });
  });

  it("selisih akumulasi awal terhadap jadwal", () => {
    const spek = spekDariAset({ cost: 48_000_000, residualValue: 0, usefulLifeMonths: 48, method: "STRAIGHT_LINE", decliningRatePercent: null, mulai: { tahun: 2024, bulan: 1 } });
    expect(selisihAkumulasiAwal(spek, 33_000_000, { tahun: 2026, bulan: 10 })).toBe(0);
    expect(selisihAkumulasiAwal(spek, 30_000_000, { tahun: 2026, bulan: 10 })).toBe(3_000_000);
  });
});

describe("sumber jurnal penyusutan", () => {
  it("sourceId <aset>/<YYYY-MM> bolak-balik", () => {
    expect(bacaIdSumberPenyusutan(idSumberPenyusutan("cabc123", "2026-10"))).toEqual({ asetId: "cabc123", periode: "2026-10", tb: { tahun: 2026, bulan: 10 } });
    expect(bacaIdSumberPenyusutan("cabc123")).toBeNull();
    expect(bacaIdSumberPenyusutan("cabc/2026-13")).toBeNull();
  });
});

describe("jurnal pelepasan aset", () => {
  const jumlah = (b: ReturnType<typeof barisPelepasan>, sisi: "debit" | "credit") => b.reduce((s, x) => s + Math.round(x[sisi] * 100), 0);

  it("dijual untung: DR akumulasi + DR kas, CR aset + CR laba", () => {
    const b = barisPelepasan({ biaya: 12_000_000, akumulasi: 9_000_000, hasilJual: 4_000_000 });
    expect(b).toEqual([
      { peran: "AKUMULASI", debit: 9_000_000, credit: 0 },
      { peran: "PENERIMAAN", debit: 4_000_000, credit: 0 },
      { peran: "ASET", debit: 0, credit: 12_000_000 },
      { peran: "LABA_RUGI", debit: 0, credit: 1_000_000 },
    ]);
    expect(jumlah(b, "debit")).toBe(jumlah(b, "credit"));
  });

  it("dihapus tanpa hasil: rugi sebesar nilai buku; aset yang belum disusutkan tidak punya baris akumulasi", () => {
    expect(barisPelepasan({ biaya: 5_000_000, akumulasi: 0, hasilJual: 0 })).toEqual([
      { peran: "LABA_RUGI", debit: 5_000_000, credit: 0 },
      { peran: "ASET", debit: 0, credit: 5_000_000 },
    ]);
  });

  it("dijual tepat nilai buku: tanpa baris laba/rugi; sen dijaga", () => {
    const b = barisPelepasan({ biaya: 1_000.5, akumulasi: 250.25, hasilJual: 750.25 });
    expect(b.find((x) => x.peran === "LABA_RUGI")).toBeUndefined();
    expect(jumlah(b, "debit")).toBe(jumlah(b, "credit"));
  });

  it("bulan terakhir disusutkan = bulan sebelum pelepasan", () => {
    expect(bulanTerakhirSebelumLepas({ tahun: 2027, bulan: 1 })).toEqual({ tahun: 2026, bulan: 12 });
    expect(bulanTerakhirSebelumLepas({ tahun: 2027, bulan: 5 })).toEqual({ tahun: 2027, bulan: 4 });
  });
});
