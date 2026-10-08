import { describe, expect, it } from "vitest";
import { susunLabaKanal, type BarisKanalMentah } from "./laba-kanal";

const PERAN = { retur: new Set(["retur"]), potongan: new Set(["potongan"]) };

function b(over: Partial<BarisKanalMentah> & { accountId: string; type: BarisKanalMentah["type"] }): BarisKanalMentah {
  return { kanal: null, storeId: null, debit: 0, credit: 0, ...over };
}

describe("susunLabaKanal — per kanal", () => {
  it("pendapatan, retur, potongan, HPP, laba kotor, margin, beban kanal, laba kontribusi", () => {
    const hasil = susunLabaKanal(
      [
        b({ kanal: "SHOPEE", accountId: "jual", type: "PENDAPATAN", credit: 1000 }),
        b({ kanal: "SHOPEE", accountId: "retur", type: "PENDAPATAN", debit: 100 }),
        b({ kanal: "SHOPEE", accountId: "potongan", type: "PENDAPATAN", debit: 50 }),
        b({ kanal: "SHOPEE", accountId: "hpp", type: "HPP", debit: 425 }),
        b({ kanal: "SHOPEE", accountId: "fee", type: "BEBAN", debit: 80 }),
      ],
      PERAN,
      "kanal",
    );
    expect(hasil.baris).toEqual([
      {
        kunci: "SHOPEE",
        penjualan: 1000,
        retur: 100,
        potongan: 50,
        pendapatanBersih: 850,
        hpp: 425,
        labaKotor: 425,
        marginKotor: 50,
        beban: 80,
        labaKontribusi: 345,
      },
    ]);
  });

  it("baris tanpa kanal tampil jujur sebagai kelompok sendiri, paling bawah; total = laba bersih buku besar", () => {
    const hasil = susunLabaKanal(
      [
        b({ kanal: null, accountId: "jual", type: "PENDAPATAN", credit: 300 }),
        b({ kanal: null, accountId: "gaji", type: "BEBAN", debit: 500 }),
        b({ kanal: "TIKTOK", accountId: "jual", type: "PENDAPATAN", credit: 200 }),
        b({ kanal: "SHOPEE", accountId: "jual", type: "PENDAPATAN", credit: 100 }),
      ],
      PERAN,
      "kanal",
    );
    expect(hasil.baris.map((r) => r.kunci)).toEqual(["SHOPEE", "TIKTOK", null]);
    expect(hasil.total).toMatchObject({ kunci: null, pendapatanBersih: 600, beban: 500, labaKontribusi: 100 });
  });

  it("nilai kanal yang tidak dikenal tetap dikelompokkan apa adanya, sesudah kanal yang dikenal", () => {
    const hasil = susunLabaKanal(
      [
        b({ kanal: "ANEH", accountId: "jual", type: "PENDAPATAN", credit: 1 }),
        b({ kanal: "KOL", accountId: "jual", type: "PENDAPATAN", credit: 1 }),
      ],
      PERAN,
      "kanal",
    );
    expect(hasil.baris.map((r) => r.kunci)).toEqual(["KOL", "ANEH"]);
  });

  it("margin null bila pendapatan bersih nol atau negatif", () => {
    const hasil = susunLabaKanal([b({ kanal: "KOL", accountId: "fee", type: "BEBAN", debit: 10 })], PERAN, "kanal");
    expect(hasil.baris[0].marginKotor).toBeNull();
  });

  it("baris turunan dipindah dari kelompok tanpa kanal ke kanal dokumennya", () => {
    const hasil = susunLabaKanal(
      [b({ kanal: null, accountId: "jual", type: "PENDAPATAN", credit: 500 })],
      PERAN,
      "kanal",
      [{ accountId: "jual", type: "PENDAPATAN", debit: 0, credit: 300, storeId: null, kanal: "SHOPEE", storeIdTurunan: null }],
    );
    expect(hasil.baris.map((r) => [r.kunci, r.pendapatanBersih])).toEqual([
      ["SHOPEE", 300],
      [null, 200],
    ]);
    expect(hasil.total.pendapatanBersih).toBe(500);
    expect(hasil.barisTurunan).toBe(1);
  });

  it("kelompok kosong (semua nol) tidak tampil", () => {
    const hasil = susunLabaKanal(
      [
        b({ kanal: "KOL", accountId: "jual", type: "PENDAPATAN", credit: 10 }),
        b({ kanal: "KOL", accountId: "jual", type: "PENDAPATAN", debit: 10 }),
      ],
      PERAN,
      "kanal",
    );
    expect(hasil.baris).toEqual([]);
  });

  it("menjumlah dalam sen", () => {
    const hasil = susunLabaKanal(
      [
        b({ kanal: "KOL", accountId: "jual", type: "PENDAPATAN", credit: 0.1 }),
        b({ kanal: "KOL", accountId: "jual", type: "PENDAPATAN", credit: 0.2 }),
      ],
      PERAN,
      "kanal",
    );
    expect(hasil.baris[0].penjualan).toBe(0.3);
  });
});

describe("susunLabaKanal — per toko", () => {
  it("dikelompokkan per toko, diurut pendapatan bersih terbesar, tanpa toko paling bawah", () => {
    const hasil = susunLabaKanal(
      [
        b({ kanal: "PUTUS", storeId: "a", accountId: "jual", type: "PENDAPATAN", credit: 100 }),
        b({ kanal: "PUTUS", storeId: "b", accountId: "jual", type: "PENDAPATAN", credit: 300 }),
        b({ kanal: "PUTUS", storeId: "b", accountId: "hpp", type: "HPP", debit: 120 }),
        b({ kanal: "SHOPEE", storeId: null, accountId: "jual", type: "PENDAPATAN", credit: 999 }),
      ],
      PERAN,
      "toko",
    );
    expect(hasil.baris.map((r) => [r.kunci, r.pendapatanBersih, r.labaKotor])).toEqual([
      ["b", 300, 180],
      ["a", 100, 100],
      [null, 999, 999],
    ]);
  });

  it("toko turunan (penjualan kanvas lama tanpa storeId) ikut tokonya", () => {
    const hasil = susunLabaKanal(
      [b({ kanal: null, storeId: null, accountId: "jual", type: "PENDAPATAN", credit: 50 })],
      PERAN,
      "toko",
      [{ accountId: "jual", type: "PENDAPATAN", debit: 0, credit: 50, storeId: null, kanal: "KANVAS", storeIdTurunan: "t1" }],
    );
    expect(hasil.baris.map((r) => [r.kunci, r.pendapatanBersih])).toEqual([["t1", 50]]);
  });
});
