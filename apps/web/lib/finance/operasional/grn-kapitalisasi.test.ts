import { describe, expect, it } from "vitest";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import { hitungTotalPo } from "@/lib/purchase-orders/ppn";
import { ppnKapitalisasiGrn } from "./grn-kapitalisasi";

const T = new Date("2026-10-15T00:00:00+07:00");
const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP", berlakuSejak: null };

const po = [
  { itemId: "kain", variantSku: null, ppnIncluded: false },
  { itemId: "kancing", variantSku: null, ppnIncluded: true },
  { itemId: "benang", variantSku: "MERAH", ppnIncluded: false },
];

describe("PPN pembelian dikapitalisasi saat bukan PKP", () => {
  it("hanya baris Exclude PPN; jumlahnya sama dengan PPN PO untuk barang yang sama", () => {
    const baris = [
      { itemId: "kain", nilai: 1_000_000 },
      { itemId: "kancing", nilai: 50_000 },
      { itemId: "benang", variantSku: "MERAH", nilai: 333_333.33 },
    ];
    const r = ppnKapitalisasiGrn({ baris, barisPo: po, tarifPo: 11, pengaturan: NON_PKP, tanggal: T });
    expect(r[1]).toBe(0);
    const total = Math.round((r[0] + r[2]) * 100) / 100;
    const harapan = hitungTotalPo(
      [
        { qty: 1, price: 1_000_000, ppnIncluded: false },
        { qty: 1, price: 333_333.33, ppnIncluded: false },
      ],
      11,
    ).taxAmount;
    expect(total).toBe(harapan);
    // Sebanding nilai baris.
    expect(r[0]).toBeGreaterThan(r[2] * 2.9);
  });

  it("PKP, PO tanpa tarif, atau GRN tanpa PO → tanpa kapitalisasi", () => {
    const baris = [{ itemId: "kain", nilai: 1_000_000 }];
    expect(ppnKapitalisasiGrn({ baris, barisPo: po, tarifPo: 11, pengaturan: PKP, tanggal: T })).toEqual([0]);
    expect(ppnKapitalisasiGrn({ baris, barisPo: po, tarifPo: null, pengaturan: NON_PKP, tanggal: T })).toEqual([0]);
    expect(ppnKapitalisasiGrn({ baris, barisPo: null, tarifPo: 11, pengaturan: NON_PKP, tanggal: T })).toEqual([0]);
  });

  it("sebelum PPN berlaku (PKP dengan berlakuSejak di depan) tetap dikapitalisasi", () => {
    const baris = [{ itemId: "kain", nilai: 100_000 }];
    const r = ppnKapitalisasiGrn({ baris, barisPo: po, tarifPo: 11, pengaturan: { ...PKP, berlakuSejak: "2027-01-01" }, tanggal: T });
    expect(r).toEqual([11_000]);
  });

  it("jumlah pecahan sen persis sama dengan PPN total", () => {
    const baris = [
      { itemId: "kain", nilai: 33.33 },
      { itemId: "benang", variantSku: "MERAH", nilai: 33.33 },
      { itemId: "kain", nilai: 33.34 },
    ];
    const r = ppnKapitalisasiGrn({ baris, barisPo: po, tarifPo: 12, pengaturan: NON_PKP, tanggal: T });
    expect(Math.round(r.reduce((s, x) => s + x, 0) * 100)).toBe(1_200);
  });
});
