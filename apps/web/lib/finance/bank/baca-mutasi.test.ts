import { describe, expect, it } from "vitest";
import { bacaJumlahMutasi, bacaMutasiDariKisi, bacaTanggalMutasi, kunciBerindeks } from "./baca-mutasi";
import { bacaBerkasMutasi } from "./berkas";

describe("bacaJumlahMutasi", () => {
  it("mengenali format Indonesia, Inggris, kurung, minus, dan akhiran DB/CR", () => {
    expect(bacaJumlahMutasi("1,500,000.00")).toBe(150_000_000);
    expect(bacaJumlahMutasi("1.500.000,00")).toBe(150_000_000);
    expect(bacaJumlahMutasi("900.000")).toBe(90_000_000);
    expect(bacaJumlahMutasi("900,000")).toBe(90_000_000);
    expect(bacaJumlahMutasi("150000.5")).toBe(15_000_050);
    expect(bacaJumlahMutasi("6500")).toBe(650_000);
    expect(bacaJumlahMutasi("(10.000)")).toBe(-1_000_000);
    expect(bacaJumlahMutasi("-25.000")).toBe(-2_500_000);
    expect(bacaJumlahMutasi("25.000 CR")).toBe(2_500_000);
    expect(bacaJumlahMutasi("25,000.00 DB")).toBe(-2_500_000);
    expect(bacaJumlahMutasi("Rp 1.000")).toBe(100_000);
    expect(bacaJumlahMutasi(1234.56)).toBe(123_456);
  });
  it("menolak isian yang bukan angka", () => {
    for (const v of ["", "abc", "1.2.3,4,5", "12.345.67", null, undefined]) expect(bacaJumlahMutasi(v), String(v)).toBeNull();
  });
});

describe("bacaTanggalMutasi", () => {
  it("membaca berbagai bentuk tanggal", () => {
    expect(bacaTanggalMutasi("01/10/2026")).toBe("2026-10-01");
    expect(bacaTanggalMutasi("01/10/26")).toBe("2026-10-01");
    expect(bacaTanggalMutasi("2026-10-01")).toBe("2026-10-01");
    expect(bacaTanggalMutasi("01-Okt-2026")).toBe("2026-10-01");
    expect(bacaTanggalMutasi("1 Oct 2026")).toBe("2026-10-01");
    expect(bacaTanggalMutasi(46296)).toBe("2026-10-01");
    expect(bacaTanggalMutasi("31/02/2026")).toBeNull();
  });
  it("dd/mm tanpa tahun memakai tahun dari periode, termasuk periode Desember–Januari", () => {
    expect(bacaTanggalMutasi("'05/10", { periodeDari: "2026-10-01", periodeSampai: "2026-10-31" })).toBe("2026-10-05");
    expect(bacaTanggalMutasi("30/12", { periodeDari: "2026-12-15", periodeSampai: "2027-01-14" })).toBe("2026-12-30");
    expect(bacaTanggalMutasi("03/01", { periodeDari: "2026-12-15", periodeSampai: "2027-01-14" })).toBe("2027-01-03");
    expect(bacaTanggalMutasi("05/10")).toBeNull();
  });
});

const CSV_BCA = [
  "No. rekening : 1234567890",
  "Nama : PT ELORAE FASHION",
  "Periode : 01/10/2026 - 31/10/2026",
  "Kode Mata Uang : IDR",
  "",
  "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
  "'01/10,'TRSF E-BANKING DB 0110/FTSCY/WS95051 PT KAIN INDAH,'0000,\"1,500,000.00\",DB,\"8,500,000.00\"",
  "'02/10,'BIAYA ADM,'0000,\"10,000.00\",DB,\"8,490,000.00\"",
  "'02/10,'SETORAN TUNAI,'0038,\"900,000.00\",CR,\"9,390,000.00\"",
  "'PEND,'TRSF E-BANKING DB,'0000,\"5,000.00\",DB,\"9,385,000.00\"",
  "",
  "Saldo Awal,\"10,000,000.00\"",
  "Mutasi Kredit,\"900,000.00\",1",
  "Mutasi Debet,\"1,510,000.00\",2",
  "Saldo Akhir,\"9,390,000.00\"",
].join("\n");

