import { describe, it, expect, vi } from "vitest";
import {
  bacaAngkaMinimum,
  bacaAturanMinimum,
  KUNCI_MIN_PERTAMA,
  KUNCI_MIN_ULANG,
  MIN_PESANAN_BAWAAN,
  minimumBarang,
  minimumToko,
} from "./minimum-pesanan";
import { muatMinimumToko } from "./minimum-toko";

describe("bacaAngkaMinimum", () => {
  it("reads a non-negative integer", () => {
    expect(bacaAngkaMinimum("6")).toBe(6);
    expect(bacaAngkaMinimum(" 12 ")).toBe(12);
    expect(bacaAngkaMinimum("0")).toBe(0);
  });
  it("treats empty, missing and garbage as not set", () => {
    expect(bacaAngkaMinimum(null)).toBeNull();
    expect(bacaAngkaMinimum(undefined)).toBeNull();
    expect(bacaAngkaMinimum("")).toBeNull();
    expect(bacaAngkaMinimum("abc")).toBeNull();
    expect(bacaAngkaMinimum("-3")).toBeNull();
    expect(bacaAngkaMinimum("2.5")).toBeNull();
  });
});

describe("bacaAturanMinimum", () => {
  it("defaults to 6 for both tiers when nothing is set — behaviour unchanged", () => {
    expect(bacaAturanMinimum(null, null)).toEqual({ pertama: MIN_PESANAN_BAWAAN, ulang: MIN_PESANAN_BAWAAN, pertamaDiatur: false, ulangDiatur: false });
  });
  it("the reorder minimum follows the first-order minimum until the owner sets it", () => {
    expect(bacaAturanMinimum("12", null)).toEqual({ pertama: 12, ulang: 12, pertamaDiatur: true, ulangDiatur: false });
  });
  it("both tiers set", () => {
    expect(bacaAturanMinimum("12", "3")).toEqual({ pertama: 12, ulang: 3, pertamaDiatur: true, ulangDiatur: true });
  });
  it("only the reorder tier set", () => {
    expect(bacaAturanMinimum(null, "3")).toEqual({ pertama: 6, ulang: 3, pertamaDiatur: false, ulangDiatur: true });
  });
});

describe("minimumToko / minimumBarang", () => {
  const aturan = bacaAturanMinimum("12", "3");
  it("a store without an approved order gets the first-order minimum", () => {
    expect(minimumToko(aturan, false)).toEqual({ min: 12, jenis: "PERTAMA" });
  });
  it("a store with an approved order gets the reorder minimum", () => {
    expect(minimumToko(aturan, true)).toEqual({ min: 3, jenis: "ULANG" });
  });
  it("an item's own minimum wins over either tier and carries no tier", () => {
    expect(minimumBarang(2, { min: 3, jenis: "ULANG" })).toEqual({ min: 2, jenis: null });
    expect(minimumBarang(0, { min: 3, jenis: "ULANG" })).toEqual({ min: 0, jenis: null });
    expect(minimumBarang(null, { min: 3, jenis: "ULANG" })).toEqual({ min: 3, jenis: "ULANG" });
  });
});

describe("muatMinimumToko (stub client)", () => {
  const klien = (setelan: Array<{ key: string; value: string }>, adaDisetujui: boolean) => ({
    systemSetting: { findMany: vi.fn().mockResolvedValue(setelan) },
    fieldSalesOrder: { findFirst: vi.fn().mockResolvedValue(adaDisetujui ? { id: "o1" } : null) },
  });

  it("reorder store reads the reorder key", async () => {
    const k = klien([{ key: KUNCI_MIN_PERTAMA, value: "10" }, { key: KUNCI_MIN_ULANG, value: "4" }], true);
    const r = await muatMinimumToko("s1", k as never);
    expect(r).toMatchObject({ min: 4, jenis: "ULANG" });
    // "Pesan ulang" hanya dibuktikan pesanan PUTUS yang DISETUJUI di toko ini.
    expect(k.fieldSalesOrder.findFirst).toHaveBeenCalledWith({
      where: { storeId: "s1", orderType: "PUTUS", status: "APPROVED" },
      select: { id: true },
    });
  });

  it("first-order store with nothing set falls back to 6", async () => {
    const r = await muatMinimumToko("s1", klien([], false) as never);
    expect(r).toMatchObject({ min: 6, jenis: "PERTAMA" });
  });
});
