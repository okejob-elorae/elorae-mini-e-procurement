import { describe, expect, it } from "vitest";
import type { CommissionRate } from "./compute";
import {
  commissionPerSpg,
  konsiReportKey,
  payoutMonth,
  putusReportKey,
  reportTotals,
  salesMonthLabelId,
  salesMonthNoteId,
  salesReportEvents,
  toCommissionReport,
  type SalesReport,
  type SpgSaleMovement,
} from "./payout";

/** 5 November 2026, 10:00 WIB — the office checks October's report. */
const CHECKED_NOV = new Date("2026-11-05T03:00:00.000Z");

const rates: CommissionRate[] = [
  { itemCategoryId: "kaos", effectiveFrom: "2026-01", amountPerPiece: 2_000 },
  { itemCategoryId: "kemeja", effectiveFrom: "2026-01", amountPerPiece: 1_000 },
  /* A rate set for November does not reach October's sales, even when October is checked in November. */
  { itemCategoryId: "kaos", effectiveFrom: "2026-11", amountPerPiece: 9_000 },
];

const jual = (salesmanId: string, itemId: string, categoryId: string | null, qty: number): SpgSaleMovement => ({ salesmanId, itemId, categoryId, qty });

function konsi(overrides: Partial<SalesReport> = {}): SalesReport {
  return {
    key: konsiReportKey("cycle-melati-okt"),
    kind: "KONSI",
    storeId: "melati",
    salesMonth: "2026-10",
    checkedAt: CHECKED_NOV,
    official: [{ itemId: "kaos-1", qty: 30 }],
    movements: [jual("ani", "kaos-1", "kaos", 20), jual("sari", "kaos-1", "kaos", 10)],
    ...overrides,
  };
}

function putus(overrides: Partial<SalesReport> = {}): SalesReport {
  return {
    key: putusReportKey("sinar-jaya", "2026-10"),
    kind: "PUTUS",
    storeId: "sinar-jaya",
    salesMonth: "2026-10",
    checkedAt: CHECKED_NOV,
    official: null,
    movements: [jual("dewi", "kemeja-1", "kemeja", 50), jual("dewi", "kemeja-1", "kemeja", -3)],
    ...overrides,
  };
}

describe("komisi SPG — satu hitungan (keputusan pemilik 2026-11-01)", () => {
  it("contoh pemilik: tarif kategori Rp 2.000, Ani menjual 20 dan Sari 10 → Ani Rp 40.000, Sari Rp 20.000 (bukan Rp 22.500 masing-masing)", () => {
    expect(commissionPerSpg(konsi(), rates)).toEqual([
      { salesmanId: "ani", pieces: 20, amount: 40_000, noRatePieces: 0 },
      { salesmanId: "sari", pieces: 10, amount: 20_000, noRatePieces: 0 },
    ]);
  });

  it("toko putus memakai tarif kategori yang sama: Dewi 50 kemeja, 3 dikembalikan pembeli → 47 × Rp 1.000", () => {
    expect(commissionPerSpg(putus(), rates)).toEqual([{ salesmanId: "dewi", pieces: 47, amount: 47_000, noRatePieces: 0 }]);
  });

  it("toko konsi dan toko putus dengan barang sekategori dibayar dengan tarif yang sama", () => {
    const sama = [jual("ani", "kaos-1", "kaos", 5)];
    const k = commissionPerSpg(konsi({ official: [{ itemId: "kaos-1", qty: 5 }], movements: sama }), rates);
    const p = commissionPerSpg(putus({ movements: sama }), rates);
    expect(k).toEqual(p);
    expect(k[0].amount).toBe(5 * 2_000);
  });

  it("konsi: angka resmi di bawah catatan kasir membatasi potong terkonfirmasi, dibagi menurut penjualan masing-masing", () => {
    // Resmi 15 dari 30 yang tercatat kasir: 15 dibagi 20:10 → 10 dan 5.
    expect(commissionPerSpg(konsi({ official: [{ itemId: "kaos-1", qty: 15 }] }), rates).map((r) => [r.salesmanId, r.pieces, r.amount])).toEqual([
      ["ani", 10, 20_000],
      ["sari", 5, 10_000],
    ]);
  });

  it("konsi: potong yang dilaporkan toko tetapi tidak tercatat di kasir SPG bukan penjualan SPG siapa pun", () => {
    const hasil = commissionPerSpg(konsi({ official: [{ itemId: "kaos-1", qty: 40 }, { itemId: "kaos-2", qty: 7 }] }), rates);
    expect(reportTotals(hasil)).toEqual({ pieces: 30, amount: 60_000, noRatePieces: 0 });
  });

  it("pengembalian pembeli hanya mengurangi penjual nota aslinya, tidak pernah di bawah nol", () => {
    const hasil = commissionPerSpg(
      putus({
        movements: [jual("dewi", "kemeja-1", "kemeja", 4), jual("rina", "kemeja-1", "kemeja", 2), jual("rina", "kemeja-1", "kemeja", -5)],
      }),
      rates,
    );
    expect(hasil).toEqual([{ salesmanId: "dewi", pieces: 4, amount: 4_000, noRatePieces: 0 }]);
  });

  it("barang tanpa kategori, atau kategori tanpa tarif, tidak berkomisi dan dilaporkan", () => {
    const hasil = commissionPerSpg(putus({ movements: [jual("dewi", "x", null, 3), jual("dewi", "topi-1", "topi", 2)] }), rates);
    expect(hasil).toEqual([{ salesmanId: "dewi", pieces: 5, amount: 0, noRatePieces: 5 }]);
  });

  it("tidak ada angka dari tarif barang: gerakan penjualan tidak membawa `commissionPerPcs`, hanya kategori", () => {
    const baris = toCommissionReport(putus()).lines[0];
    expect(Object.keys(baris).sort()).toEqual(["billedQty", "categoryId", "itemId", "perSpgPosQty", "posQty", "variantSku"]);
  });
});

