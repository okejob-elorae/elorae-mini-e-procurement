import { describe, expect, it } from "vitest";
import type { GerakDokumen } from "@/lib/inventory/kartu-stok-queries";
import { hargaKeluar } from "./kembali-bahan";
import { dasarHargaKembali, gerakanKeluarBahan } from "./kembali-bahan-writer";

/*
 * Harga dan varian bahan yang kembali dibaca dari gerakan keluarnya di kartu stok, per
 * pengeluaran (`gerakStokPerDokumen` memilih satu sumber per dokumen). Buku besar stok tidak
 * menyimpan harga satuan: harganya |totalCost| ÷ |qty|. Pengeluaran yang nilainya tidak
 * tercatat (`null`) tidak boleh menurunkan harga sebagai Rp 0.
 */
const dokumen = (baris: GerakDokumen["baris"], sumber: GerakDokumen["sumber"] = "BUKU_BESAR"): GerakDokumen => ({
  total: baris.reduce((s, b) => s + b.totalCost, 0),
  baris,
  sumber,
});

describe("gerakanKeluarBahan", () => {
  it("kain 60 m keluar Rp 1.800.000 → 60 @ 30.000, tanpa varian tetap \"\"", () => {
    const gerak = new Map([["is1", dokumen([{ itemId: "kain", variantSku: "", qty: -60, totalCost: 1_800_000 }])]]);
    expect(gerakanKeluarBahan(gerak, "kain")).toEqual([{ qty: "60", unitCost: "30000", variantSku: "" }]);
  });

  it("hanya baris bahan yang diminta; bahan lain di pengeluaran yang sama tidak ikut", () => {
    const gerak = new Map([
      [
        "is1",
        dokumen([
          { itemId: "kain", variantSku: "", qty: -60, totalCost: 1_800_000 },
          { itemId: "kancing", variantSku: "", qty: -200, totalCost: 200_000 },
        ]),
      ],
    ]);
    expect(gerakanKeluarBahan(gerak, "kancing")).toEqual([{ qty: "200", unitCost: "1000", variantSku: "" }]);
  });

  it("pengeluaran lama (arsip) dan baru (buku besar) ditimbang bersama: 60 @ 30.000 + 20 @ 40.000 → 32.500", () => {
    const gerak = new Map([
      ["baru", dokumen([{ itemId: "kain", variantSku: "KN-M", qty: -60, totalCost: 1_800_000 }])],
      ["lama", dokumen([{ itemId: "kain", variantSku: "KN-M", qty: -20, totalCost: 800_000 }], "ARSIP")],
    ]);
    const g = gerakanKeluarBahan(gerak, "kain");
    expect(g.map((x) => x.variantSku)).toEqual(["KN-M", "KN-M"]);
    expect(hargaKeluar(g).toNumber()).toBe(32_500);
  });

  it("pengeluaran tanpa nilai tercatat (null) tidak menurunkan harga", () => {
    const gerak = new Map<string, GerakDokumen | null>([
      ["is1", dokumen([{ itemId: "kain", variantSku: "", qty: -60, totalCost: 1_800_000 }])],
      ["is2", null],
    ]);
    expect(hargaKeluar(gerakanKeluarBahan(gerak, "kain")).toNumber()).toBe(30_000);
  });

  it("tanpa gerakan sama sekali → kosong (harga 0, sama seperti sebelumnya)", () => {
    const gerak = new Map([["is1", dokumen([], "TANPA_GERAKAN")]]);
    expect(gerakanKeluarBahan(gerak, "kain")).toEqual([]);
    expect(hargaKeluar([]).toNumber()).toBe(0);
  });
});

/*
 * Keputusan pemilik 2026-11-01: pengeluaran yang nilainya tidak ada di kartu stok dinilai
 * dengan harga di DOKUMEN pengeluarannya (`avgCostAtIssue`), bukan Rp 0. Kartu stok tetap
 * lebih dulu untuk pengeluaran yang mencatat nilainya.
 */
