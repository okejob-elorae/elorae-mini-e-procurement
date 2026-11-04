import { describe, expect, it } from "vitest";
import { hasPushableChange, type PushableSnapshot } from "./jubelio-push-diff";

/*
 * Keputusan pemilik 2026-11-02: harga jual yang diketik menunggu konfirmasi di Jubelio →
 * Konfirmasi harga, jadi mengubah harga saja tidak memicu push produk. Isian lain tetap dikirim
 * otomatis (dengan harga terkonfirmasi).
 */
const dasar: PushableSnapshot = {
  nameId: "Kaos",
  nameEn: "Tee",
  description: "Kaos katun",
  variants: [{ sku: "K-M", Warna: "Hitam", Ukuran: "M" }],
  isActive: true,
};

describe("hasPushableChange", () => {
  it("perubahan harga saja bukan alasan push", () => {
    const sebelum = { ...dasar, sellingPrice: 100_000 };
    const sesudah = { ...dasar, sellingPrice: 120_000 };
    expect(hasPushableChange(sebelum, sesudah)).toBe(false);
  });

  it("tanpa perubahan apa pun bukan alasan push", () => {
    expect(hasPushableChange(dasar, { ...dasar })).toBe(false);
  });

  it.each([
    ["nama Indonesia", { nameId: "Kaos baru" }],
    ["nama Inggris", { nameEn: "New tee" }],
    ["deskripsi", { description: "Kaos katun combed" }],
    ["varian", { variants: [{ sku: "K-L", Warna: "Hitam", Ukuran: "L" }] }],
    ["status aktif", { isActive: false }],
  ])("perubahan %s tetap dikirim", (_label, ubah) => {
    expect(hasPushableChange(dasar, { ...dasar, ...ubah })).toBe(true);
  });

  it("urutan varian dan urutan atributnya tidak dianggap perubahan", () => {
    const a = { ...dasar, variants: [{ sku: "A", Warna: "Hitam", Ukuran: "M" }, { sku: "B", Warna: "Putih", Ukuran: "M" }] };
    const b = { ...dasar, variants: [{ Ukuran: "M", Warna: "Putih", sku: "B" }, { sku: "A", Ukuran: "M", Warna: "Hitam" }] };
    expect(hasPushableChange(a, b)).toBe(false);
  });
});
