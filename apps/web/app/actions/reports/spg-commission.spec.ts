import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { CommissionRecap } from "@/lib/spg-commission/queries";

const { mockAuth, mockGetCommissionRecap } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetCommissionRecap: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/spg-commission/queries", () => ({ getCommissionRecap: mockGetCommissionRecap }));

import { exportSpgCommissionRecap } from "./spg-commission";

function recap(): CommissionRecap {
  return {
    yearMonth: "2026-10",
    rows: [
      {
        salesmanId: "u1",
        storeIds: ["s1"],
        salesMonths: ["2026-09"],
        pieces: 20,
        noRatePieces: 0,
        figure: 40000,
        setAmount: 22500,
        paidAmount: 22500,
        unpaidAmount: 0,
        hasUnset: false,
        correctionsApplied: 0,
        pendingDifference: 17500,
        differs: false,
      },
      {
        salesmanId: "u2",
        storeIds: ["s1", "s2"],
        salesMonths: ["2026-08", "2026-09"],
        pieces: 10,
        noRatePieces: 0,
        figure: 20000,
        setAmount: 22500,
        paidAmount: 22500,
        unpaidAmount: 0,
        hasUnset: false,
        correctionsApplied: -2500,
        pendingDifference: -2500,
        differs: false,
      },
    ],
    payoutLines: [
      {
        reportKey: "konsi:c1",
        kind: "KONSI",
        storeId: "s1",
        salesMonth: "2026-09",
        payoutMonth: "2026-10",
        salesmanId: "u1",
        status: "DIBAYAR",
        figure: 40000,
        pieces: 20,
        noRatePieces: 0,
        setAmount: 22500,
        paidAmount: 22500,
        correctionsFromThis: 0,
        pendingDifference: 17500,
        differs: false,
        held: false,
      },
      {
        reportKey: "putus:s2:2026-09",
        kind: "PUTUS",
        storeId: "s2",
        salesMonth: "2026-09",
        payoutMonth: "2026-10",
        salesmanId: "u2",
        status: "TANPA_BARIS",
        figure: 2000,
        pieces: 1,
        noRatePieces: 0,
        setAmount: null,
        paidAmount: 0,
        correctionsFromThis: 0,
        pendingDifference: 2000,
        differs: false,
        held: false,
      },
    ],
    corrections: [
      {
        id: "k1",
        salesmanId: "u2",
        payoutMonth: "2026-10",
        sourceKey: "konsi:c0",
        sourceKind: "KONSI",
        sourceStoreId: "s1",
        sourceSalesMonth: "2026-08",
        sourceDocNo: "KONSI/26/08/0001",
        amount: -2500,
        note: "Koreksi komisi penjualan Agustus 2026 — Toko Satu",
        paidRefType: "ConsignmentCommission",
        paidRefId: "cc1",
        appliedToLabel: "Komisi penjualan September 2026 — Toko Satu",
        appliedAt: "2026-10-05T03:00:00.000Z",
      },
    ],
    detail: [],
    noRate: [],
    events: [
      {
        yearMonth: "2026-10",
        kind: "EARNED",
        sellThroughId: "konsi:c1",
        storeId: "s1",
        salesmanId: "u1",
        categoryId: "c1",
        pieces: 20,
        ratePerPiece: 2000,
        amount: 40000,
        salesMonth: "2026-09",
      },
      {
        yearMonth: "2026-10",
        kind: "EARNED",
        sellThroughId: "putus:s2:2026-09",
        storeId: "s2",
        salesmanId: "u2",
        categoryId: null,
        pieces: 1,
        ratePerPiece: null,
        amount: 0,
        salesMonth: "2026-09",
      },
    ],
    reportDocNos: { "konsi:c1": "KONSI/26/09/0001", "putus:s2:2026-09": "Penjualan September 2026" },
    spgNames: { u1: `Ani, "Mbak" Ani`, u2: "Budi" },
    storeNames: { s1: "Toko Satu", s2: "Toko Dua" },
    categoryNames: { c1: "Kaos" },
  };
}

const RINGKASAN = "Bulan Pembayaran,SPG,Toko,Bulan Penjualan,Pcs,Komisi per SPG,Dibayar,Koreksi Diterapkan,Belum Dibayar,Selisih ke Pembayaran Berikutnya";

