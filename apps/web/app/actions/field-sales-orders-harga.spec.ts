import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit: auth, rbac dan fungsi penulis dipalsukan; kelas galat `HargaFinalTidakSahError`
 * tetap yang asli. Penulis menolak harga final banding yang tidak sah; aksi harus
 * memetakannya ke INVALID_FINAL_PRICE (yang sudah dipahami kartu persetujuan), bukan
 * melempar galat yang di produksi tertutup digest.
 */
const { mockAuth, mockHasPermission, mockApprove } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHasPermission: vi.fn(),
  mockApprove: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rbac")>();
  return { ...actual, hasPermission: mockHasPermission };
});
vi.mock("@/lib/field-sales/writer", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/field-sales/writer")>();
  return { ...actual, approveFieldSalesOrder: mockApprove };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { HargaFinalTidakSahError } from "@/lib/field-sales/writer";
import { approveFieldSalesOrderAction } from "./field-sales-orders";

describe("approveFieldSalesOrderAction — harga final banding", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockApprove.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["field_sales_orders:approve"] } });
    mockHasPermission.mockReturnValue(true);
  });

  it("memetakan HargaFinalTidakSahError dari penulis ke INVALID_FINAL_PRICE", async () => {
    mockApprove.mockRejectedValue(new HargaFinalTidakSahError("line-1", Number.NaN));
    const res = await approveFieldSalesOrderAction("o1", [{ lineId: "line-1", finalUnitPrice: 50_000 }]);
    expect(res).toEqual({ ok: false, reason: "INVALID_FINAL_PRICE" });
  });

  it("galat lain yang tidak dikenal tetap dilempar", async () => {
    mockApprove.mockRejectedValue(new Error("lain"));
    await expect(approveFieldSalesOrderAction("o1")).rejects.toThrow("lain");
  });
});
