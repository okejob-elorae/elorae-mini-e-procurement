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

describe("saringan jenis tagihan — konsi / non-konsi (keputusan 2026-10-29)", () => {
  const dgnJenis = [
    { ...f("INV/2026/0201", "belum"), outstanding: 1_000, konsi: false },
    { ...f("KNS/2026/0001", "belum", "Toko Titip"), outstanding: 5_000, konsi: true },
    { ...f("KNS/2026/0002", "jatuh_tempo", "Toko Titip"), outstanding: 7_000, konsi: true },
    { ...f("INV/2026/0202", "jatuh_tempo"), outstanding: 2_000 },
  ];

  it("tanpa jenis: semuanya", () => {
    expect(saringPiutang(dgnJenis, { keadaan: null, cari: "" })).toHaveLength(4);
    expect(saringPiutang(dgnJenis, { keadaan: null, cari: "", jenis: null })).toHaveLength(4);
  });

  it("konsi saja / non-konsi saja; baris tanpa penanda dibaca non-konsi", () => {
    expect(saringPiutang(dgnJenis, { keadaan: null, cari: "", jenis: "konsi" }).map((b) => b.invoiceNo)).toEqual([
      "KNS/2026/0001",
      "KNS/2026/0002",
    ]);
    expect(saringPiutang(dgnJenis, { keadaan: null, cari: "", jenis: "nonkonsi" }).map((b) => b.invoiceNo)).toEqual([
      "INV/2026/0201",
      "INV/2026/0202",
    ]);
  });

  it("jenis bergabung dengan keadaan dan cari", () => {
    expect(
      saringPiutang(dgnJenis, { keadaan: "jatuh_tempo", cari: "", jenis: "konsi" }).map((b) => b.invoiceNo),
    ).toEqual(["KNS/2026/0002"]);
    expect(saringPiutang(dgnJenis, { keadaan: null, cari: "0001", jenis: "nonkonsi" })).toHaveLength(0);
  });

  it("angka pil mengikuti jenis", () => {
    const pil = hitungPilPiutang(dgnJenis, "", "konsi");
    expect(pil.semua).toEqual({ jumlah: 2, nilai: 12_000 });
    expect(pil.perKeadaan.jatuh_tempo).toEqual({ jumlah: 1, nilai: 7_000 });
    expect(pil.perKeadaan.belum).toEqual({ jumlah: 1, nilai: 5_000 });
  });
});

describe("P46 — nota sebagian ditahan yang bagian bebasnya lewat tempo", () => {
  const dgnTahanan = [
    { ...f("INV/2026/0301", "jatuh_tempo"), outstanding: 1_000 },
    {
      ...f("INV/2026/0302", "tertahan"),
      outstanding: 700,
      alasan: { lewatTempoDiLuarTahanan: { hari: 30, nilai: 400 } },
    },
    { ...f("INV/2026/0303", "tertahan"), outstanding: 500, alasan: {} },
  ];

  it("masuk saringan lewat jatuh tempo DAN tetap di saringan tertahan", () => {
    expect(saringPiutang(dgnTahanan, { keadaan: "jatuh_tempo", cari: "" }).map((b) => b.invoiceNo)).toEqual([
      "INV/2026/0301",
      "INV/2026/0302",
    ]);
    expect(saringPiutang(dgnTahanan, { keadaan: "tertahan", cari: "" }).map((b) => b.invoiceNo)).toEqual([
      "INV/2026/0302",
      "INV/2026/0303",
    ]);
  });

  it("nilai pil lewat jatuh tempo menghitung bagian bebasnya saja (400, bukan 700)", () => {
    const pil = hitungPilPiutang(dgnTahanan, "");
    expect(pil.perKeadaan.jatuh_tempo).toEqual({ jumlah: 2, nilai: 1_400 });
    expect(pil.perKeadaan.tertahan).toEqual({ jumlah: 2, nilai: 1_200 });
  });

  it("angka setiap pil = panjang daftarnya", () => {
    const pil = hitungPilPiutang(dgnTahanan, "");
    for (const [k, j] of Object.entries(pil.perKeadaan)) {
      expect(j.jumlah).toBe(saringPiutang(dgnTahanan, { keadaan: k as never, cari: "" }).length);
    }
  });
});