describe("format BCA", () => {
  it("membaca blok kepala, kolom DB/CR tanpa judul, tahun dari periode, dan ekor saldo", () => {
    const r = bacaBerkasMutasi(CSV_BCA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.format).toBe("BCA");
    expect(r.periodeDari).toBe("2026-10-01");
    expect(r.periodeSampai).toBe("2026-10-31");
    expect(r.saldoAwalSen).toBe(1_000_000_000);
    expect(r.saldoAkhirSen).toBe(939_000_000);
    expect(r.dilewati).toBe(1);
    expect(r.baris.map((b) => [b.tanggal, b.jumlahSen, b.saldoSen])).toEqual([
      ["2026-10-01", -150_000_000, 850_000_000],
      ["2026-10-02", -1_000_000, 849_000_000],
      ["2026-10-02", 90_000_000, 939_000_000],
    ]);
    expect(r.baris[0].keterangan).toBe("TRSF E-BANKING DB 0110/FTSCY/WS95051 PT KAIN INDAH");
  });
});

describe("format Mandiri dan umum", () => {
  it("Mandiri: kolom Debit/Credit terpisah, tanggal dd/mm/yy", () => {
    const r = bacaMutasiDariKisi([
      ["Account No", "Date", "Val. Date", "Transaction Code", "Description", "Description", "Reference No.", "Debit", "Credit"],
      ["1370012345678", "01/10/26", "01/10/26", "8888", "TRANSFER KE", "PT KAIN INDAH", "REF001", "1,500,000.00", "0.00"],
      ["1370012345678", "03/10/26", "03/10/26", "8889", "BUNGA", "", "", "0.00", "12,345.67"],
    ]);
    expect(r.ok && r.format).toBe("MANDIRI");
    if (!r.ok) return;
    expect(r.baris.map((b) => [b.tanggal, b.jumlahSen, b.keterangan, b.referensi])).toEqual([
      ["2026-10-01", -150_000_000, "TRANSFER KE · PT KAIN INDAH", "REF001"],
      ["2026-10-03", 1_234_567, "BUNGA", null],
    ]);
    expect(r.saldoAwalSen).toBeNull();
  });

  it("umum: jumlah bertanda + saldo, saldo awal dihitung dari baris pertama", () => {
    const r = bacaMutasiDariKisi([
      ["Laporan mutasi"],
      ["Tanggal", "Keterangan", "Jumlah", "Saldo"],
      ["2026-10-05", "Biaya admin", -6500, 993500],
      ["2026-10-06", "Biaya admin", -6500, 987000],
      ["Total", "", -13000, ""],
    ]);
    expect(r.ok && r.format).toBe("UMUM");
    if (!r.ok) return;
    expect(r.baris).toHaveLength(2);
    expect(r.saldoAwalSen).toBe(100_000_000);
    expect(r.saldoAkhirSen).toBe(98_700_000);
    expect(r.dilewati).toBe(0);
  });

  it("menolak berkas tanpa kepala dan dd/mm tanpa periode", () => {
    expect(bacaMutasiDariKisi([["a", "b"], [1, 2]])).toEqual({ ok: false, kode: "KEPALA_TIDAK_DITEMUKAN" });
    expect(bacaMutasiDariKisi([["Tanggal", "Keterangan", "Jumlah"], ["05/10", "x", "5"]])).toEqual({ ok: false, kode: "TAHUN_TIDAK_DIKETAHUI" });
    expect(bacaMutasiDariKisi([["Tanggal", "Keterangan", "Jumlah"]])).toEqual({ ok: false, kode: "TANPA_BARIS" });
  });
});

describe("kunciBerindeks", () => {
  it("baris identik mendapat indeks kemunculan berbeda, impor ulang mendapat kunci yang sama", () => {
    const baris = [
      { tanggal: "2026-10-05", jumlahSen: -650_000, saldoSen: null, keterangan: "BIAYA ADM" },
      { tanggal: "2026-10-05", jumlahSen: -650_000, saldoSen: null, keterangan: "biaya  adm" },
      { tanggal: "2026-10-06", jumlahSen: -650_000, saldoSen: null, keterangan: "BIAYA ADM" },
    ];
    const k = kunciBerindeks(baris);
    expect(new Set(k).size).toBe(3);
    expect(k[0].endsWith("#0")).toBe(true);
    expect(k[1].endsWith("#1")).toBe(true);
    expect(kunciBerindeks(baris)).toEqual(k);
  });
});
