import { describe, expect, it } from "vitest";
import type { GerakDokumen } from "@/lib/inventory/kartu-stok-queries";
import { hargaKeluar } from "./kembali-bahan";
import { gerakanKeluarBahan } from "./kembali-bahan-writer";

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
