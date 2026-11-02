import { describe, expect, it } from "vitest";
import { normalizeItemPayload } from "./mutations";

/*
 * Target margin dan biaya tambahan barang jadi kembali dibaca dari formulir —
 * sebagai bahan rekomendasi harga saja (keputusan pemilik 2026-11-01).
 * Penyimpannya tidak pernah menghitung harga jual dari angka ini.
 */

const dasar = { nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId: "u1" };

describe("normalizeItemPayload — bahan rekomendasi harga", () => {
  it("tidak dikirim → tidak disentuh (undefined), supaya klien lain tidak mengosongkannya", () => {
    const p = normalizeItemPayload(dasar);
    expect(p.targetMarginPercent).toBeUndefined();
    expect(p.additionalCost).toBeUndefined();
  });

  it("kosong → dikosongkan (null); angka dan teks angka diterima, koma desimal juga", () => {
    expect(normalizeItemPayload({ ...dasar, targetMarginPercent: "", additionalCost: null })).toMatchObject({
      targetMarginPercent: null,
      additionalCost: null,
    });
    expect(normalizeItemPayload({ ...dasar, targetMarginPercent: 40, additionalCost: "2000" })).toMatchObject({
      targetMarginPercent: 40,
      additionalCost: 2_000,
    });
    expect(normalizeItemPayload({ ...dasar, targetMarginPercent: "12,5" }).targetMarginPercent).toBe(12.5);
  });

  it("bukan angka → NaN (ditolak saat simpan), bukan diam-diam 0", () => {
    expect(normalizeItemPayload({ ...dasar, targetMarginPercent: "abc" }).targetMarginPercent).toBeNaN();
  });

  it("bahan dan aksesori tidak punya harga jual: kolomnya tidak disentuh", () => {
    const p = normalizeItemPayload({ ...dasar, type: "FABRIC", targetMarginPercent: 40, additionalCost: 1_000 });
    expect(p.targetMarginPercent).toBeUndefined();
    expect(p.additionalCost).toBeUndefined();
  });
});
