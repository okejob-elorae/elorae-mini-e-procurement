import { describe, expect, it } from "vitest";
import {
  catatanProduksi,
  hasilDariQty,
  keadaanTerhadapTahap,
  kekurangan,
  qtyBahanDiPo,
  qtyDariHasil,
  susunIsiKurang,
  tulisQtyBahan,
} from "./kebutuhan-tahap";
import { keSen } from "./rincian-warna";

describe("kekurangan", () => {
  it("kebutuhan − sudah di-PO, dua desimal, tidak pernah negatif", () => {
    expect(kekurangan(28.35, 10)).toBe(18.35);
    expect(kekurangan(28.35, 28.35)).toBe(0);
    expect(kekurangan(28.35, 40)).toBe(0);
    expect(kekurangan(0.3, 0.1)).toBe(0.2);
  });
});

describe("susunIsiKurang", () => {
  const bahan = [
    { itemId: "kain", butuh: 6600, diPo: 1000 },
    { itemId: "kancing", butuh: 72_000, diPo: 72_000 },
    { itemId: "benang", butuh: 12, diPo: 0 },
  ];

  it("hanya bahan yang masih kurang, urut seperti di kartu", () => {
    expect(susunIsiKurang(bahan)).toEqual([
      { itemId: "kain", qty: 5600 },
      { itemId: "benang", qty: 12 },
    ]);
  });

  it("pilihan bahan menyaring; bahan yang sudah pas tetap dilewati", () => {
    expect(susunIsiKurang(bahan, ["benang", "kancing"])).toEqual([{ itemId: "benang", qty: 12 }]);
    expect(susunIsiKurang(bahan, [])).toHaveLength(2);
  });
});

describe("catatanProduksi", () => {
  it("Produksi <tahap> · <jenis>", () => {
    expect(catatanProduksi("Batch 1", { code: "K-01", name: "Kaos" })).toBe("Produksi Batch 1 · Kaos");
    expect(catatanProduksi("Batch 1", { code: "K-01", name: " " })).toBe("Produksi Batch 1 · K-01");
  });
});

describe("kalkulator 3 arah", () => {
  it("qty → hasil pcs dan sebaliknya, susut ikut", () => {
    expect(hasilDariQty(28.35, 0.27, 5)).toBe(100);
    expect(qtyDariHasil(100, 0.27, 5)).toBe(28.35);
    expect(hasilDariQty(10, 0, 5)).toBeNull();
  });

  it("bolak-balik stabil", () => {
    for (const [konsumsi, waste, pcs] of [
      [0.333, 0, 7],
      [0.27, 5, 1234],
      [1.15, 2.5, 60],
    ] as const) {
      const qty = qtyDariHasil(pcs, konsumsi, waste);
      expect(qtyDariHasil(hasilDariQty(qty, konsumsi, waste)!, konsumsi, waste)).toBe(qty);
    }
  });
});

describe("keadaanTerhadapTahap", () => {
  const dasar = { konsumsi: 0.27, wastePercent: 5, targetQty: 100 };

  it("mengisi persis kekurangan selalu pas", () => {
    expect(keadaanTerhadapTahap({ ...dasar, qty: 18.35, diPoLain: 10 })).toEqual({ keadaan: "PAS", pcs: 0 });
    expect(keadaanTerhadapTahap({ konsumsi: 0.333, wastePercent: 0, targetQty: 7, qty: 2.33, diPoLain: 0 })).toEqual({
      keadaan: "PAS",
      pcs: 0,
    });
  });

  it("lebih dihitung pcs utuh; lebih di bawah satu pcs = pas", () => {
    expect(keadaanTerhadapTahap({ ...dasar, qty: 28.35 + 2.835, diPoLain: 0 })).toEqual({ keadaan: "LEBIH", pcs: 10 });
    expect(keadaanTerhadapTahap({ ...dasar, qty: 28.5, diPoLain: 0 })).toEqual({ keadaan: "PAS", pcs: 0 });
  });

  it("kurang sedikit pun = kurang satu pcs", () => {
    expect(keadaanTerhadapTahap({ ...dasar, qty: 28.34, diPoLain: 0 })).toEqual({ keadaan: "KURANG", pcs: 1 });
    expect(keadaanTerhadapTahap({ ...dasar, qty: 0, diPoLain: 0 })).toEqual({ keadaan: "KURANG", pcs: 100 });
  });

  it("tanpa konsumsi atau qty tahap → tidak bisa dinilai", () => {
    expect(keadaanTerhadapTahap({ ...dasar, konsumsi: 0, qty: 1, diPoLain: 0 })).toBeNull();
    expect(keadaanTerhadapTahap({ ...dasar, targetQty: 0, qty: 1, diPoLain: 0 })).toBeNull();
  });
});

describe("tulisQtyBahan", () => {
  const baris = [
    { id: "1", itemId: "kain", qty: 5 },
    { id: "2", itemId: "kancing", qty: 1 },
    { id: "3", itemId: "kain", qty: 5 },
    { id: "4", itemId: "kain", qty: 5 },
  ];

  it("beberapa baris satu bahan dibagi rata, jumlahnya persis", () => {
    const hasil = tulisQtyBahan(baris, "kain", 100)!;
    expect(hasil.map((b) => b.qty)).toEqual([33.33, 1, 33.33, 33.34]);
    expect(hasil.filter((b) => b.itemId === "kain").reduce((t, b) => t + keSen(b.qty), 0)).toBe(10_000);
    expect(qtyBahanDiPo(hasil, "kain")).toBe(100);
    expect(hasil[1]).toBe(baris[1]);
  });

  it("bahan tanpa baris → null (pemanggil yang menambah baris)", () => {
    expect(tulisQtyBahan(baris, "benang", 3)).toBeNull();
    expect(qtyBahanDiPo(baris, "benang")).toBe(0);
  });
});
