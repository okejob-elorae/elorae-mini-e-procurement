import { describe, expect, it, vi } from "vitest";

/*
 * `@/app/actions/reports` harus menunjuk folder `reports/` (berpagar
 * `wajibIzinLaporan`), bukan berkas `reports.ts` lama di sebelahnya.
 *
 * Berkas lama itu `"use server"` tanpa satu pun pemeriksaan sesi: setiap
 * ekspornya titik akhir yang bisa dipanggil siapa pun yang sudah masuk, dan
 * selama ia ada, impor tanpa sub-jalur di-resolve ke sana lebih dulu daripada
 * `reports/index.ts`.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@elorae/db", () => ({ prisma: {} }));

describe("@/app/actions/reports", () => {
  it("di-resolve ke reports/index.ts yang berpagar", async () => {
    const m: Record<string, unknown> = await import("@/app/actions/reports");
    expect(typeof m.getSuppliersForReportFilter).toBe("function");
    await expect((m.getSuppliersForReportFilter as () => Promise<unknown>)()).rejects.toThrow(/Unauthorized/);
  });

  it("aksi laporan lama tanpa pagar tidak lagi bisa diimpor", async () => {
    const m: Record<string, unknown> = await import("@/app/actions/reports");
    for (const lama of [
      "getProcurementReport",
      "getInventoryReport",
      "getProductionReport",
      "getETAReport",
      "getStockMovementReport",
      "getDashboardSummary",
    ]) {
      expect(m[lama]).toBeUndefined();
    }
  });
});
