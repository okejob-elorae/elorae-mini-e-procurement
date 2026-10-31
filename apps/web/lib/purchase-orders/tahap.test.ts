import { describe, expect, it } from "vitest";
import { MAKS_BAHAN_ISI, bacaPilihanBahan, tautanPoDariTahap } from "./tahap";

describe("tautanPoDariTahap", () => {
  it("semua yang kurang, atau bahan tertentu", () => {
    expect(tautanPoDariTahap("t1")).toBe("/backoffice/purchase-orders/new?planStageId=t1&isi=kurang");
    expect(tautanPoDariTahap("t 1", ["a", "b", "a", " "])).toBe(
      "/backoffice/purchase-orders/new?planStageId=t+1&isi=kurang&bahan=a%2Cb",
    );
  });
});

describe("bacaPilihanBahan", () => {
  it("dipisah koma, dirapikan, tanpa kembar", () => {
    expect(bacaPilihanBahan(" a, b ,,a")).toEqual(["a", "b"]);
    expect(bacaPilihanBahan(["a", "c"])).toEqual(["a", "c"]);
    expect(bacaPilihanBahan(undefined)).toEqual([]);
  });

  it("id terlalu panjang dilewati; jumlahnya dibatasi", () => {
    expect(bacaPilihanBahan(`${"x".repeat(65)},b`)).toEqual(["b"]);
    const banyak = Array.from({ length: 80 }, (_, i) => `i${i}`).join(",");
    expect(bacaPilihanBahan(banyak)).toHaveLength(MAKS_BAHAN_ISI);
  });
});
