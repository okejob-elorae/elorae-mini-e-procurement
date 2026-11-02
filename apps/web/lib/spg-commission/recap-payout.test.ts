import { describe, expect, it } from "vitest";
import type { SpgReportCommission } from "./payout";
import { payoutLinesOf, payoutTotalsBySpg, type PayoutReportInput, type StoredSpgCommission } from "./recap-payout";

/*
 * Rekap komisi per bulan pembayaran (keputusan pemilik 2026-11-02): angka per SPG, yang
 * tersimpan, yang dibayar, koreksi yang sudah diterapkan, dan selisih ke pembayaran berikutnya —
 * tidak ada yang belum dibayar disebut dibayar. Contoh pemilik: tarif Rp 2.000, Ani 20 potong,
 * Sari 10 → Rp 40.000 / Rp 20.000; dulu dibayar bagi rata Rp 22.500 masing-masing.
 */

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
    salesMonth: "2026-09",
    payoutMonth: "2026-10",
    closed: true,
    stored: [simpan("ani", 40_000), simpan("sari", 20_000)],
    computed: [hitung("ani", 20, 40_000), hitung("sari", 10, 20_000)],
    appliedBySalesman: new Map(),
    ...overrides,
  };
}

function putus(overrides: Partial<PayoutReportInput> = {}): PayoutReportInput {
  return {
    key: "putus:sinar:2026-09",
    kind: "PUTUS",
    storeId: "sinar",
    salesMonth: "2026-09",
    payoutMonth: "2026-10",
    closed: false,
    stored: [simpan("dewi", 14_000, { pieces: 7 })],
    computed: [hitung("dewi", 7, 14_000)],
    appliedBySalesman: new Map(),
    ...overrides,
  };
}

const ringkas = (lines: ReturnType<typeof payoutLinesOf>) =>
  lines.map((l) => [l.salesmanId, l.status, l.figure, l.setAmount, l.paidAmount, l.pendingDifference, l.differs]);

