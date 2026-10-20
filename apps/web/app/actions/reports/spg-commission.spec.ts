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
      { salesmanId: "u1", storeIds: ["s1"], pieces: 3, earned: 3000, reversed: 0, net: 3000, noRatePieces: 0 },
      { salesmanId: "u2", storeIds: ["s1", "s2"], pieces: -2, earned: 0, reversed: -2000, net: -2000, noRatePieces: 0 },
    ],
    detail: [],
    noRate: [],
    events: [
      {
        yearMonth: "2026-10",
        kind: "EARNED",
        sellThroughId: "st1",
        storeId: "s1",
        salesmanId: "u1",
        categoryId: "c1",
        pieces: 3,
        ratePerPiece: 1000,
        amount: 3000,
      },
      {
        yearMonth: "2026-10",
        kind: "REVERSED",
        sellThroughId: "st0",
        storeId: "s2",
        salesmanId: "u2",
        categoryId: null,
        pieces: -2,
        ratePerPiece: null,
        amount: 0,
      },
    ],
    reportDocNos: { st1: "KST/2610/0001", st0: "KST/2609/0007" },
    spgNames: { u1: `Ani, "Mbak" Ani`, u2: "Budi" },
    storeNames: { s1: "Toko Satu", s2: "Toko Dua" },
    categoryNames: { c1: "Kaos" },
  };
}

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
    expect(result.data).toBe(
      [
        "SPG,Toko,Pcs,Komisi Diperoleh,Komisi Dibatalkan,Komisi Bersih",
        `"Ani, ""Mbak"" Ani","Toko Satu","3","3000","0","3000"`,
        `"Budi","Toko Dua, Toko Satu","-2","0","-2000","-2000"`,
        "",
      ].join("\n"),
    );
  });

  it("writes an XLSX with the summary and one detail row per event", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["*"] } });
    const result = await exportSpgCommissionRecap("2026-10", "excel");

    expect(result.filename).toBe("komisi-spg-2026-10.xlsx");
    const wb = XLSX.read(Buffer.from(result.base64 ?? "", "base64"), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Ringkasan", "Rincian"]);

    const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Ringkasan);
    expect(summary).toEqual([
      { SPG: `Ani, "Mbak" Ani`, Toko: "Toko Satu", Pcs: 3, "Komisi Diperoleh": 3000, "Komisi Dibatalkan": 0, "Komisi Bersih": 3000 },
      { SPG: "Budi", Toko: "Toko Dua, Toko Satu", Pcs: -2, "Komisi Diperoleh": 0, "Komisi Dibatalkan": -2000, "Komisi Bersih": -2000 },
    ]);

    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Rincian, { defval: null });
    expect(detail).toEqual([
      {
        Bulan: "2026-10",
        SPG: `Ani, "Mbak" Ani`,
        Toko: "Toko Satu",
        "No. Laporan": "KST/2610/0001",
        Kategori: "Kaos",
        Jenis: "EARNED",
        Pcs: 3,
        "Tarif per Pcs": 1000,
        Jumlah: 3000,
      },
      {
        Bulan: "2026-10",
        SPG: "Budi",
        Toko: "Toko Dua",
        "No. Laporan": "KST/2609/0007",
        Kategori: "Tanpa Kategori",
        Jenis: "REVERSED",
        Pcs: -2,
        "Tarif per Pcs": null,
        Jumlah: 0,
      },
    ]);
  });

  it("still writes both sheets with headers for a month with no events", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u9", permissions: ["spg_sales:view"] } });
    mockGetCommissionRecap.mockResolvedValue({ ...recap(), rows: [], events: [] });
    const result = await exportSpgCommissionRecap("2026-10", "excel");

    const wb = XLSX.read(Buffer.from(result.base64 ?? "", "base64"), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Ringkasan", "Rincian"]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Rincian, { header: 1 })).toEqual([
      ["Bulan", "SPG", "Toko", "No. Laporan", "Kategori", "Jenis", "Pcs", "Tarif per Pcs", "Jumlah"],
    ]);
  });
});
