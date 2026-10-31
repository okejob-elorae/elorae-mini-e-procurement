import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isianAwalBarang, isianKembaran, kembaranBaris } from "./baris-kembar";

// Opname lama: dua baris hitung (stok null 3 + "" 4) untuk satu kaos tanpa varian.
const lama = [
  { id: "r1", itemId: "kaos", variantSku: null, countedQty: null },
  { id: "r2", itemId: "kaos", variantSku: null, countedQty: null },
  { id: "r3", itemId: "kemeja", variantSku: "KMJ-M", countedQty: 2 },
];

describe("baris hitung kembar di layar hitung buta", () => {
  it("groups only rows of the same item and variant; the first row is the one shown", () => {
    expect(kembaranBaris(lama)).toEqual(new Map([["r1", ["r2"]]]));
    expect(kembaranBaris([{ id: "a", itemId: "x", variantSku: null }, { id: "b", itemId: "x", variantSku: "" }])).toEqual(
      new Map([["a", ["b"]]]),
    );
  });

  it("counting 7 on the shown row writes 0 to its twin, so approval sums 7 — not 14", () => {
    const k = kembaranBaris(lama);
    const isian: Record<string, string> = { ...isianAwalBarang(lama), r1: "7", ...isianKembaran(k, "r1", "7") };
    expect(isian).toEqual({ r1: "7", r2: "0", r3: "2" });
    const total = Number(isian.r1) + Number(isian.r2);
    expect(total).toBe(7);
    // Dikosongkan lagi: kembarannya ikut kosong (belum dihitung, bukan nol).
    expect(isianKembaran(k, "r1", "")).toEqual({ r2: "" });
    expect(isianKembaran(k, "r3", "5")).toEqual({});
  });

  it("counts already saved on both twins (3 and 4) open as 7 on the shown row and 0 on the twin", () => {
    const rows = [
      { id: "r1", itemId: "kaos", variantSku: null, countedQty: 3 },
      { id: "r2", itemId: "kaos", variantSku: "", countedQty: "4" },
    ];
    expect(isianAwalBarang(rows)).toEqual({ r1: "7", r2: "0" });
  });

  it("the counting screen shows one row per twin group and fills the twin on every commit", () => {
    const sumber = readFileSync(path.join(__dirname, "StockOpnameCountPageClient.tsx"), "utf8");
    expect(sumber).toContain("isianAwalBarang(");
    expect(sumber).toContain("isianKembaran(");
    expect(sumber).toMatch(/tersembunyi\.has\(/);
  });
});
