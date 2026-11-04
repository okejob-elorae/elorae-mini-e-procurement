import { describe, expect, it } from "vitest";
import { bacaLembarHpp, petakanBerkasKeStok, pratinjauPersediaan, type BarisStok } from "./persediaan";

function stok(ivId: string, itemId: string, skuBarang: string, variantSku: string | null, tipe: string, qty: number, avgCost = 0): BarisStok {
  return { ivId, itemId, skuBarang, variantSku, nama: skuBarang, tipe, qty, avgCost, totalValue: Math.round(qty * avgCost * 100) / 100 };
}

const STOK: BarisStok[] = [
  stok("iv1", "gms", "GMS", "GMS-S", "FINISHED_GOOD", 10),
  stok("iv2", "gms", "GMS", "GMS-M", "FINISHED_GOOD", 20),
  stok("iv3", "gms", "GMS", "GMS-L", "FINISHED_GOOD", 0),
  stok("iv4", "kain", "KN-RYN", null, "FABRIC", 20.2, 26455.65),
  stok("iv5", "kancing", "AK-KCG", "", "ACCESSORIES", -5),
];

describe("bacaLembarHpp", () => {
  it("menemukan judul walau ada baris pembuka, mendahulukan kolom 'HPP baru'", () => {
    const h = bacaLembarHpp([
      ["Daftar persediaan per 1 Agu"],
      [],
      ["SKU", "HPP sekarang", "HPP baru"],
      ["GMS-S", 1, "90.000"],
      ["GMS-M", 1, "x"],
      ["GMS-S", 1, 5],
      ["KN-RYN", 1, -1],
    ]);
    expect(h.baris).toEqual([{ baris: 4, sku: "GMS-S", hpp: 90000 }]);
    expect(h.galat).toEqual([
      { baris: 5, sku: "GMS-M", sebab: "HPP_TIDAK_TERBACA" },
      { baris: 6, sku: "GMS-S", sebab: "SKU_GANDA" },
      { baris: 7, sku: "KN-RYN", sebab: "HPP_NEGATIF" },
    ]);
  });

  it("tanpa kolom SKU/HPP → tanpaJudul", () => {
    expect(bacaLembarHpp([["Kode", "Harga jual"], ["A", 1]]).tanpaJudul).toBe(true);
  });
});

describe("petakanBerkasKeStok", () => {
  it("SKU varian mengenai variannya; SKU barang mengenai varian lain yang tidak disebut; tak dikenal dilaporkan", () => {
    const { isian, tidakDikenal } = petakanBerkasKeStok(
      [
        { baris: 2, sku: "gms", hpp: 120000 },
        { baris: 3, sku: "GMS-M", hpp: 125000 },
        { baris: 4, sku: "KN-RYN", hpp: 27000 },
        { baris: 5, sku: "TIDAK-ADA", hpp: 1 },
      ],
      STOK,
    );
    const per = Object.fromEntries(isian.map((i) => [`${i.itemId}/${i.variantSku}`, i.hpp]));
    expect(per).toEqual({ "gms/GMS-M": 125000, "gms/GMS-S": 120000, "gms/GMS-L": 120000, "kain/null": 27000 });
    expect(tidakDikenal).toEqual([{ baris: 5, sku: "TIDAK-ADA" }]);
  });
});

describe("pratinjauPersediaan", () => {
  it("nilai yang dijurnal = nilai baru − nilai stok sekarang, per peran, dalam sen", () => {
    const p = pratinjauPersediaan(
      [
        { itemId: "gms", variantSku: "GMS-S", hpp: 120000 },
        { itemId: "gms", variantSku: "GMS-L", hpp: 120000 },
        { itemId: "kain", variantSku: null, hpp: 27000 },
        { itemId: "kancing", variantSku: null, hpp: 350 },
        { itemId: "hantu", variantSku: null, hpp: 1 },
      ],
      STOK,
    );
    expect(p.selisihPerPeranSen.INVENTORY_FG).toBe(120000000); // 10 × 120.000
    // kain: 20,2 × 27.000 = 545.400 − 534.404,13 (sudah bernilai) = 10.995,87; kancing: −5 × 350 = −1.750
    expect(p.selisihPerPeranSen.INVENTORY).toBe(1099587 - 175000);
    expect(p.tidakDikenal).toEqual([{ sku: "hantu" }]);
    const kain = p.baris.find((b) => b.itemId === "kain")!;
    expect(kain).toMatchObject({ nilaiLama: 534404.13, nilaiBaru: 545400, selisih: 10995.87, peringatan: ["HPP_LAMA_BEDA"], peran: "INVENTORY" });
    expect(p.baris.find((b) => b.variantSku === "GMS-L")?.peringatan).toEqual(["QTY_NOL"]);
    // Varian "" pada stok cocok dengan isian tanpa varian.
    expect(p.baris.find((b) => b.itemId === "kancing")).toMatchObject({ peringatan: ["QTY_NEGATIF"], selisih: -1750 });
    expect(p.totalSelisih).toBe(1_200_000 + 10995.87 - 1750);
  });
});
