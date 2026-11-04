import { describe, expect, it } from "vitest";
import { PPN_BAWAAN, type PengaturanPpn } from "./ppn";
import { barisPenjualanPpn, barisPpnMasukan, denganDimensi, dppDariMemo, memoDpp, memoPeranDpp, peranDariMemo, pisahPpnMasukanTermasuk, ppnPemberianCumaCuma } from "./jurnal-ppn";

const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP" };
const TGL = new Date("2026-10-08T05:00:00.000Z");

const jumlah = (b: { debit: number; credit: number }[], sisi: "debit" | "credit") => Math.round(b.reduce((s, x) => s + x[sisi], 0) * 100);

describe("memo DPP", () => {
  it("menulis dan membaca DPP; memo lain bukan DPP", () => {
    expect(memoDpp(900900)).toBe("DPP 900900.00");
    expect(memoDpp(-1250.5)).toBe("DPP 1250.50");
    expect(dppDariMemo("DPP 900900.00")).toBe(900900);
    expect(dppDariMemo("DPP 12.5")).toBe(12.5);
    expect(dppDariMemo("KOL_EXPENSE")).toBeNull();
    expect(dppDariMemo(null)).toBeNull();
  });

  it("memo gabungan peran + DPP: dibaca rekap PPN DAN penyelaras per peran", () => {
    expect(memoPeranDpp("PPN_KELUARAN", 900900)).toBe("PPN_KELUARAN · DPP 900900.00");
    expect(dppDariMemo("PPN_KELUARAN · DPP 900900.00")).toBe(900900);
    expect(peranDariMemo("PPN_KELUARAN · DPP 900900.00")).toBe("PPN_KELUARAN");
    expect(peranDariMemo("AR_STORE")).toBe("AR_STORE");
    expect(peranDariMemo(null)).toBeNull();
    expect(dppDariMemo("PPN_KELUARAN · bukan DPP")).toBeNull();
  });
});

describe("barisPenjualanPpn", () => {
  it("BELUM_DITETAPKAN (bawaan): tanpa baris PPN, pendapatan = total — sama dengan jurnal sebelum PPN", () => {
    const r = barisPenjualanPpn({ total: 1000, peranDebit: "AR", pengaturan: PPN_BAWAAN, tanggal: TGL });
    expect(r.baris).toEqual([
      { role: "AR", debit: 1000, credit: 0 },
      { role: "SALES_REVENUE", debit: 0, credit: 1000 },
    ]);
    expect(r).toMatchObject({ total: 1000, pendapatan: 1000, ppn: 0 });
  });

  it("PKP: harga termasuk PPN dipisah DPP + PPN keluaran (11/12 × 12%), seimbang persis, dimensi di baris non-PPN", () => {
    const r = barisPenjualanPpn({ total: 111_000, peranDebit: "AR", pengaturan: PKP, tanggal: TGL, dimensi: { channel: "SHOPEE" } });
    expect(r.pendapatan + r.ppn).toBe(111_000);
    expect(r.ppn).toBe(11_000);
    expect(r.baris).toEqual([
      { role: "AR", debit: 111_000, credit: 0, channel: "SHOPEE" },
      { role: "SALES_REVENUE", debit: 0, credit: 100_000, channel: "SHOPEE" },
      { role: "PPN_KELUARAN", debit: 0, credit: 11_000, memo: "DPP 100000.00" },
    ]);
    expect(jumlah(r.baris, "debit")).toBe(jumlah(r.baris, "credit"));
  });

  it("balik (retur): setiap sisi terbalik", () => {
    const r = barisPenjualanPpn({ total: 111_000, peranDebit: "AR", pengaturan: PKP, tanggal: TGL, balik: true, dimensi: { channel: "TIKTOK", storeId: "s1" } });
    expect(r.baris).toEqual([
      { role: "AR", debit: 0, credit: 111_000, channel: "TIKTOK", storeId: "s1" },
      { role: "SALES_REVENUE", debit: 100_000, credit: 0, channel: "TIKTOK", storeId: "s1" },
      { role: "PPN_KELUARAN", debit: 11_000, credit: 0, memo: "DPP 100000.00" },
    ]);
  });

  it("paksaPpn mengikuti penjualan asal, bukan pengaturan hari ini", () => {
    const ikut = barisPenjualanPpn({ total: 111_000, peranDebit: "AR", pengaturan: PPN_BAWAAN, tanggal: TGL, paksaPpn: true });
    expect(ikut.ppn).toBe(11_000);
    const tidak = barisPenjualanPpn({ total: 111_000, peranDebit: "AR", pengaturan: PKP, tanggal: TGL, paksaPpn: false });
    expect(tidak.ppn).toBe(0);
    expect(tidak.baris).toHaveLength(2);
  });

  it("PKP sebelum berlakuSejak: tanpa PPN", () => {
    const r = barisPenjualanPpn({ total: 111_000, peranDebit: "CASH", pengaturan: { ...PKP, berlakuSejak: "2026-11-01" }, tanggal: TGL });
    expect(r.ppn).toBe(0);
  });

  it("total bersen tetap seimbang ke sen", () => {
    for (const total of [1, 99.99, 12_345.67, 1_000_001]) {
      const r = barisPenjualanPpn({ total, peranDebit: "AR", pengaturan: PKP, tanggal: TGL });
      expect(jumlah(r.baris, "debit")).toBe(jumlah(r.baris, "credit"));
      expect(Math.round(r.total * 100)).toBe(Math.round(total * 100));
    }
  });
});

describe("PPN masukan & pemberian cuma-cuma", () => {
  it("biaya termasuk PPN dipisah hanya bila PKP", () => {
    expect(pisahPpnMasukanTermasuk(11_100, PKP, TGL)).toEqual({ dpp: 10_000, ppn: 1_100 });
    expect(pisahPpnMasukanTermasuk(11_100, PPN_BAWAAN, TGL)).toEqual({ dpp: 11_100, ppn: 0 });
    expect(barisPpnMasukan(1_100, 10_000)).toEqual([{ role: "PPN_MASUKAN", debit: 1_100, credit: 0, memo: "DPP 10000.00" }]);
    expect(barisPpnMasukan(1_100, 10_000, true)).toEqual([{ role: "PPN_MASUKAN", debit: 0, credit: 1_100, memo: "DPP 10000.00" }]);
    expect(barisPpnMasukan(0, 10_000)).toEqual([]);
  });

  it("sampel: PPN = 12% × 11/12 × HPP (PMK 11/2025), nol bila bukan PKP", () => {
    expect(ppnPemberianCumaCuma(120_000, PKP, TGL)).toEqual({ dpp: 120_000, ppn: 13_200 });
    expect(ppnPemberianCumaCuma(120_000, PPN_BAWAAN, TGL)).toEqual({ dpp: 120_000, ppn: 0 });
  });

  it("denganDimensi tidak menimpa dimensi yang sudah ada", () => {
    const hasil = denganDimensi(
      [
        { role: "COGS" as const, debit: 5, credit: 0 },
        { role: "INVENTORY_FG" as const, debit: 0, credit: 5, channel: "KOL" as const },
      ],
      { channel: "SHOPEE", storeId: "t1" },
    );
    expect(hasil).toEqual([
      { role: "COGS", debit: 5, credit: 0, channel: "SHOPEE", storeId: "t1" },
      { role: "INVENTORY_FG", debit: 0, credit: 5, channel: "KOL", storeId: "t1" },
    ]);
  });
});
