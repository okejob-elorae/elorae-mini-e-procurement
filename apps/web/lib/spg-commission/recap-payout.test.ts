import { describe, expect, it } from "vitest";
import type { SpgReportCommission } from "./payout";
import { payoutLinesOf, payoutTotalsBySpg, type PayoutReportInput, type StoredSpgCommission } from "./recap-payout";

const hitung = (salesmanId: string, pieces: number, amount: number, noRatePieces = 0): SpgReportCommission => ({
  salesmanId,
  pieces,
  amount,
  noRatePieces,
});

const simpan = (salesmanId: string, commission: number, overrides: Partial<StoredSpgCommission> = {}): StoredSpgCommission => ({
  salesmanId,
  commission,
  pieces: null,
  oldRule: false,
  paid: false,
  ...overrides,
});

function konsi(overrides: Partial<PayoutReportInput> = {}): PayoutReportInput {
  return {
    key: "konsi:melati",
    kind: "KONSI",
    storeId: "melati",
    salesMonth: "2026-10",
    stored: [simpan("ani", 40_000), simpan("sari", 20_000)],
    computed: [hitung("ani", 20, 40_000), hitung("sari", 10, 20_000)],
    ...overrides,
  };
}

function putus(overrides: Partial<PayoutReportInput> = {}): PayoutReportInput {
  return {
    key: "putus:sinar:2026-10",
    kind: "PUTUS",
    storeId: "sinar",
    salesMonth: "2026-10",
    stored: [simpan("dewi", 14_000, { pieces: 7 })],
    computed: [hitung("dewi", 7, 14_000)],
    ...overrides,
  };
}

const ringkas = (lines: ReturnType<typeof payoutLinesOf>) =>
  lines.map((l) => [l.salesmanId, l.status, l.setAmount, l.computedAmount, l.differs]);

describe("rekap komisi: angka yang dibayar adalah yang tersimpan, hitungan di sampingnya", () => {
  it("siklus konsi yang dikunci dengan aturan lama: yang tampil dibayar adalah angka kuncinya, hitungan sekarang ditandai berbeda", () => {
    // Dikunci dengan tarif barang dibagi rata: Rp 45.000 masing-masing; hitungan sekarang 40.000 / 20.000.
    const lines = payoutLinesOf([konsi({ stored: [simpan("ani", 45_000, { paid: true }), simpan("sari", 45_000)] })]);
    expect(ringkas(lines)).toEqual([
      ["ani", "DIBAYAR", 45_000, 40_000, true],
      ["sari", "DITETAPKAN", 45_000, 20_000, true],
    ]);
    expect(Object.fromEntries(payoutTotalsBySpg(lines))).toEqual({
      ani: { setAmount: 45_000, unsetAmount: 0, paidAmount: 45_000, differs: true, hasUnset: false },
      sari: { setAmount: 45_000, unsetAmount: 0, paidAmount: 0, differs: true, hasUnset: false },
    });
  });

  it("nota yang masuk sesudah dikunci tidak mengubah yang dibayar: penjual baru tanpa baris gaji dibayar 0 dan ditandai", () => {
    const lines = payoutLinesOf([konsi({ computed: [hitung("ani", 20, 40_000), hitung("sari", 10, 20_000), hitung("tari", 2, 4_000)] })]);
    expect(ringkas(lines)).toEqual([
      ["ani", "DITETAPKAN", 40_000, 40_000, false],
      ["sari", "DITETAPKAN", 20_000, 20_000, false],
      ["tari", "DITETAPKAN", 0, 4_000, true],
    ]);
  });

  it("konsi: baris gaji Rp 0 SPG yang tidak menjual bukan komisi dan tidak muncul", () => {
    const lines = payoutLinesOf([konsi({ stored: [simpan("ani", 40_000), simpan("sari", 20_000), simpan("diam", 0)] })]);
    expect(lines.map((l) => l.salesmanId)).toEqual(["ani", "sari"]);
  });

  it("toko putus yang sudah dicek tapi belum ditetapkan: belum ditetapkan, bukan dibayar — hitungannya dihitung terpisah", () => {
    const lines = payoutLinesOf([putus({ stored: null })]);
    expect(ringkas(lines)).toEqual([["dewi", "BELUM_DITETAPKAN", null, 14_000, false]]);
    expect(payoutTotalsBySpg(lines).get("dewi")).toEqual({ setAmount: 0, unsetAmount: 14_000, paidAmount: 0, differs: false, hasUnset: true });
  });

  it("toko putus yang ditetapkan: sama persis tidak berbeda; pengembalian yang menyusul, aturan lama, dan baris tanpa hitungan berbeda", () => {
    expect(ringkas(payoutLinesOf([putus()]))).toEqual([["dewi", "DITETAPKAN", 14_000, 14_000, false]]);
    // Rupiah sama tetapi potong berbeda (mis. tarif berubah): tetap berbeda, seperti `sudahBerbeda`.
    expect(payoutLinesOf([putus({ stored: [simpan("dewi", 14_000, { pieces: 8 })] })])[0].differs).toBe(true);
    expect(payoutLinesOf([putus({ stored: [simpan("dewi", 14_000, { pieces: 7, oldRule: true })] })])[0].differs).toBe(true);
    expect(payoutLinesOf([putus({ computed: [hitung("dewi", 5, 10_000)] })])[0]).toMatchObject({ setAmount: 14_000, computedAmount: 10_000, differs: true });
    // Semua penjualannya dikembalikan sesudah ditetapkan: barisnya tetap tampil dengan angka tersimpannya.
    expect(ringkas(payoutLinesOf([putus({ computed: [] })]))).toEqual([["dewi", "DITETAPKAN", 14_000, 0, true]]);
  });

  it("satu SPG di dua laporan: totalnya menjumlah yang tersimpan, yang belum ditetapkan, dan yang dibayar terpisah", () => {
    const lines = payoutLinesOf([
      putus({ stored: [simpan("dewi", 14_000, { pieces: 7, paid: true })] }),
      putus({ key: "putus:sinar:2026-09", salesMonth: "2026-09", stored: null, computed: [hitung("dewi", 3, 6_000, 1)] }),
    ]);
    expect(payoutTotalsBySpg(lines).get("dewi")).toEqual({ setAmount: 14_000, unsetAmount: 6_000, paidAmount: 14_000, differs: false, hasUnset: true });
    expect(lines[1]).toMatchObject({ computedPieces: 3, computedNoRatePieces: 1, setAmount: null });
  });
});