describe("rekap komisi per SPG: angka per SPG, dibayar, koreksi, selisih", () => {
  it("siklus aturan lama yang SUDAH dibayar bagi rata 22.500 / 22.500: selisih +17.500 dan −2.500 menunggu pembayaran berikutnya", () => {
    const lines = payoutLinesOf([
      konsi({ stored: [simpan("ani", 22_500, { paid: true, oldRule: true }), simpan("sari", 22_500, { paid: true, oldRule: true })] }),
    ]);
    expect(ringkas(lines)).toEqual([
      ["ani", "DIBAYAR", 40_000, 22_500, 22_500, 17_500, false],
      ["sari", "DIBAYAR", 20_000, 22_500, 22_500, -2_500, false],
    ]);
    expect(Object.fromEntries(payoutTotalsBySpg(lines))).toEqual({
      ani: { figure: 40_000, setAmount: 22_500, paidAmount: 22_500, unpaidAmount: 0, hasUnset: false, correctionsApplied: 0, pendingDifference: 17_500, differs: false },
      sari: { figure: 20_000, setAmount: 22_500, paidAmount: 22_500, unpaidAmount: 0, hasUnset: false, correctionsApplied: 0, pendingDifference: -2_500, differs: false },
    });
  });

  it("sesudah koreksinya diterapkan, selisih laporan itu 0 — tidak diterapkan dua kali", () => {
    const lines = payoutLinesOf([
      konsi({
        stored: [simpan("ani", 22_500, { paid: true, oldRule: true }), simpan("sari", 22_500, { paid: true, oldRule: true })],
        appliedBySalesman: new Map([
          ["ani", 17_500],
          ["sari", -2_500],
        ]),
      }),
    ]);
    expect(lines.map((l) => [l.salesmanId, l.correctionsFromThis, l.pendingDifference])).toEqual([
      ["ani", 17_500, 0],
      ["sari", -2_500, 0],
    ]);
  });

  it("koreksi minus yang baru sebagian diterapkan (lantai Rp 0) menyisakan selisihnya", () => {
    const [sari] = payoutLinesOf([
      konsi({ stored: [simpan("sari", 22_500, { paid: true, oldRule: true })], computed: [hitung("sari", 10, 20_000)], appliedBySalesman: new Map([["sari", -2_000]]) }),
    ]);
    expect(sari.pendingDifference).toBe(-500);
  });

  it("baris yang belum dibayar: tidak ada selisih (dibayar dengan angka per SPG), angka tersimpan yang berbeda ditandai diganti", () => {
    const lines = payoutLinesOf([konsi({ stored: [simpan("ani", 22_500, { oldRule: true }), simpan("sari", 20_000)] })]);
    expect(ringkas(lines)).toEqual([
      ["ani", "DITETAPKAN", 40_000, 22_500, 0, 0, true],
      ["sari", "DITETAPKAN", 20_000, 20_000, 0, 0, false],
    ]);
    expect(payoutTotalsBySpg(lines).get("ani")).toMatchObject({ unpaidAmount: 40_000, differs: true });
  });

  it("toko putus yang dicek tapi belum ditetapkan: BELUM_DITETAPKAN, belum dibayar = angka per SPG", () => {
    const lines = payoutLinesOf([putus({ stored: null })]);
    expect(ringkas(lines)).toEqual([["dewi", "BELUM_DITETAPKAN", 14_000, null, 0, 0, false]]);
    expect(payoutTotalsBySpg(lines).get("dewi")).toMatchObject({ unpaidAmount: 14_000, hasUnset: true, paidAmount: 0 });
  });

  it("toko putus aturan lama: potong yang berbeda atau dasar lama menandai baris belum dibayar diganti", () => {
    const lines = payoutLinesOf([putus({ stored: [simpan("dewi", 14_000, { pieces: 7, oldRule: true })] })]);
    expect(lines[0]).toMatchObject({ status: "DITETAPKAN", differs: true });
    const potongBeda = payoutLinesOf([putus({ stored: [simpan("dewi", 14_000, { pieces: 6 })] })]);
    expect(potongBeda[0].differs).toBe(true);
  });

  it("penjual tanpa baris di laporan tertutup (nota HP masuk sesudah dikunci): TANPA_BARIS dengan selisih penuh", () => {
    const lines = payoutLinesOf([konsi({ computed: [hitung("ani", 20, 40_000), hitung("sari", 10, 20_000), hitung("rina", 3, 6_000)] })]);
    expect(lines.find((l) => l.salesmanId === "rina")).toMatchObject({ status: "TANPA_BARIS", setAmount: null, pendingDifference: 6_000 });
  });

  it("penjual tanpa baris di bulan putus yang belum ada yang dibayar: belum tertutup, tidak ada selisih", () => {
    const lines = payoutLinesOf([putus({ computed: [hitung("dewi", 7, 14_000), hitung("rina", 1, 2_000)] })]);
    expect(lines.find((l) => l.salesmanId === "rina")).toMatchObject({ status: "TANPA_BARIS", pendingDifference: 0 });
  });

  it("unit yang ditahan menunggu keputusan pemilik: tanpa selisih otomatis", () => {
    const lines = payoutLinesOf([
      konsi({
        stored: [simpan("ani", 22_500, { paid: true, oldRule: true })],
        computed: [hitung("ani", 20, 0, 20)],
        heldSalesmen: new Set(["ani"]),
      }),
    ]);
    expect(lines[0]).toMatchObject({ held: true, pendingDifference: 0, paidAmount: 22_500 });
  });

  it("baris belum dibayar yang ditahan: tidak 'diganti saat dibayar', dan belum dibayarnya sebesar angka tersimpan, bukan Rp 0", () => {
    const lines = payoutLinesOf([
      putus({
        closed: true,
        stored: [simpan("ani", 22_500, { pieces: 15, oldRule: true, paid: true }), simpan("sari", 22_500, { pieces: 15, oldRule: true })],
        computed: [hitung("ani", 20, 0, 20), hitung("sari", 10, 0, 10)],
        heldSalesmen: new Set(["ani", "sari"]),
      }),
    ]);
    expect(lines.find((l) => l.salesmanId === "sari")).toMatchObject({ status: "DITETAPKAN", held: true, differs: false, pendingDifference: 0 });
    expect(lines.find((l) => l.salesmanId === "ani")).toMatchObject({ status: "DIBAYAR", held: true, pendingDifference: 0 });
    expect(payoutTotalsBySpg(lines).get("sari")).toMatchObject({ figure: 0, unpaidAmount: 22_500, differs: false, pendingDifference: 0 });
  });

  it("baris konsi Rp 0 tanpa penjualan tidak tampil; koreksi bulan ini dijumlah per SPG", () => {
    const lines = payoutLinesOf([konsi({ stored: [simpan("ani", 40_000), simpan("budi", 0)] })]);
    expect(lines.map((l) => l.salesmanId)).toEqual(["ani", "sari"]);
    const totals = payoutTotalsBySpg(lines, [
      { salesmanId: "ani", amount: 17_500 },
      { salesmanId: "lina", amount: -2_500 },
    ]);
    expect(totals.get("ani")?.correctionsApplied).toBe(17_500);
    expect(totals.get("lina")).toMatchObject({ correctionsApplied: -2_500, figure: 0 });
  });
});
