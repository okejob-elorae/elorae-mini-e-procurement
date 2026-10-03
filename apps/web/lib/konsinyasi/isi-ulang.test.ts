import { describe, expect, it } from "vitest";
import {
  indeksLakuPerArea,
  kunciStok,
  nilaiIsiUlang,
  periksaTarget,
  ringkasPenilaian,
  saranPindah,
  urutkanPenilaian,
  type BarisStokNilai,
} from "./isi-ulang";

const SEKARANG = new Date("2026-09-30T05:00:00Z");
const hariLalu = (n: number) => new Date(SEKARANG.getTime() - n * 86_400_000);

function stok(p: Partial<BarisStokNilai> & { itemId: string }): BarisStokNilai {
  return { variantSku: "", qty: 0, lastSaleAt: hariLalu(5), firstInAt: hariLalu(200), ...p };
}

const gudang = (isi: Record<string, number>) => new Map(Object.entries(isi));

describe("nilaiIsiUlang — saran isi ulang dari target min/maks", () => {
  it("memesan sampai MAKS begitu stok menyentuh MIN", () => {
    const r = nilaiIsiUlang({
      stok: [stok({ itemId: "A", variantSku: "A-M", qty: 2 })],
      target: [{ itemId: "A", variantSku: "A-M", minQty: 2, maxQty: 6 }],
      tersediaGudang: gudang({ [kunciStok("A", "A-M")]: 50 }),
      sekarang: SEKARANG,
    });
    expect(r.pesanan).toEqual([{ itemId: "A", variantSku: "A-M", qty: 4 }]);
    expect(r.baris[0].tanda).toContain("HAMPIR_HABIS");
  });

  it("tidak memesan selama stok masih di atas MIN", () => {
    const r = nilaiIsiUlang({
      stok: [stok({ itemId: "A", qty: 3 })],
      target: [{ itemId: "A", variantSku: "", minQty: 2, maxQty: 6 }],
      tersediaGudang: gudang({ [kunciStok("A", "")]: 50 }),
      sekarang: SEKARANG,
    });
    expect(r.pesanan).toEqual([]);
    expect(r.baris[0].saranQty).toBe(0);
  });

  it("dibatasi stok gudang dan menandai kekurangannya", () => {
    const r = nilaiIsiUlang({
      stok: [stok({ itemId: "A", qty: 0 })],
      target: [{ itemId: "A", variantSku: "", minQty: 1, maxQty: 10 }],
      tersediaGudang: gudang({ [kunciStok("A", "")]: 3 }),
      sekarang: SEKARANG,
    });
    expect(r.baris[0]).toMatchObject({ saranQty: 3, kurangGudang: true });
  });

  it("tidak pernah menyarankan jumlah negatif saat gudang minus", () => {
    const r = nilaiIsiUlang({
      stok: [stok({ itemId: "A", qty: 0 })],
      target: [{ itemId: "A", variantSku: "", minQty: 1, maxQty: 10 }],
      tersediaGudang: gudang({ [kunciStok("A", "")]: -4 }),
      sekarang: SEKARANG,
    });
    expect(r.baris[0].saranQty).toBe(0);
    expect(r.pesanan).toEqual([]);
  });

  it("menghitung barang yang sedang dalam perjalanan supaya tidak dipesan dua kali", () => {
    const r = nilaiIsiUlang({
      stok: [stok({ itemId: "A", qty: 1 })],
      target: [{ itemId: "A", variantSku: "", minQty: 2, maxQty: 8 }],
      tersediaGudang: gudang({ [kunciStok("A", "")]: 50 }),
      dalamProses: gudang({ [kunciStok("A", "")]: 5 }),
      sekarang: SEKARANG,
    });
    // 1 di rak + 5 di jalan = 6 > MIN 2 → belum perlu.
    expect(r.baris[0].saranQty).toBe(0);
  });

  it("stok minus dianggap nol untuk isi ulang, tapi tandanya MINUS tetap", () => {
    const r = nilaiIsiUlang({
      stok: [stok({ itemId: "A", qty: -3 })],
      target: [{ itemId: "A", variantSku: "", minQty: 2, maxQty: 6 }],
      tersediaGudang: gudang({ [kunciStok("A", "")]: 50 }),
      sekarang: SEKARANG,
    });
    expect(r.baris[0].saranQty).toBe(6);
    expect(r.baris[0].tanda).toContain("MINUS");
  });

  it("menilai barang yang hanya punya target (belum pernah ada di toko)", () => {
    const r = nilaiIsiUlang({
      stok: [],
      target: [{ itemId: "B", variantSku: "B-L", minQty: 0, maxQty: 4 }],
      tersediaGudang: gudang({ [kunciStok("B", "B-L")]: 9 }),
      sekarang: SEKARANG,
    });
    expect(r.baris).toHaveLength(1);
    expect(r.baris[0].stok).toBeNull();
    expect(r.pesanan).toEqual([{ itemId: "B", variantSku: "B-L", qty: 4 }]);
  });

  it("target maks 0 berarti jangan distok — tidak ada saran, tidak ada tanda habis", () => {
    const r = nilaiIsiUlang({
      stok: [stok({ itemId: "A", qty: 0 })],
      target: [{ itemId: "A", variantSku: "", minQty: 0, maxQty: 0 }],
      tersediaGudang: gudang({ [kunciStok("A", "")]: 50 }),
      sekarang: SEKARANG,
    });
    expect(r.baris[0].saranQty).toBe(0);
    expect(r.baris[0].tanda).not.toContain("HAMPIR_HABIS");
  });

  it("varian kosong dan null adalah baris yang sama", () => {
    const r = nilaiIsiUlang({
      stok: [stok({ itemId: "A", variantSku: "", qty: 0 })],
      target: [{ itemId: "A", variantSku: "", minQty: 1, maxQty: 3 }],
      tersediaGudang: new Map([[kunciStok("A", null), 10]]),
      sekarang: SEKARANG,
    });
    expect(r.baris).toHaveLength(1);
    expect(r.baris[0].saranQty).toBe(3);
  });
});