describe("exportSpgCommissionRecap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCommissionRecap.mockResolvedValue(recap());
  });

  it("refuses an unauthenticated caller and reads nothing", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(exportSpgCommissionRecap("2026-10", "csv")).rejects.toThrow("Unauthorized");
    expect(mockGetCommissionRecap).not.toHaveBeenCalled();
  });

  it("refuses a caller without spg_sales:view and reads nothing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["spg_commission:manage"] } });
    await expect(exportSpgCommissionRecap("2026-10", "excel")).rejects.toThrow("Forbidden");
    expect(mockGetCommissionRecap).not.toHaveBeenCalled();
  });

  it("refuses an invalid month before reading", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["spg_sales:view"] } });
    await expect(exportSpgCommissionRecap("2026-13", "csv")).rejects.toThrow("Invalid month");
    expect(mockGetCommissionRecap).not.toHaveBeenCalled();
  });

  it("writes the summary as CSV with every cell quoted and embedded quotes doubled", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["spg_sales:view"] } });
    const result = await exportSpgCommissionRecap("2026-10", "csv");

    expect(mockGetCommissionRecap).toHaveBeenCalledWith("2026-10");
    expect(result.filename).toBe("komisi-spg-2026-10.csv");
    const body = [
      RINGKASAN,
      `"2026-10","Ani, ""Mbak"" Ani","Toko Satu","2026-09","20","40000","22500","0","0","17500"`,
      `"2026-10","Budi","Toko Dua, Toko Satu","2026-08, 2026-09","10","20000","22500","-2500","0","-2500"`,
      "",
    ].join("\n");
    expect(result.data).toBe(`﻿${body}`);
    // The recomputed figure is never labelled as the net paid commission any more.
    expect(result.data).not.toContain("Komisi Bersih");
    expect(result.data).not.toContain("Jenis");
  });

  it("opens the CSV with a UTF-8 BOM so Excel reads non-ASCII names", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["spg_sales:view"] } });
    mockGetCommissionRecap.mockResolvedValue({ ...recap(), spgNames: { u1: "Siti Nurhayati", u2: "Ayşe Çelik" } });
    const result = await exportSpgCommissionRecap("2026-10", "csv");

    expect(result.data?.charCodeAt(0)).toBe(0xfeff);
    expect(result.data?.slice(1).startsWith("Bulan Pembayaran,SPG,Toko,")).toBe(true);
    expect(result.data).toContain(`"Ayşe Çelik","Toko Dua, Toko Satu"`);
  });

  it("prefixes a text cell that would open as a formula with a quote, and never a negative amount", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["spg_sales:view"] } });
    const base = recap();
    mockGetCommissionRecap.mockResolvedValue({
      ...base,
      rows: [base.rows[0], { ...base.rows[1], storeIds: ["s2"] }],
      spgNames: { u1: `=HYPERLINK("http://x","y")`, u2: "@SUM(A1)" },
      storeNames: { s1: "+62 Toko", s2: "-Toko Dua" },
    });
    const result = await exportSpgCommissionRecap("2026-10", "csv");

    const [, first, second] = (result.data ?? "").split("\n");
    expect(first).toBe(`"2026-10","'=HYPERLINK(""http://x"",""y"")","'+62 Toko","2026-09","20","40000","22500","0","0","17500"`);
    // A negative amount stays a number: only the text cells get the quote.
    expect(second).toBe(`"2026-10","'@SUM(A1)","'-Toko Dua","2026-08, 2026-09","10","20000","22500","-2500","0","-2500"`);
  });

  it("guards a text cell opening with a tab or a carriage return", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["spg_sales:view"] } });
    mockGetCommissionRecap.mockResolvedValue({ ...recap(), spgNames: { u1: "\t=1+1", u2: "\r=1+1" } });
    const result = await exportSpgCommissionRecap("2026-10", "csv");

    expect(result.data).toContain(`"'\t=1+1","Toko Satu"`);
    expect(result.data).toContain(`"'\r=1+1","Toko Dua, Toko Satu"`);
  });

  it("writes an XLSX with the summary, one row per report, the corrections, and the per-category computation", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["*"] } });
    const result = await exportSpgCommissionRecap("2026-10", "excel");

    expect(result.filename).toBe("komisi-spg-2026-10.xlsx");
    const wb = XLSX.read(Buffer.from(result.base64 ?? "", "base64"), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Ringkasan", "Per laporan", "Koreksi", "Per kategori"]);

    const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Ringkasan);
    expect(summary[0]).toEqual({
      "Bulan Pembayaran": "2026-10",
      SPG: `Ani, "Mbak" Ani`,
      Toko: "Toko Satu",
      "Bulan Penjualan": "2026-09",
      Pcs: 20,
      "Komisi per SPG": 40000,
      Dibayar: 22500,
      "Koreksi Diterapkan": 0,
      "Belum Dibayar": 0,
      "Selisih ke Pembayaran Berikutnya": 17500,
    });

    const perLaporan = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Per laporan"], { defval: null });
    expect(perLaporan).toEqual([
      {
        "Bulan Pembayaran": "2026-10",
        "Bulan Penjualan": "2026-09",
        SPG: `Ani, "Mbak" Ani`,
        Toko: "Toko Satu",
        "No. Laporan": "KONSI/26/09/0001",
        Status: "Dibayar",
        Pcs: 20,
        "Komisi per SPG": 40000,
        Ditetapkan: 22500,
        Dibayar: 22500,
        "Koreksi dari Laporan Ini": 0,
        "Selisih ke Pembayaran Berikutnya": 17500,
      },
      {
        "Bulan Pembayaran": "2026-10",
        "Bulan Penjualan": "2026-09",
        SPG: "Budi",
        Toko: "Toko Dua",
        "No. Laporan": "Penjualan September 2026",
        Status: "Tanpa baris — lewat koreksi",
        Pcs: 1,
        "Komisi per SPG": 2000,
        Ditetapkan: null,
        Dibayar: 0,
        "Koreksi dari Laporan Ini": 0,
        "Selisih ke Pembayaran Berikutnya": 2000,
      },
    ]);

    const koreksi = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Koreksi);
    expect(koreksi).toEqual([
      {
        "Bulan Pembayaran": "2026-10",
        SPG: "Budi",
        Keterangan: "Koreksi komisi penjualan Agustus 2026 — Toko Satu",
        "Laporan Asal": "KONSI/26/08/0001",
        "Bulan Penjualan Asal": "2026-08",
        "Toko Asal": "Toko Satu",
        Jumlah: -2500,
        "Diterapkan Pada": "Komisi penjualan September 2026 — Toko Satu",
        "Tanggal Diterapkan": "2026-10-05",
      },
    ]);

    const perKategori = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Per kategori"], { defval: null });
    expect(perKategori).toEqual([
      {
        "Bulan Pembayaran": "2026-10",
        "Bulan Penjualan": "2026-09",
        SPG: `Ani, "Mbak" Ani`,
        Toko: "Toko Satu",
        "No. Laporan": "KONSI/26/09/0001",
        Kategori: "Kaos",
        Pcs: 20,
        "Tarif per Pcs": 2000,
        "Komisi per SPG": 40000,
      },
      {
        "Bulan Pembayaran": "2026-10",
        "Bulan Penjualan": "2026-09",
        SPG: "Budi",
        Toko: "Toko Dua",
        "No. Laporan": "Penjualan September 2026",
        Kategori: "Tanpa Kategori",
        Pcs: 1,
        "Tarif per Pcs": null,
        "Komisi per SPG": 0,
      },
    ]);
    for (const nama of wb.SheetNames) {
      const kepala = (XLSX.utils.sheet_to_json(wb.Sheets[nama], { header: 1 })[0] ?? []) as string[];
      expect(kepala).not.toContain("Komisi Bersih");
      expect(kepala).not.toContain("Komisi Diperoleh");
      expect(kepala).not.toContain("Komisi Dibatalkan");
      expect(kepala).not.toContain("Jenis");
    }
  });

  it("still writes every sheet with headers for a month with nothing in it", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["spg_sales:view"] } });
    mockGetCommissionRecap.mockResolvedValue({ ...recap(), rows: [], payoutLines: [], corrections: [], events: [] });
    const result = await exportSpgCommissionRecap("2026-10", "excel");

    const wb = XLSX.read(Buffer.from(result.base64 ?? "", "base64"), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Ringkasan", "Per laporan", "Koreksi", "Per kategori"]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Per kategori"], { header: 1 })).toEqual([
      ["Bulan Pembayaran", "Bulan Penjualan", "SPG", "Toko", "No. Laporan", "Kategori", "Pcs", "Tarif per Pcs", "Komisi per SPG"],
    ]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Koreksi, { header: 1 })).toEqual([
      ["Bulan Pembayaran", "SPG", "Keterangan", "Laporan Asal", "Bulan Penjualan Asal", "Toko Asal", "Jumlah", "Diterapkan Pada", "Tanggal Diterapkan"],
    ]);
  });
});
