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

/*
 * Jawaban pemilik 2026-11-02: P4 (persen rekomendasi diisi sebagai markup ATAU margin) dan P3
 * (saluran jual dipilih dengan dua centang). Keduanya hanya untuk barang jadi.
 */
describe("normalizeItemPayload — dasar aturan harga dan saluran jual", () => {
  it("dasar MARKUP/MARGIN dibaca; tidak dikirim → tidak disentuh; nilai lain ditolak", () => {
    expect(normalizeItemPayload({ ...dasar, priceRuleBasis: "MARGIN" }).priceRuleBasis).toBe("MARGIN");
    expect(normalizeItemPayload(dasar).priceRuleBasis).toBeUndefined();
    expect(() => normalizeItemPayload({ ...dasar, priceRuleBasis: "PERSEN" })).toThrow(/priceRuleBasis/);
  });

  it("saluran jual dibaca; kosong → tidak disentuh; nilai lain ditolak", () => {
    expect(normalizeItemPayload({ ...dasar, salesChannel: "OFFLINE" }).salesChannel).toBe("OFFLINE");
    expect(normalizeItemPayload({ ...dasar, salesChannel: "" }).salesChannel).toBeUndefined();
    expect(() => normalizeItemPayload({ ...dasar, salesChannel: "TOKO" })).toThrow(/salesChannel/);
  });

  it("bahan dan aksesori: dasar dan saluran tidak disentuh", () => {
    const p = normalizeItemPayload({ ...dasar, type: "FABRIC", salesChannel: "TOKO", priceRuleBasis: "X" });
    expect(p.salesChannel).toBeUndefined();
    expect(p.priceRuleBasis).toBeUndefined();
  });
});
