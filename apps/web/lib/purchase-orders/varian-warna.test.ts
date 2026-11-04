import { describe, expect, it } from "vitest";
import {
  kunciWarnaBarang,
  labelWarna,
  normalisasiWarna,
  opsiVarianWarna,
  rencanaVarianWarna,
  skuVarianWarna,
  slugWarna,
  tcxDariLabel,
  warnaVarian,
} from "./varian-warna";

describe("nama dan SKU varian warna", () => {
  it("nama warna dirapikan, SKU = <SKU BAHAN>-<WARNA> huruf besar", () => {
    expect(normalisasiWarna("  abu   muda ")).toBe("ABU MUDA");
    expect(slugWarna("Abu Muda/2")).toBe("ABU-MUDA-2");
    expect(skuVarianWarna("fab-cot-001", "hitam pekat")).toBe("FAB-COT-001-HITAM-PEKAT");
  });
});

describe("rencanaVarianWarna", () => {
  it("bahan tanpa varian: kunci 'warna', Pantone opsional", () => {
    const r = rencanaVarianWarna(null, "FAB-001", " hitam ", "19-4005 TCX");
    expect(r).toEqual({
      ok: true,
      baris: { warna: "HITAM", sku: "FAB-001-HITAM", pantone: "19-4005 TCX" },
      semua: [{ warna: "HITAM", sku: "FAB-001-HITAM", pantone: "19-4005 TCX" }],
    });
    const tanpa = rencanaVarianWarna([], "FAB-001", "Navy");
    expect(tanpa.ok && tanpa.baris).toEqual({ warna: "NAVY", sku: "FAB-001-NAVY" });
  });

  it("mengikuti kunci warna yang sudah dipakai, termasuk varian berbentuk teks JSON", () => {
    const lama = JSON.stringify([{ Color: "BLUE", sku: "FAB-001-BLUE" }]);
    const r = rencanaVarianWarna(lama, "FAB-001", "merah");
    expect(r.ok && r.baris).toEqual({ Color: "MERAH", sku: "FAB-001-MERAH" });
    expect(r.ok && r.semua).toHaveLength(2);
    expect(kunciWarnaBarang([{ sku: "X", pantone: "1" }])).toBe("warna");
  });

  it("menolak kembar: SKU sama atau nama warna sama — SKU lamanya dikembalikan", () => {
    const lama = [{ warna: "HITAM", sku: "FAB-001-BLACK" }];
    expect(rencanaVarianWarna(lama, "FAB-001", "hitam")).toEqual({ ok: false, kode: "VARIAN_SUDAH_ADA", sku: "FAB-001-BLACK" });
    expect(rencanaVarianWarna([{ warna: "JET", sku: "fab-001-hitam" }], "FAB-001", "Hitam")).toEqual({
      ok: false,
      kode: "VARIAN_SUDAH_ADA",
      sku: "fab-001-hitam",
    });
  });

  it("menolak bahan yang variannya punya atribut lain", () => {
    const lama = [{ Color: "Blue", Wash: "Light", sku: "D-1" }];
    expect(rencanaVarianWarna(lama, "D", "Hitam")).toEqual({ ok: false, kode: "ATRIBUT_LAIN" });
    expect(rencanaVarianWarna([{ Size: "S", sku: "Z-S" }], "Z", "Hitam")).toEqual({ ok: false, kode: "ATRIBUT_LAIN" });
  });

  it("menolak nama warna kosong atau terlalu panjang", () => {
    expect(rencanaVarianWarna([], "F", "  -- ")).toEqual({ ok: false, kode: "WARNA_KOSONG" });
    expect(rencanaVarianWarna([], "F", "X".repeat(41))).toEqual({ ok: false, kode: "WARNA_TERLALU_PANJANG" });
  });
});

describe("warna varian untuk layar dan cetakan", () => {
  const varian = [
    { warna: "HITAM", sku: "F-HITAM", pantone: "19-4005 TCX" },
    { Color: "Navy", sku: "F-NAVY" },
    { Size: "L", sku: "F-L" },
  ];

  it("warna + Pantone dari SKU varian", () => {
    expect(warnaVarian(varian, "F-HITAM")).toEqual({ warna: "HITAM", pantone: "19-4005 TCX" });
    expect(warnaVarian(varian, "F-NAVY")).toEqual({ warna: "Navy", pantone: null });
    expect(warnaVarian(varian, "F-L")).toBeNull();
    expect(warnaVarian(varian, "")).toBeNull();
    expect(labelWarna({ warna: "HITAM", pantone: "19-4005 TCX" })).toBe("HITAM · 19-4005 TCX");
  });

  it("pilihan varian berlabel warna; varian tanpa warna memakai label bawaan", () => {
    expect(opsiVarianWarna(varian)).toEqual([
      { sku: "F-HITAM", label: "HITAM · 19-4005 TCX", pantone: "19-4005 TCX" },
      { sku: "F-NAVY", label: "Navy", pantone: null },
      { sku: "F-L", label: "F-L", pantone: null },
    ]);
  });

  it("kode TCX dari label tersimpan", () => {
    expect(tcxDariLabel("19-4005 TCX")).toBe("19-4005");
    expect(tcxDariLabel("tanpa")).toBeNull();
  });
});