describe("nilaiIsiUlang — tanda", () => {
  const nilai = (s: BarisStokNilai) =>
    nilaiIsiUlang({ stok: [s], target: [], tersediaGudang: new Map(), sekarang: SEKARANG }).baris[0].tanda;

  it("HAMPIR_HABIS tanpa target: 2 potong atau kurang", () => {
    expect(nilai(stok({ itemId: "A", qty: 2 }))).toContain("HAMPIR_HABIS");
    expect(nilai(stok({ itemId: "A", qty: 3 }))).not.toContain("HAMPIR_HABIS");
  });

  it("barang yang lama habis dan tidak laku lagi bukan 'hampir habis'", () => {
    expect(nilai(stok({ itemId: "A", qty: 0, lastSaleAt: hariLalu(300) }))).toEqual([]);
    // Habis tapi baru laku kemarin — itu yang perlu diisi.
    expect(nilai(stok({ itemId: "A", qty: 0, lastSaleAt: hariLalu(1) }))).toContain("HAMPIR_HABIS");
  });

  it("MINUS saat saldo di bawah nol", () => {
    expect(nilai(stok({ itemId: "A", qty: -1 }))).toContain("MINUS");
  });

  it("TIDAK_LAKU: masih ada di rak dan tidak laku 60 hari", () => {
    expect(nilai(stok({ itemId: "A", qty: 5, lastSaleAt: hariLalu(61) }))).toContain("TIDAK_LAKU");
    expect(nilai(stok({ itemId: "A", qty: 5, lastSaleAt: null }))).toContain("TIDAK_LAKU");
    expect(nilai(stok({ itemId: "A", qty: 5, lastSaleAt: hariLalu(59) }))).not.toContain("TIDAK_LAKU");
  });

  it("barang yang baru tiba belum dinilai tidak laku", () => {
    expect(nilai(stok({ itemId: "A", qty: 5, lastSaleAt: null, firstInAt: hariLalu(10) }))).not.toContain("TIDAK_LAKU");
  });

  it("stok nol tidak pernah 'tidak laku'", () => {
    expect(nilai(stok({ itemId: "A", qty: 0, lastSaleAt: null }))).not.toContain("TIDAK_LAKU");
  });
});

