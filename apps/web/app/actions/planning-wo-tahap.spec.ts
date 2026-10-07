import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "Buat WO" dari tahap Plan Kerja: dulu aksi ini memanggil `redirect()` dan
 * melempar Error biasa — layar menangkap keduanya sebagai galat, dan di build
 * produksi pesannya disamarkan. Kini penolakan dikembalikan sebagai kode dan
 * layar yang berpindah ke WO baru. Tanpa basis data: prisma ditiru.
 */

const keadaan = vi.hoisted(() => ({
  izin: ["*"] as string[],
  tahap: null as null | Record<string, unknown>,
  wo: null as null | { docNumber: string; status: string },
  barang: null as null | { type: string; variants: unknown },
  dibuat: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", permissions: keadaan.izin } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/app/actions/production", () => ({
  createWorkOrder: vi.fn(async (data: unknown) => {
    keadaan.dibuat.push(data);
    return { id: "wo-baru", docNumber: "WO/2026/0099" };
  }),
}));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<Record<string, unknown>>();
  return {
    ...asli,
    prisma: {
      planStage: {
        findUnique: vi.fn(async () => keadaan.tahap),
        update: vi.fn(async () => ({})),
      },
      workOrder: { findUnique: vi.fn(async () => keadaan.wo) },
      item: { findUnique: vi.fn(async () => keadaan.barang) },
    },
  };
});

const { createWorkOrderFromStage } = await import("./planning");

const VARIAN = JSON.stringify([{ sku: "KMJ-01-M", name: "M" }]);

beforeEach(() => {
  keadaan.izin = ["*"];
  keadaan.tahap = {
    id: "t1",
    name: "Gelombang 1",
    supplierId: "v1",
    targetQty: 120,
    variantSku: "KMJ-01-M",
    workOrderId: null,
    planCategory: { itemId: "fg1", code: "KMJ" },
  };
  keadaan.wo = null;
  keadaan.barang = { type: "FINISHED_GOOD", variants: VARIAN };
  keadaan.dibuat = [];
});

describe("createWorkOrderFromStage", () => {
  it("berhasil → { ok, id, docNumber } tanpa redirect; WO 120 pcs SKU varian tahap", async () => {
    expect(await createWorkOrderFromStage("t1")).toEqual({ ok: true, id: "wo-baru", docNumber: "WO/2026/0099" });
    expect(keadaan.dibuat).toEqual([
      expect.objectContaining({ vendorId: "v1", finishedGoodId: "fg1", plannedQty: 120, skuBreakdown: [{ variantSku: "KMJ-01-M", ratioPercent: 100 }] }),
    ]);
  });

  it("penolakan dikembalikan sebagai kode", async () => {
    keadaan.tahap = { ...keadaan.tahap!, supplierId: null };
    expect(await createWorkOrderFromStage("t1")).toEqual({ ok: false, code: "TANPA_VENDOR" });

    keadaan.tahap = { ...keadaan.tahap!, supplierId: "v1", workOrderId: "w-lama" };
    keadaan.wo = { docNumber: "WO/2026/0003", status: "IN_PRODUCTION" };
    expect(await createWorkOrderFromStage("t1")).toEqual({ ok: false, code: "SUDAH_ADA_WO", docNumber: "WO/2026/0003" });

    keadaan.wo = { docNumber: "WO/2026/0003", status: "CANCELLED" };
    keadaan.tahap = { ...keadaan.tahap!, variantSku: " " };
    expect(await createWorkOrderFromStage("t1")).toEqual({ ok: false, code: "TAHAP_TANPA_VARIAN" });

    keadaan.barang = { type: "FINISHED_GOOD", variants: null };
    expect(await createWorkOrderFromStage("t1")).toEqual({ ok: false, code: "BARANG_TANPA_VARIAN" });

    keadaan.tahap = null;
    expect(await createWorkOrderFromStage("t1")).toEqual({ ok: false, code: "TAHAP_TIDAK_ADA" });
    expect(keadaan.dibuat).toEqual([]);
  });

  it("tanpa izin membuat WO → TANPA_AKSES", async () => {
    keadaan.izin = ["production_planning:manage"];
    expect(await createWorkOrderFromStage("t1")).toEqual({ ok: false, code: "TANPA_AKSES" });
  });
});
