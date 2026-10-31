import { describe, expect, it } from "vitest";
import { nilaiHitunganAwal, untukPenghitung } from "./nilai";
import type { MenungguGudang } from "@/lib/receivables/pwa-queries";

describe("nilaiHitunganAwal", () => {
  it("sums received qty × line price when the lines carry prices (consignment)", () => {
    expect(nilaiHitunganAwal([{ price: 100_000 }, { price: 50_000 }], [1, 1], 0)).toBe(150_000);
  });

  it("values unpriced lines (sold-outright store) at the store note's value per piece", () => {
    // Nota toko 400.000 untuk 4 potong → 100.000 per potong; 3 sampai.
    expect(nilaiHitunganAwal([{ price: 0 }, { price: 0 }], [3, 0], 100_000)).toBe(300_000);
  });

  it("never counts a negative quantity", () => {
    expect(nilaiHitunganAwal([{ price: 10 }], [-5], 0)).toBe(0);
  });

  it("an unfilled row counts as nothing, not as the claim", () => {
    expect(nilaiHitunganAwal([{ price: 0 }], [Number.NaN], 100_000)).toBe(0);
  });
});

describe("untukPenghitung — the counting screen never receives the claim", () => {
  const nota: MenungguGudang = {
    id: "nrt1",
    noNrt: "NRT-4471",
    storeName: "Toko Sinar",
    tanggal: "2026-10-01T00:00:00.000Z",
    nilaiKlaim: 400_000,
    caraKirim: "SALES",
    adaFoto: true,
    dariSpg: true,
    baris: [
      { itemId: "i1", variantSku: "K-M", itemName: "Kemeja M", qty: 3, price: 0, condition: "LAYAK" },
      { itemId: "i2", variantSku: "", itemName: "Blus", qty: 1, price: 0, condition: "RUSAK" },
    ],
  };

  it("drops the claimed quantities and the claimed value from the payload", () => {
    const n = untukPenghitung(nota, "gudang1", null);
    const json = JSON.stringify(n);
    expect(json).not.toContain("nilaiKlaim");
    expect(json).not.toContain('"qty"');
    expect(json).not.toContain("400000");
    expect(n.baris.map((b) => b.itemName)).toEqual(["Kemeja M", "Blus"]);
  });

  it("carries the per-piece value of an unpriced note instead", () => {
    expect(untukPenghitung(nota, "gudang1", null).nilaiPerPotong).toBe(100_000);
  });

  it("has no per-piece value when the lines are priced (consignment)", () => {
    const n = untukPenghitung({ ...nota, baris: [{ ...nota.baris[0], price: 80_000 }] }, "gudang1", null);
    expect(n.nilaiPerPotong).toBe(0);
    expect(n.baris[0].price).toBe(80_000);
  });

  it("marks the note the counter reported themselves", () => {
    expect(untukPenghitung(nota, "s1", "s1").milikSendiri).toBe(true);
    expect(untukPenghitung(nota, "gudang1", "s1").milikSendiri).toBe(false);
    expect(untukPenghitung(nota, "gudang1", null).milikSendiri).toBe(false);
  });
});
