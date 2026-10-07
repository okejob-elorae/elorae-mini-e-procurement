import { describe, expect, it } from "vitest";
import { saringPiutang } from "./saring";

/*
 * Daftar Faktur & Piutang: faktur lunas disembunyikan bawaan (dulu tiga faktur
 * Rp 0 bercampur dengan yang terbuka), dan `?keadaan=` + `?cari=` menyaring.
 */
const f = (invoiceNo: string, keadaanTampil: string, storeName = "Toko Sinar Jaya", salesmanName: string | null = "Budi") => ({
  invoiceNo,
  keadaanTampil: keadaanTampil as never,
  storeName,
  salesmanName,
});

const baris = [
  f("INV/IMP/001", "jatuh_tempo"),
  f("INV/2026/0101", "klaim"),
  f("INV/2026/0090", "lunas"),
  f("INV/2026/0103", "lewat", "Toko Makmur", null),
];

describe("saringPiutang", () => {
  it("tanpa saringan: semua kecuali yang lunas", () => {
    expect(saringPiutang(baris, { keadaan: null, cari: "" }).map((b) => b.invoiceNo)).toEqual([
      "INV/IMP/001",
      "INV/2026/0101",
      "INV/2026/0103",
    ]);
  });

  it("saringan lunas menampilkan yang lunas saja", () => {
    expect(saringPiutang(baris, { keadaan: "lunas", cari: "" }).map((b) => b.invoiceNo)).toEqual(["INV/2026/0090"]);
  });

  it("lewat jatuh tempo terpisah dari lewat janji bayar", () => {
    expect(saringPiutang(baris, { keadaan: "jatuh_tempo", cari: "" }).map((b) => b.invoiceNo)).toEqual(["INV/IMP/001"]);
    expect(saringPiutang(baris, { keadaan: "lewat", cari: "" }).map((b) => b.invoiceNo)).toEqual(["INV/2026/0103"]);
  });

  it("mencari di nomor faktur, toko, dan salesman", () => {
    expect(saringPiutang(baris, { keadaan: null, cari: "makmur" }).map((b) => b.invoiceNo)).toEqual(["INV/2026/0103"]);
    expect(saringPiutang(baris, { keadaan: null, cari: "budi" })).toHaveLength(2);
    expect(saringPiutang(baris, { keadaan: null, cari: "0101" }).map((b) => b.invoiceNo)).toEqual(["INV/2026/0101"]);
  });

  it("mencari faktur lunas lewat nomornya tetap menemukannya", () => {
    // Tautan atau ketikan nomor faktur tertentu tidak boleh berakhir di "tidak ada".
    expect(saringPiutang(baris, { keadaan: null, cari: "INV/2026/0090" }).map((b) => b.invoiceNo)).toEqual(["INV/2026/0090"]);
  });
});
