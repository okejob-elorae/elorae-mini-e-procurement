import { describe, expect, it } from "vitest";
import {
  barisBertandaAkun,
  barisBertandaHutang,
  barisBertandaPersediaan,
  barisBertandaPiutangMarketplace,
  barisBertandaPiutangToko,
  keSen,
  nilaiKaliHppSen,
  susunJurnalSaldoAwal,
} from "./jurnal";

function seimbang(baris: { debit: number; kredit: number }[]): boolean {
  const d = baris.reduce((s, b) => s + Math.round(b.debit * 100), 0);
  const k = baris.reduce((s, b) => s + Math.round(b.kredit * 100), 0);
  return d === k && d > 0;
}

describe("uang dalam sen", () => {
  it("keSen membulatkan setengah menjauh dari nol dan tidak pernah −0", () => {
    expect(keSen(1.005)).toBe(100); // 1.005 tidak persis di biner — tetap 1 rupiah
    expect(keSen(0.125)).toBe(13);
    expect(keSen(-0.125)).toBe(-13);
    expect(Object.is(keSen(-0.001), 0)).toBe(true);
  });

  it("nilaiKaliHppSen pasti untuk angka besar (BigInt), dibulatkan ke sen", () => {
    expect(nilaiKaliHppSen(20.2, 26455.65)).toBe(53440413); // 534.404,13 — sama dengan totalValue lokal
    expect(nilaiKaliHppSen(32.54, 48474.49)).toBe(157735990);
    // 99.999,99 × 99.999.999,99 = 9.999.998.999.000,0001 → hasil kali biasa (float) sudah tidak pasti di sini.
    expect(nilaiKaliHppSen(99_999.99, 99_999_999.99)).toBe(999_999_899_900_000);
    expect(nilaiKaliHppSen(-3, 1000)).toBe(-300000);
    expect(nilaiKaliHppSen(0.5, 0.01)).toBe(1); // 0,005 → 0,01 (setengah ke atas)
  });
});

describe("susunJurnalSaldoAwal", () => {
  it("saldo akun: lawan selisihnya ke Ekuitas saldo awal (kredit bila aset lebih besar)", () => {
    const j = susunJurnalSaldoAwal(
      barisBertandaAkun([
        { akunId: "kas", debit: 5_000_000, kredit: 0 },
        { akunId: "bank", debit: 130_000_000, kredit: 0 },
        { akunId: "alat", debit: 12_000_000, kredit: 0 },
        { akunId: "modal", debit: 0, kredit: 100_000_000 },
      ]),
    );
    expect(j.ekuitasSen).toBe(4_700_000_000);
    expect(j.baris.at(-1)).toEqual({ peran: "OPENING_EQUITY", debit: 0, kredit: 47_000_000, memo: "Lawan saldo awal" });
    expect(seimbang(j.baris)).toBe(true);
  });

  it("baris yang sudah seimbang tidak mendapat baris ekuitas", () => {
    const j = susunJurnalSaldoAwal(barisBertandaAkun([
      { akunId: "kas", debit: 1000, kredit: 0 },
      { akunId: "modal", debit: 0, kredit: 1000 },
    ]));
    expect(j.ekuitasSen).toBe(0);
    expect(j.baris).toHaveLength(2);
  });

  it("hutang: kredit AP, lawan DEBIT ekuitas; baris nol dibuang", () => {
    const j = susunJurnalSaldoAwal(
      barisBertandaHutang([
        { supplierId: "s1", nama: "PT Sinar", jumlah: 4_860_000 },
        { supplierId: "s2", nama: "CV Nol", jumlah: 0 },
      ]),
    );
    expect(j.baris).toEqual([
      { peran: "AP", debit: 0, kredit: 4_860_000, memo: "Saldo awal hutang PT Sinar" },
      { peran: "OPENING_EQUITY", debit: 4_860_000, kredit: 0, memo: "Lawan saldo awal" },
    ]);
    expect(j.ekuitasSen).toBe(-486_000_000);
  });

  it("piutang toko membawa storeId, piutang marketplace membawa kanal", () => {
    const toko = susunJurnalSaldoAwal(barisBertandaPiutangToko([{ storeId: "st1", nama: "Toko A", faktur: 2, jumlah: 1_500_000 }]));
    expect(toko.baris[0]).toMatchObject({ peran: "AR_STORE", debit: 1_500_000, storeId: "st1" });
    const mp = susunJurnalSaldoAwal(barisBertandaPiutangMarketplace([{ kanal: "SHOPEE", jumlah: 250_000.5 }, { kanal: "TIKTOK", jumlah: 100_000 }]));
    expect(mp.baris.map((b) => [b.peran, b.channel, b.debit])).toEqual([
      ["AR", "SHOPEE", 250_000.5],
      ["AR", "TIKTOK", 100_000],
      ["OPENING_EQUITY", undefined, 0],
    ]);
    expect(mp.baris[2].kredit).toBe(350_000.5);
  });

  it("persediaan: satu baris per peran, nilai negatif menjadi kredit", () => {
    const j = susunJurnalSaldoAwal(barisBertandaPersediaan({ INVENTORY: 1_000_00, INVENTORY_FG: -250_00 }));
    expect(j.baris.map((b) => [b.peran, b.debit, b.kredit])).toEqual([
      ["INVENTORY", 1000, 0],
      ["INVENTORY_FG", 0, 250],
      ["OPENING_EQUITY", 0, 750],
    ]);
  });

  it("tidak ada baris bernilai → jurnal kosong", () => {
    expect(susunJurnalSaldoAwal(barisBertandaPersediaan({}))).toEqual({ baris: [], ekuitasSen: 0 });
  });
});
