import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Catatan "N pemasok tidak tampil" di Papan Pemasok — pagar izin sama dengan
 * pemuat papan (`lead_time:view`), tautan hanya untuk pemegang
 * `suppliers:view`. Tanpa basis data: sesi dan `prisma.supplier.groupBy` ditiru.
 */

const keadaan = vi.hoisted(() => ({
  sesi: { user: { id: "u1", permissions: ["*"] as string[] } } as null | { user: { id?: string; permissions?: string[] } },
}));

const tiru = vi.hoisted(() => ({
  groupBy: vi.fn(async () => [
    { status: "ACTIVE", isActive: true, _count: { _all: 11 } },
    { status: "PENDING_APPROVAL", isActive: true, _count: { _all: 2 } },
    { status: "ACTIVE", isActive: false, _count: { _all: 1 } },
  ]),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => keadaan.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/leadtime/rantai-pemasok-writer", () => ({
  MAKS_PEMASOK_MASSAL: 500,
  sisipkanLangkahPemasok: vi.fn(),
  aturProsesBanyakPemasok: vi.fn(),
}));
vi.mock("@elorae/db", () => ({ prisma: { supplier: { groupBy: tiru.groupBy } } }));

const { hitungPemasokTersembunyiPapanAction } = await import("./lead-time");

beforeEach(() => {
  keadaan.sesi = { user: { id: "u1", permissions: ["*"] } };
  tiru.groupBy.mockClear();
});

describe("hitungPemasokTersembunyiPapanAction", () => {
  it("menghitung yang tidak dimuat papan per kelompok", async () => {
    expect(await hitungPemasokTersembunyiPapanAction()).toEqual({
      ok: true,
      jumlah: { menunggu: 2, nonaktif: 1, ditolak: 0 },
      bolehBukaPemasok: true,
    });
    expect(tiru.groupBy).toHaveBeenCalledTimes(1);
  });

  it("tanpa sesi atau tanpa lead_time:view → TANPA_AKSES, basis data tidak dibaca", async () => {
    for (const sesi of [null, { user: { permissions: ["*"] } }, { user: { id: "u1", permissions: ["suppliers:view"] } }]) {
      keadaan.sesi = sesi;
      expect(await hitungPemasokTersembunyiPapanAction()).toEqual({ ok: false, code: "TANPA_AKSES" });
    }
    expect(tiru.groupBy).not.toHaveBeenCalled();
  });

  it("lead_time:view tanpa suppliers:view → hitungan tetap ada, tanpa tautan", async () => {
    keadaan.sesi = { user: { id: "u1", permissions: ["lead_time:view"] } };
    const hasil = await hitungPemasokTersembunyiPapanAction();
    expect(hasil).toMatchObject({ ok: true, bolehBukaPemasok: false });
  });

  it("galat basis data → GAGAL, tidak dilempar", async () => {
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    tiru.groupBy.mockRejectedValueOnce(new Error("koneksi putus"));
    expect(await hitungPemasokTersembunyiPapanAction()).toEqual({ ok: false, code: "GAGAL" });
    galat.mockRestore();
  });
});
