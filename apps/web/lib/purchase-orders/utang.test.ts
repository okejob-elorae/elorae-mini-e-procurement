import { describe, expect, it } from "vitest";
import { hitungUtangPo } from "./utang";

/*
 * Utang ke pemasok untuk satu PO: total PO, dikurangi nilai barang yang TIDAK
 * akan datang (hanya PO yang ditutup lewat "Tutup PO"), dikurangi retur ke
 * pemasok yang sudah selesai. Bukan jurnal — GL tidak disentuh.
 */

const PO = {
  status: "CLOSED",
  grandTotal: 1_000_000,
  ppnRatePercent: 11,
  closedAt: null as Date | null,
  items: [{ qty: 20, receivedQty: 20, price: 50_000, ppnIncluded: true }],
};

describe("hitungUtangPo", () => {
  it("retur 2 × 50.000 mengurangi utang 100.000: 1.000.000 → 900.000", () => {
    expect(hitungUtangPo(PO, 100_000)).toEqual({
      nilaiPo: 1_000_000,
      nilaiTidakDatang: 0,
      kreditRetur: 100_000,
      utang: 900_000,
    });
  });

  it("PO terbuka yang kurang kirim tetap utang penuh (barangnya masih ditunggu)", () => {
    const po = { ...PO, items: [{ qty: 20, receivedQty: 12, price: 50_000, ppnIncluded: true }] };
    expect(hitungUtangPo(po, 0).utang).toBe(1_000_000);
  });

  it("PO yang ditutup kurang kirim: sisa yang tidak datang (+PPN baris tanpa PPN) tidak diutangi", () => {
    // 100 kaos @85.000 tanpa PPN, datang 60; PPN 11%. Total PO 9.435.000.
    const po = {
      status: "CLOSED",
      grandTotal: 9_435_000,
      ppnRatePercent: 11,
      closedAt: new Date("2026-10-06T03:00:00Z"),
      items: [{ qty: 100, receivedQty: 60, price: 85_000, ppnIncluded: false }],
    };
    // Sisa 40 × 85.000 = 3.400.000 + PPN 374.000 = 3.774.000 → utang 5.661.000.
    expect(hitungUtangPo(po, 0)).toEqual({
      nilaiPo: 9_435_000,
      nilaiTidakDatang: 3_774_000,
      kreditRetur: 0,
      utang: 5_661_000,
    });
    // Ditambah retur 1 kaos (85.000 + 9.350): 5.566.650.
    expect(hitungUtangPo(po, 94_350).utang).toBe(5_566_650);
  });

  it("PO tertutup yang dibuka lagi oleh GRN (PARTIAL, closedAt tetap): sisanya ditunggu lagi, utang penuh", () => {
    const po = {
      status: "PARTIAL",
      grandTotal: 9_435_000,
      ppnRatePercent: 11,
      closedAt: new Date("2026-10-06T03:00:00Z"),
      items: [{ qty: 100, receivedQty: 70, price: 85_000, ppnIncluded: false }],
    };
    expect(hitungUtangPo(po, 0)).toEqual({ nilaiPo: 9_435_000, nilaiTidakDatang: 0, kreditRetur: 0, utang: 9_435_000 });
  });

  it("PO lengkap lewat GRN (CLOSED tanpa closedAt): tidak ada pengurang", () => {
    const po = { ...PO, closedAt: null, items: [{ qty: 20, receivedQty: 12, price: 50_000, ppnIncluded: true }] };
    expect(hitungUtangPo(po, 0).utang).toBe(1_000_000);
  });

  it("utang tidak pernah negatif", () => {
    expect(hitungUtangPo(PO, 1_500_000).utang).toBe(0);
  });

  it("menerima Decimal Prisma dan string", () => {
    const dec = (s: string) => ({ toString: () => s });
    const po = { ...PO, grandTotal: dec("1000000.00"), ppnRatePercent: dec("11.00") };
    expect(hitungUtangPo(po, "100000.00").utang).toBe(900_000);
  });
});