describe("urutkanPenilaian", () => {
  it("MINUS, lalu habis/isi ulang, lalu tidak laku, lalu sisanya — urutan asal dipertahankan", () => {
    const b = (id: string, tanda: ("MINUS" | "HAMPIR_HABIS" | "TIDAK_LAKU")[], saranQty = 0) => ({ id, tanda, saranQty });
    const hasil = urutkanPenilaian([
      b("biasa1", []),
      b("tidakLaku", ["TIDAK_LAKU"]),
      b("isiUlang", [], 3),
      b("habis", ["HAMPIR_HABIS"]),
      b("minus", ["MINUS", "HAMPIR_HABIS"]),
      b("biasa2", []),
    ]);
    expect(hasil.map((x) => x.id)).toEqual(["minus", "isiUlang", "habis", "tidakLaku", "biasa1", "biasa2"]);
  });
});

describe("ringkasPenilaian", () => {
  it("menjumlah stok di rak dan saran isi ulang", () => {
    const r = ringkasPenilaian([
      { qty: 4, tanda: [], saranQty: 0, target: null },
      { qty: -2, tanda: ["MINUS"], saranQty: 5, target: { minQty: 1, maxQty: 5 } },
      { qty: 1, tanda: ["HAMPIR_HABIS"], saranQty: 2, target: null },
    ]);
    expect(r).toEqual({
      sku: 2,
      pcs: 5,
      minus: 1,
      hampirHabis: 1,
      tidakLaku: 0,
      barisIsiUlang: 2,
      pcsIsiUlang: 7,
      adaTarget: true,
    });
  });
});

describe("periksaTarget", () => {
  it("kedua kosong = hapus target, sah", () => {
    expect(periksaTarget({ minQty: null, maxQty: null })).toBeNull();
  });
  it("menolak isian setengah", () => {
    expect(periksaTarget({ minQty: 2, maxQty: null })).toBe("SEBAGIAN");
  });
  it("min ≥ 0 dan bulat", () => {
    expect(periksaTarget({ minQty: -1, maxQty: 3 })).toBe("MIN_TIDAK_VALID");
    expect(periksaTarget({ minQty: 1.5, maxQty: 3 })).toBe("MIN_TIDAK_VALID");
  });
  it("maks ≥ min", () => {
    expect(periksaTarget({ minQty: 4, maxQty: 3 })).toBe("MAKS_KURANG_DARI_MIN");
    expect(periksaTarget({ minQty: 3, maxQty: 3 })).toBeNull();
  });
  it("menolak angka yang tidak masuk akal", () => {
    expect(periksaTarget({ minQty: 0, maxQty: 100000 })).toBe("MAKS_TIDAK_VALID");
  });
});

describe("saranPindah", () => {
  const indeks = indeksLakuPerArea([
    { storeId: "S1", groupId: "G1", itemId: "A", terjual60: 4 },
    { storeId: "S2", groupId: "G1", itemId: "A", terjual60: 9 },
    { storeId: "S3", groupId: "G2", itemId: "A", terjual60: 20 },
    { storeId: "S4", groupId: "G1", itemId: "B", terjual60: 0 },
  ]);

  it("memilih toko se-area yang paling laku, bukan toko asal", () => {
    expect(saranPindah(indeks, { storeId: "S1", groupId: "G1" }, "A")?.storeId).toBe("S2");
    expect(saranPindah(indeks, { storeId: "S2", groupId: "G1" }, "A")?.storeId).toBe("S1");
  });

  it("tidak menyeberang area", () => {
    expect(saranPindah(indeks, { storeId: "S9", groupId: "G2" }, "A")?.storeId).toBe("S3");
    expect(saranPindah(indeks, { storeId: "S3", groupId: "G2" }, "A")).toBeNull();
  });

  it("toko tanpa area tidak diberi saran, barang yang tidak laku di mana pun juga", () => {
    expect(saranPindah(indeks, { storeId: "S1", groupId: null }, "A")).toBeNull();
    expect(saranPindah(indeks, { storeId: "S1", groupId: "G1" }, "B")).toBeNull();
  });
});
