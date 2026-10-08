import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Nilai bawaan push Jubelio tidak lagi memuat margin dan biaya tambahan:
 * harga jual diisi manual pemilik (keputusan pemilik 2026-10-08), jadi
 * menyimpan nilai bawaan tidak pernah menghitung ulang harga barang.
 */

vi.mock("@elorae/db", () => ({
  prisma: {
    jubelioPushDefaults: { findFirst: vi.fn(), update: vi.fn() },
    item: { count: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  recalcItemSellingPrice: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn() }));

import { prisma, recalcItemSellingPrice } from "@elorae/db";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";
import * as aksi from "./jubelio-push-defaults";

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

const BARIS = {
  id: "singleton",
  sellTaxId: -1,
  buyTaxId: -1,
  salesAcctId: 28,
  cogsAcctId: 30,
  invtAcctId: 4,
  purchAcctId: null,
  uomId: -1,
  brandId: null,
  brandName: null,
  sellThis: true,
  buyThis: true,
  stockThis: true,
  dropshipThis: false,
  isActive: true,
  sellUnit: "Buah",
  buyUnit: "Buah",
  packageWeight: 1000,
  storePriorityQtyTreshold: 0,
  rop: 0,
  useSingleImageSet: false,
  useSerialNumber: false,
  // Prisma mengembalikan Decimal; tiruannya cukup objek ber-toString.
  buyPrice: { toString: () => "0" },
  defaultMarginPercent: { toString: () => "10" },
  defaultAdditionalCost: { toString: () => "500" },
  updatedAt: new Date("2003-01-02T03:00:00.000Z"),
  updatedById: null,
};

describe("nilai bawaan push Jubelio tanpa margin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fn(auth).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    fn(prisma.jubelioPushDefaults.findFirst).mockResolvedValue(BARIS);
    fn(prisma.jubelioPushDefaults.update).mockResolvedValue(BARIS);
  });

  it("memuat: margin dan biaya tambahan bawaan tidak dikirim ke layar (dan tidak ada Decimal mentah)", async () => {
    const r = await aksi.getJubelioPushDefaults();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).not.toHaveProperty("defaultMarginPercent");
    expect(r.data).not.toHaveProperty("defaultAdditionalCost");
    expect(r.data.buyPrice).toBe(0);
  });

  it("menyimpan: kolom margin tidak ditulis walau klien lama mengirimnya, dan tidak ada harga barang yang dihitung ulang", async () => {
    const { id: _id, updatedAt: _u, updatedById: _b, ...isian } = BARIS;
    void _id;
    void _u;
    void _b;
    const r = await aksi.saveJubelioPushDefaults({
      ...isian,
      buyPrice: 0,
      defaultMarginPercent: 25,
      defaultAdditionalCost: 2_000,
    } as never);
    expect(r.ok).toBe(true);
    const data = fn(prisma.jubelioPushDefaults.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("defaultMarginPercent");
    expect(data).not.toHaveProperty("defaultAdditionalCost");
    expect(data.updatedById).toBe("u1");
    expect(recalcItemSellingPrice).not.toHaveBeenCalled();
    expect(prisma.item.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
    if (r.ok) expect(r.data).not.toHaveProperty("fanOutCount");
  });

  it("penghitung barang yang ikut margin bawaan sudah tidak ada", () => {
    expect("getMarginFallbackItemCount" in aksi).toBe(false);
  });
});
