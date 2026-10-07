import { describe, expect, it } from "vitest";
import { kesehatanStokPerBarang } from "./kesehatan-stok";

/*
 * "Stok menipis" dan "Stok habis" di Beranda memakai definisi YANG SAMA dengan
 * ringkasan Inventori (`getInventorySnapshot` → `summarizeStockHealth`): per
 * BARANG (semua varian dijumlah), tersedia = di tangan − dipesan, dan satu
 * barang hanya di satu kelompok (minus > habis > menipis). Dulu Beranda
 * membandingkan stok di tangan (bukan tersedia) dengan titik pesan ulang dan
 * ikut menghitung barang yang habis dan minus.
 */
describe("kesehatanStokPerBarang", () => {
  const baris = [
    // A: dua varian, 3 + 4 di tangan, 2 dipesan → tersedia 5 ≤ titik 10 → menipis
    { itemId: "A", qtyOnHand: 3, reservedQty: 0, reorderPoint: 10 },
    { itemId: "A", qtyOnHand: 4, reservedQty: 2, reorderPoint: 10 },
    // B: tersedia 0 → habis (bukan menipis), walau titik pesan ulang ada
    { itemId: "B", qtyOnHand: 5, reservedQty: 5, reorderPoint: 10 },
    // C: tersedia −1 → minus
    { itemId: "C", qtyOnHand: 1, reservedQty: 2, reorderPoint: 10 },
    // D: di tangan 8 ≤ 10 tetapi 8 dipesan → tersedia 0 → habis (dulu: menipis)
    { itemId: "D", qtyOnHand: 8, reservedQty: 8, reorderPoint: null },
    // E: tanpa titik pesan ulang, tersedia 3 → aman
    { itemId: "E", qtyOnHand: 3, reservedQty: 0, reorderPoint: null },
    // F: tersedia 50 > 10 → aman
    { itemId: "F", qtyOnHand: 50, reservedQty: 0, reorderPoint: "10" },
  ];

  it("menipis, habis, dan minus per barang, satu kelompok per barang", () => {
    expect(kesehatanStokPerBarang(baris)).toEqual({ menipis: 1, habis: 2, minus: 1 });
  });

  it("tanpa baris: semua nol", () => {
    expect(kesehatanStokPerBarang([])).toEqual({ menipis: 0, habis: 0, minus: 0 });
  });
});
