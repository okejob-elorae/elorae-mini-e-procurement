import { describe, it, expect } from "vitest";
import { peranPersediaan, nilaiPerPeranPersediaan, bagiTotalPerPeranPersediaan } from "./peran-persediaan";

describe("peranPersediaan", () => {
  it("barang jadi → INVENTORY_FG, bahan (kain/aksesori) → INVENTORY", () => {
    expect(peranPersediaan("FINISHED_GOOD")).toBe("INVENTORY_FG");
    expect(peranPersediaan("FABRIC")).toBe("INVENTORY");
    expect(peranPersediaan("ACCESSORIES")).toBe("INVENTORY");
  });

  it("tipe tidak diketahui tetap INVENTORY (perilaku lama)", () => {
    expect(peranPersediaan(null)).toBe("INVENTORY");
    expect(peranPersediaan(undefined)).toBe("INVENTORY");
  });
});

describe("nilaiPerPeranPersediaan", () => {
  it("menjumlah per peran dalam sen, urutan tetap, kelompok nol dibuang", () => {
    expect(
      nilaiPerPeranPersediaan([
        { tipeBarang: "FINISHED_GOOD", nilai: 89786.44 },
        { tipeBarang: "FABRIC", nilai: 0.1 },
        { tipeBarang: "FINISHED_GOOD", nilai: 81222.22 },
        { tipeBarang: "ACCESSORIES", nilai: 0.2 },
      ]),
    ).toEqual([
      { role: "INVENTORY", nilai: 0.3 },
      { role: "INVENTORY_FG", nilai: 171008.66 },
    ]);
    expect(nilaiPerPeranPersediaan([{ tipeBarang: "FABRIC", nilai: 0 }])).toEqual([]);
  });

  it("Σ hasil = Σ masukan, tanpa sisa pecahan sen", () => {
    const baris = Array.from({ length: 30 }, (_, i) => ({ tipeBarang: i % 3 ? "FINISHED_GOOD" : "FABRIC", nilai: 0.1 }));
    const hasil = nilaiPerPeranPersediaan(baris);
    expect(Math.round(hasil.reduce((s, h) => s + h.nilai, 0) * 100)).toBe(300);
  });
});

describe("bagiTotalPerPeranPersediaan", () => {
  it("memaksa Σ = total tersimpan; selisih pembulatan ke kelompok terbesar", () => {
    const hasil = bagiTotalPerPeranPersediaan(100.01, [
      { tipeBarang: "FINISHED_GOOD", nilai: 66.666 },
      { tipeBarang: "FABRIC", nilai: 33.333 },
    ]);
    expect(hasil).toEqual([
      { role: "INVENTORY", nilai: 33.33 },
      { role: "INVENTORY_FG", nilai: 66.68 },
    ]);
  });

  it("baris tak terbaca → seluruh total ke peran cadangan", () => {
    expect(bagiTotalPerPeranPersediaan(500, [])).toEqual([{ role: "INVENTORY", nilai: 500 }]);
    expect(bagiTotalPerPeranPersediaan(500, [], "INVENTORY_FG")).toEqual([{ role: "INVENTORY_FG", nilai: 500 }]);
  });

  it("total nol → tidak ada baris", () => {
    expect(bagiTotalPerPeranPersediaan(0, [{ tipeBarang: "FABRIC", nilai: 10 }])).toEqual([]);
  });
});
