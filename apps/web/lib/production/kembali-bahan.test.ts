import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  bahanMasihDiCmt,
  barisPengeluaran,
  batasNilaiKembali,
  hargaDalamBatas,
  hargaKeluar,
  jumlahPerBarang,
  kunciBarisKembali,
  periksaBarisKembali,
  rataRataSesudahKembali,
  sisaBahanDiCmt,
} from "./kembali-bahan";

const angka = (d: Decimal) => d.toNumber();

describe("barisPengeluaran", () => {
  it("membaca TEKS JSON dan array; qty teks dibaca angka; baris tanpa barang dibuang", () => {
    const teks = JSON.stringify([
      { itemId: "kain", qty: 78.75 },
      { itemId: "kancing", qty: "200" },
      { qty: 5 },
    ]);
    expect(barisPengeluaran(teks).map((b) => [b.itemId, angka(b.qty)])).toEqual([
      ["kain", 78.75],
      ["kancing", 200],
    ]);
    expect(barisPengeluaran([{ item_id: "benang", quantity: 3 }]).map((b) => [b.itemId, angka(b.qty)])).toEqual([["benang", 3]]);
    expect(barisPengeluaran("{rusak")).toEqual([]);
    expect(barisPengeluaran(null)).toEqual([]);
  });
});

describe("sisa bahan di CMT", () => {
  it("keluar 80 + 40 kain, kembali 30 → sisa 90; kancing kembali semua → sisa 0 dan bukan penghalang", () => {
    const keluar = jumlahPerBarang([
      { itemId: "kain", qty: 80 },
      { itemId: "kain", qty: 40 },
      { itemId: "kancing", qty: 200 },
    ]);
    const kembali = jumlahPerBarang([
      { itemId: "kain", qty: 30 },
      { itemId: "kancing", qty: 200 },
    ]);
    const sisa = sisaBahanDiCmt(keluar, kembali);
    expect(sisa.map((s) => [s.itemId, angka(s.keluar), angka(s.kembali), angka(s.sisa)])).toEqual([
      ["kain", 120, 30, 90],
      ["kancing", 200, 200, 0],
    ]);
    expect(bahanMasihDiCmt(sisa).map((s) => s.itemId)).toEqual(["kain"]);
  });

  it("kembali lebih dari keluar (data lama) → sisa 0, tidak negatif", () => {
    const sisa = sisaBahanDiCmt(jumlahPerBarang([{ itemId: "a", qty: 5 }]), jumlahPerBarang([{ itemId: "a", qty: 7 }]));
    expect(angka(sisa[0].sisa)).toBe(0);
    expect(bahanMasihDiCmt(sisa)).toEqual([]);
  });
});

describe("periksaBarisKembali", () => {
  const sisa = sisaBahanDiCmt(
    jumlahPerBarang([
      { itemId: "kain", qty: 78.75 },
      { itemId: "kancing", qty: 200 },
    ]),
    jumlahPerBarang([{ itemId: "kancing", qty: 150 }]),
  );

  it("qty 0 dibuang, koma desimal diterima, dibulatkan 2 desimal", () => {
    const hasil = periksaBarisKembali(
      [
        { itemId: "kain", qty: "12,345" },
        { itemId: "kancing", qty: 0 },
      ],
      sisa,
    );
    expect(hasil.ok).toBe(true);
    if (hasil.ok) expect(hasil.baris.map((b) => [b.itemId, angka(b.qty)])).toEqual([["kain", 12.35]]);
  });

  it("tepat sebesar sisa diterima; 0,01 di atas sisa ditolak MELEBIHI_SISA beserta sisanya", () => {
    expect(periksaBarisKembali([{ itemId: "kancing", qty: 50 }], sisa).ok).toBe(true);
    expect(periksaBarisKembali([{ itemId: "kain", qty: 78.75 }], sisa).ok).toBe(true);
    expect(periksaBarisKembali([{ itemId: "kancing", qty: 50.01 }], sisa)).toEqual({
      ok: false,
      code: "MELEBIHI_SISA",
      itemId: "kancing",
      sisa: 50,
    });
  });

  it("semua nol → TANPA_BARIS; negatif/bukan angka → QTY_TIDAK_VALID; dua kali → BARANG_GANDA; bukan bahan WO → BUKAN_BAHAN_WO", () => {
    expect(periksaBarisKembali([{ itemId: "kain", qty: 0 }], sisa)).toEqual({ ok: false, code: "TANPA_BARIS" });
    expect(periksaBarisKembali([{ itemId: "kain", qty: -1 }], sisa)).toMatchObject({ code: "QTY_TIDAK_VALID" });
    expect(periksaBarisKembali([{ itemId: "kain", qty: "abc" }], sisa)).toMatchObject({ code: "QTY_TIDAK_VALID" });
    expect(
      periksaBarisKembali(
        [
          { itemId: "kain", qty: 1 },
          { itemId: "kain", qty: 2 },
        ],
        sisa,
      ),
    ).toMatchObject({ code: "BARANG_GANDA", itemId: "kain" });
    expect(periksaBarisKembali([{ itemId: "resleting", qty: 1 }], sisa)).toMatchObject({
      code: "BUKAN_BAHAN_WO",
      itemId: "resleting",
    });
  });
});

