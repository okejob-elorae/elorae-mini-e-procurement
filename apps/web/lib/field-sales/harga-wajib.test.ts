import { describe, expect, it } from "vitest";
import { BarangTanpaHargaError, KODE_TANPA_HARGA, barangTanpaHarga, hargaSah } from "./harga-wajib";

describe("hargaSah", () => {
  it("only a positive finite number is a price", () => {
    expect(hargaSah(35_000)).toBe(true);
    expect(hargaSah(0.5)).toBe(true);
    expect(hargaSah(0)).toBe(false);
    expect(hargaSah(-1)).toBe(false);
    expect(hargaSah(null)).toBe(false);
    expect(hargaSah(undefined)).toBe(false);
    expect(hargaSah(Number.NaN)).toBe(false);
    expect(hargaSah(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("barangTanpaHarga", () => {
  const harga = new Map<string, number | null>([
    ["kaos", 35_000],
    ["topi", null],
    ["gratis", 0],
  ]);

  it("names every item without a price once, in cart order — null, 0 and unknown items alike", () => {
    expect(barangTanpaHarga(["topi", "kaos", "gratis", "topi", "hilang"], harga)).toEqual(["topi", "gratis", "hilang"]);
  });

  it("is empty when every item is priced", () => {
    expect(barangTanpaHarga(["kaos", "kaos"], harga)).toEqual([]);
  });
});

describe("BarangTanpaHargaError", () => {
  it("carries the item ids and a stable code", () => {
    const e = new BarangTanpaHargaError(["topi"]);
    expect(e).toBeInstanceOf(Error);
    expect(e.itemIds).toEqual(["topi"]);
    expect(e.message).toBe(KODE_TANPA_HARGA);
    expect(KODE_TANPA_HARGA).toBe("BARANG_TANPA_HARGA");
  });
});
