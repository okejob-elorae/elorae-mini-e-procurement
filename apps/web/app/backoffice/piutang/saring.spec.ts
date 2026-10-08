import { describe, expect, it } from "vitest";
import { hitungPilPiutang, saringPiutang } from "./saring";

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

describe("hitungPilPiutang", () => {
  const dgnSisa = [
    { ...f("INV/IMP/001", "jatuh_tempo"), outstanding: 1_000 },
    { ...f("INV/2026/0101", "klaim"), outstanding: 2_000 },
    { ...f("INV/2026/0090", "lunas"), outstanding: 0 },
    { ...f("INV/2026/0103", "lewat", "Toko Makmur", null), outstanding: 4_000 },
    { ...f("INV/2026/0104", "lewat", "Toko Anggrek", null), outstanding: 8_000 },
  ];

  it("tanpa cari: angka pil = isi daftar tiap saringan", () => {
    const pil = hitungPilPiutang(dgnSisa, "");
    expect(pil.semua).toEqual({ jumlah: 4, nilai: 15_000 });
    expect(pil.perKeadaan.lewat).toEqual({ jumlah: 2, nilai: 12_000 });
    expect(pil.perKeadaan.lunas).toEqual({ jumlah: 1, nilai: 0 });
    expect(pil.perKeadaan.tertahan).toEqual({ jumlah: 0, nilai: 0 });
  });

  it("angka pil mengikuti kotak cari", () => {
    // Dulu pil tetap "Belum lunas 4" walau pencarian menyisakan satu baris.
    const pil = hitungPilPiutang(dgnSisa, "anggrek");
    expect(pil.semua).toEqual({ jumlah: 1, nilai: 8_000 });
    expect(pil.perKeadaan.lewat.jumlah).toBe(1);
    expect(pil.perKeadaan.jatuh_tempo.jumlah).toBe(0);
  });

  it("setiap angka pil sama dengan jumlah baris saringannya", () => {
    for (const cari of ["", "budi", "makmur", "0090", "zzz"]) {
      const pil = hitungPilPiutang(dgnSisa, cari);
      expect(pil.semua.jumlah).toBe(saringPiutang(dgnSisa, { keadaan: null, cari }).length);
      for (const [k, j] of Object.entries(pil.perKeadaan)) {
        expect(j.jumlah).toBe(saringPiutang(dgnSisa, { keadaan: k as never, cari }).length);
      }
    }
  });
});