describe("harga keluar dan harga rata-rata sesudah kembali", () => {
  it("keluar 60 @ 30.000 + 20 @ 40.000 (dua baris gudang) → 32.500 per meter", () => {
    expect(
      angka(
        hargaKeluar([
          { qty: -60, unitCost: 30_000 },
          { qty: -20, unitCost: "40000" },
        ]),
      ),
    ).toBe(32_500);
    expect(angka(hargaKeluar([]))).toBe(0);
  });

  it("gudang 100 @ 30.000, kembali 20 @ 36.000 → 31.000; stok 0 atau negatif → harga yang kembali", () => {
    expect(angka(rataRataSesudahKembali(100, 30_000, 20, 36_000))).toBe(31_000);
    expect(angka(rataRataSesudahKembali(0, 30_000, 20, 36_000))).toBe(36_000);
    expect(angka(rataRataSesudahKembali(-5, 30_000, 20, 36_000))).toBe(36_000);
  });
});

it("kunci baris per WO, per kunci formulir, per barang", () => {
  expect(kunciBarisKembali("wo1", "k-1", "kain")).toBe("woret:wo1:k-1:kain");
});

describe("batas nilai bahan kembali sesudah penerimaan barang jadi", () => {
  it("belum ada penerimaan → tanpa batas; ada penerimaan → biaya bahan − sudah kembali − sudah dibebankan, tidak pernah negatif", () => {
    expect(batasNilaiKembali({ adaPenerimaan: false, biayaBahanWo: 2_000_000, sudahKembali: 0, sudahDibebankan: 0 })).toBeNull();
    expect(angka(batasNilaiKembali({ adaPenerimaan: true, biayaBahanWo: 2_000_000, sudahKembali: 100_000, sudahDibebankan: 1_650_000 })!)).toBe(250_000);
    expect(angka(batasNilaiKembali({ adaPenerimaan: true, biayaBahanWo: 2_000_000, sudahKembali: 0, sudahDibebankan: 2_000_000 })!)).toBe(0);
    expect(angka(batasNilaiKembali({ adaPenerimaan: true, biayaBahanWo: 1_000, sudahKembali: 600, sudahDibebankan: 900 })!)).toBe(0);
  });

  it("harga diperkecil dengan faktor yang sama, dibulatkan ke bawah ke sen: Σ nilai 249.999,70 ≤ batas 250.000", () => {
    const baris = [
      { qty: 20, harga: 30_000 },
      { qty: 50, harga: 1_000 },
    ];
    const { harga, dibatasi } = hargaDalamBatas(baris, new Decimal(250_000));
    expect(dibatasi).toBe(true);
    expect(harga.map(angka)).toEqual([11_538.46, 384.61]);
    expect(angka(harga[0].mul(20).plus(harga[1].mul(50)))).toBe(249_999.7);
    expect(hargaDalamBatas(baris, new Decimal(650_000))).toEqual({ harga: [new Decimal(30_000), new Decimal(1_000)], dibatasi: false });
    expect(hargaDalamBatas(baris, null).dibatasi).toBe(false);
    expect(hargaDalamBatas(baris, new Decimal(0)).harga.map(angka)).toEqual([0, 0]);
  });
});
