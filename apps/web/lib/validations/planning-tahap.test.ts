import { describe, expect, it } from "vitest";
import {
  KOLOM_TAHAP_BERJALAN,
  createPlanStageSchema,
  rapikanVarianTahap,
  tolakUbahTahap,
  updatePlanStageSchema,
  varianTahapSah,
} from "./planning";

/* Aturan murni tahap Plan Kerja: varian, bulan, dan kolom yang tetap boleh diubah sesudah plan dikunci. */

describe("rapikanVarianTahap", () => {
  it("undefined = tidak diubah; kosong/spasi = null; sisanya dipangkas", () => {
    expect(rapikanVarianTahap(undefined)).toBeUndefined();
    expect(rapikanVarianTahap(null)).toBeNull();
    expect(rapikanVarianTahap("   ")).toBeNull();
    expect(rapikanVarianTahap(" KMJ-01-M ")).toBe("KMJ-01-M");
  });
});

describe("varianTahapSah", () => {
  const varian = JSON.stringify([{ sku: "KMJ-01-M" }, { SKU: "KMJ-01-L" }, { sku: "  " }]);
  it("hanya SKU varian barang itu (JSON teks atau larik, kunci huruf besar/kecil)", () => {
    expect(varianTahapSah("KMJ-01-M", varian)).toBe(true);
    expect(varianTahapSah("KMJ-01-L", varian)).toBe(true);
    expect(varianTahapSah("KMJ-01-M", [{ sku: "KMJ-01-M" }])).toBe(true);
    expect(varianTahapSah("KMJ-01-XL", varian)).toBe(false);
    expect(varianTahapSah("", varian)).toBe(false);
    expect(varianTahapSah("KMJ-01-M", null)).toBe(false);
    expect(varianTahapSah("KMJ-01-M", "bukan json")).toBe(false);
  });
});

describe("tolakUbahTahap", () => {
  it("plan draf: semua kolom boleh, kecuali varian selama WO hidup", () => {
    expect(tolakUbahTahap({ planBisaDiubah: true, kolomBerubah: ["name", "targetQty"], woHidup: false })).toBeNull();
    expect(tolakUbahTahap({ planBisaDiubah: true, kolomBerubah: ["supplierId"], woHidup: true })).toBeNull();
    expect(tolakUbahTahap({ planBisaDiubah: true, kolomBerubah: ["variantSku"], woHidup: true })).toBe(
      "SUDAH_ADA_WO"
    );
  });

  it("plan terkunci: hanya bulan, varian, penjahit; penjahit juga beku selama WO hidup", () => {
    expect([...KOLOM_TAHAP_BERJALAN].sort()).toEqual(["supplierId", "targetMonth", "variantSku"]);
    expect(
      tolakUbahTahap({ planBisaDiubah: false, kolomBerubah: ["targetMonth", "variantSku", "supplierId"], woHidup: false })
    ).toBeNull();
    expect(tolakUbahTahap({ planBisaDiubah: false, kolomBerubah: ["targetMonth", "name"], woHidup: false })).toBe(
      "PLAN_TERKUNCI"
    );
    expect(tolakUbahTahap({ planBisaDiubah: false, kolomBerubah: ["fabricNotes"], woHidup: false })).toBe(
      "PLAN_TERKUNCI"
    );
    expect(tolakUbahTahap({ planBisaDiubah: false, kolomBerubah: ["supplierId"], woHidup: true })).toBe(
      "SUDAH_ADA_WO"
    );
    expect(tolakUbahTahap({ planBisaDiubah: false, kolomBerubah: ["targetMonth"], woHidup: true })).toBeNull();
  });
});

describe("skema tahap", () => {
  it("bulan 1–12 bulat, varian paling panjang 191", () => {
    const dasar = { planCategoryId: "c1", name: "A", targetQty: 1 };
    expect(createPlanStageSchema.safeParse({ ...dasar, targetMonth: 12, variantSku: "X" }).success).toBe(true);
    expect(createPlanStageSchema.safeParse({ ...dasar, targetMonth: 0 }).success).toBe(false);
    expect(createPlanStageSchema.safeParse({ ...dasar, targetMonth: 13 }).success).toBe(false);
    expect(createPlanStageSchema.safeParse({ ...dasar, variantSku: "x".repeat(192) }).success).toBe(false);
    expect(updatePlanStageSchema.safeParse({ targetMonth: null, variantSku: null }).success).toBe(true);
    expect(updatePlanStageSchema.safeParse({ targetMonth: 6.5 }).success).toBe(false);
  });
});