describe("dasarHargaKembali", () => {
  const isu = (id: string, items: unknown[]) => ({ id, docNumber: `ISS-${id}`, items: JSON.stringify(items) });

  it("kartu stok bernilai → dipakai apa adanya, harga dokumen tidak dibaca (jalur biasa tidak berubah)", () => {
    const pengeluaran = [isu("is1", [{ itemId: "kain", qty: 10, avgCostAtIssue: 99_999 }])];
    const gerak = new Map([["is1", dokumen([{ itemId: "kain", variantSku: "", qty: -10, totalCost: 300_000 }])]]);
    const dasar = dasarHargaKembali(pengeluaran, gerak, "kain");
    expect(dasar).toEqual({ kartuStok: gerakanKeluarBahan(gerak, "kain"), dokumen: [], tanpaHarga: [] });
    expect(hargaKeluar([...dasar.kartuStok, ...dasar.dokumen]).toNumber()).toBe(30_000);
  });

  it("nilai kartu stok tidak tercatat (null) → harga dokumen: 10 m @ 30.000", () => {
    const pengeluaran = [isu("is1", [{ itemId: "kain", qty: 10, avgCostAtIssue: 30_000 }])];
    const dasar = dasarHargaKembali(pengeluaran, new Map([["is1", null]]), "kain");
    expect(dasar).toEqual({ kartuStok: [], dokumen: [{ qty: "10", unitCost: "30000" }], tanpaHarga: [] });
    expect(hargaKeluar(dasar.dokumen).toNumber()).toBe(30_000);
  });

  it("tanpa gerakan sama sekali (data di luar layar) → harga dokumen", () => {
    const pengeluaran = [isu("is1", [{ itemId: "kain", qty: 1_600, avgCostAtIssue: 37_000 }])];
    const dasar = dasarHargaKembali(pengeluaran, new Map([["is1", dokumen([], "TANPA_GERAKAN")]]), "kain");
    expect(dasar.dokumen).toEqual([{ qty: "1600", unitCost: "37000" }]);
  });

  it("per pengeluaran: yang bernilai dari kartu stok, yang tidak dari dokumen — 60 @ 30.000 + 20 @ 40.000 → 32.500", () => {
    const pengeluaran = [
      isu("is1", [{ itemId: "kain", qty: 60, avgCostAtIssue: 30_000 }]),
      isu("is2", [{ itemId: "kain", qty: 20, avgCostAtIssue: 40_000 }]),
    ];
    const gerak = new Map<string, GerakDokumen | null>([
      ["is1", dokumen([{ itemId: "kain", variantSku: "KN-M", qty: -60, totalCost: 1_800_000 }])],
      ["is2", null],
    ]);
    const dasar = dasarHargaKembali(pengeluaran, gerak, "kain");
    expect(dasar.kartuStok.map((g) => g.variantSku)).toEqual(["KN-M"]);
    expect(dasar.dokumen).toEqual([{ qty: "20", unitCost: "40000" }]);
    expect(hargaKeluar([...dasar.kartuStok, ...dasar.dokumen]).toNumber()).toBe(32_500);
  });

  it("pengeluaran tanpa nilai DAN dokumennya tanpa harga tidak ikut, dan nomornya dicatat; harga dari yang lain tetap", () => {
    const pengeluaran = [
      isu("is1", [{ itemId: "kain", qty: 60, avgCostAtIssue: 30_000 }]),
      isu("is2", [{ itemId: "kain", qty: 20 }]),
    ];
    const gerak = new Map<string, GerakDokumen | null>([
      ["is1", dokumen([{ itemId: "kain", variantSku: "", qty: -60, totalCost: 1_800_000 }])],
      ["is2", null],
    ]);
    const dasar = dasarHargaKembali(pengeluaran, gerak, "kain");
    expect(dasar.dokumen).toEqual([]);
    expect(dasar.tanpaHarga).toEqual(["ISS-is2"]);
    expect(hargaKeluar(dasar.kartuStok).toNumber()).toBe(30_000);
  });

  it("tidak ada dasar sama sekali → kartu stok dan dokumen kosong, nomor dokumen tanpa harga disebut", () => {
    const pengeluaran = [isu("is1", [{ itemId: "kain", qty: 10, unitCost: 25_000 }, { itemId: "kancing", qty: 5, avgCostAtIssue: 1_000 }])];
    const dasar = dasarHargaKembali(pengeluaran, new Map([["is1", null]]), "kain");
    expect(dasar).toEqual({ kartuStok: [], dokumen: [], tanpaHarga: ["ISS-is1"] });
  });

  it("baris dokumen qty 0 atau bahan lain tidak dihitung", () => {
    const pengeluaran = [isu("is1", [{ itemId: "kain", qty: 0, avgCostAtIssue: 30_000 }, { itemId: "kancing", qty: 5, avgCostAtIssue: 1_000 }])];
    expect(dasarHargaKembali(pengeluaran, new Map([["is1", null]]), "kain")).toEqual({ kartuStok: [], dokumen: [], tanpaHarga: [] });
  });
});