describe("bulan pembayaran dan catatan bulan penjualan", () => {
  it("penjualan Oktober yang dicek 5 November dibayar November dengan catatan 'Komisi penjualan Oktober 2026'", () => {
    const events = salesReportEvents([konsi()], rates);
    expect(events.map((e) => [e.yearMonth, e.salesMonth])).toEqual([
      ["2026-11", "2026-10"],
      ["2026-11", "2026-10"],
    ]);
    expect(payoutMonth(CHECKED_NOV)).toBe("2026-11");
    expect(salesMonthNoteId("2026-10")).toBe("Komisi penjualan Oktober 2026");
  });

  it("tarif yang dipakai tarif bulan penjualan, bukan bulan dicek", () => {
    expect(salesReportEvents([konsi()], rates).map((e) => e.ratePerPiece)).toEqual([2_000, 2_000]);
    const november = salesReportEvents([konsi({ salesMonth: "2026-11", checkedAt: new Date("2026-12-02T03:00:00.000Z") })], rates);
    expect(november.map((e) => [e.yearMonth, e.ratePerPiece])).toEqual([
      ["2026-12", 9_000],
      ["2026-12", 9_000],
    ]);
  });

  it("bulan pembayaran menurut WIB: dicek 31 Oktober 17:30 UTC = 1 November WIB", () => {
    expect(payoutMonth(new Date("2026-10-31T17:30:00.000Z"))).toBe("2026-11");
    expect(payoutMonth(new Date("2026-10-31T16:59:59.000Z"))).toBe("2026-10");
  });

  it("nama bulan Indonesia tetap, tanpa bergantung pada lokal mesin", () => {
    expect(salesMonthLabelId("2026-01")).toBe("Januari 2026");
    expect(salesMonthLabelId("2025-12")).toBe("Desember 2025");
    expect(salesMonthLabelId("bukan-bulan")).toBe("bukan-bulan");
  });

  it("dua laporan bulan penjualan berbeda yang dicek di bulan yang sama masuk satu bulan pembayaran, masing-masing dengan catatannya", () => {
    const events = salesReportEvents([konsi({ salesMonth: "2026-09" }), putus()], rates);
    expect(new Set(events.map((e) => e.yearMonth))).toEqual(new Set(["2026-11"]));
    expect(events.map((e) => [e.sellThroughId, e.salesMonth])).toEqual([
      [konsiReportKey("cycle-melati-okt"), "2026-09"],
      [konsiReportKey("cycle-melati-okt"), "2026-09"],
      [putusReportKey("sinar-jaya", "2026-10"), "2026-10"],
    ]);
  });
});
