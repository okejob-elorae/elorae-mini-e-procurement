import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Margin dan biaya tambahan bawaan kembali bisa diisi (keputusan pemilik
 * 2026-11-01) — sebagai bahan REKOMENDASI harga jual di halaman barang saja.
 * Menyimpannya tidak pernah menghitung ulang atau menimpa harga jual barang
 * mana pun; harga akhir tetap diketik sendiri.
 */

vi.mock("@elorae/db", () => ({
  prisma: {
    jubelioPushDefaults: { findFirst: vi.fn(), update: vi.fn() },
    item: { count: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    itemPriceChangeLog: { create: vi.fn() },
    jubelioOutbox: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn() }));

import { prisma } from "@elorae/db";
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
  defaultMarginPercent: { toString: () => "40" },
  defaultPriceRuleBasis: "MARKUP",
  defaultAdditionalCost: { toString: () => "2000" },
  updatedAt: new Date("2003-01-02T03:00:00.000Z"),
  updatedById: null,
};

function isianDari(lain: Record<string, unknown> = {}) {
  const { id: _id, updatedAt: _u, updatedById: _b, ...isian } = BARIS;
  void _id;
  void _u;
  void _b;
  return { ...isian, buyPrice: 0, defaultMarginPercent: 40, defaultAdditionalCost: 2_000, ...lain } as never;
}

function tidakAdaHargaYangDisentuh() {
  expect(prisma.item.findMany).not.toHaveBeenCalled();
  expect(prisma.item.update).not.toHaveBeenCalled();
  expect(prisma.item.updateMany).not.toHaveBeenCalled();
  expect(prisma.itemPriceChangeLog.create).not.toHaveBeenCalled();
  expect(prisma.jubelioOutbox.create).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(apiFetch).not.toHaveBeenCalled();
}

describe("nilai bawaan push Jubelio: margin dan biaya tambahan sebagai bahan rekomendasi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fn(auth).mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    fn(prisma.jubelioPushDefaults.findFirst).mockResolvedValue(BARIS);
    fn(prisma.jubelioPushDefaults.update).mockResolvedValue(BARIS);
  });

  it("memuat: margin dan biaya tambahan bawaan dikirim sebagai angka (tanpa Decimal mentah)", async () => {
    const r = await aksi.getJubelioPushDefaults();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.defaultMarginPercent).toBe(40);
    expect(r.data.defaultAdditionalCost).toBe(2_000);
    expect(r.data.buyPrice).toBe(0);
  });

  it("memuat: kolom kosong tetap null", async () => {
    fn(prisma.jubelioPushDefaults.findFirst).mockResolvedValue({ ...BARIS, defaultMarginPercent: null, defaultAdditionalCost: null });
    const r = await aksi.getJubelioPushDefaults();
    expect(r.ok && r.data.defaultMarginPercent).toBeNull();
    expect(r.ok && r.data.defaultAdditionalCost).toBeNull();
  });

  it("menyimpan: margin dan biaya bawaan ditulis, dan TIDAK ada harga jual barang yang dihitung ulang", async () => {
    const r = await aksi.saveJubelioPushDefaults(isianDari({ defaultMarginPercent: 25, defaultAdditionalCost: 1_500 }));
    expect(r.ok).toBe(true);
    const data = fn(prisma.jubelioPushDefaults.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.defaultMarginPercent).toBe(25);
    expect(data.defaultAdditionalCost).toBe(1_500);
    expect(data.updatedById).toBe("u1");
    tidakAdaHargaYangDisentuh();
    if (r.ok) expect(r.data).not.toHaveProperty("fanOutCount");
  });

  it("menyimpan: dikosongkan → null", async () => {
    await aksi.saveJubelioPushDefaults(isianDari({ defaultMarginPercent: null, defaultAdditionalCost: null }));
    const data = fn(prisma.jubelioPushDefaults.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.defaultMarginPercent).toBeNull();
    expect(data.defaultAdditionalCost).toBeNull();
    tidakAdaHargaYangDisentuh();
  });

  it("layar lama yang tidak mengirim margin/biaya tidak mengosongkan kolomnya", async () => {
    const lama = { ...(isianDari() as Record<string, unknown>) };
    delete lama.defaultMarginPercent;
    delete lama.defaultAdditionalCost;
    await aksi.saveJubelioPushDefaults(lama as never);
    const data = fn(prisma.jubelioPushDefaults.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("defaultMarginPercent");
    expect(data).not.toHaveProperty("defaultAdditionalCost");
  });

  it.each([
    [{ defaultMarginPercent: -1 }],
    [{ defaultMarginPercent: 1_000 }],
    [{ defaultMarginPercent: Number.NaN }],
    [{ defaultAdditionalCost: -5 }],
    [{ defaultMarginPercent: "40" }],
  ])("isian tidak sah %o → ISIAN_TIDAK_SAH, tidak ada yang ditulis", async (salah) => {
    const r = await aksi.saveJubelioPushDefaults(isianDari(salah));
    expect(r).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(prisma.jubelioPushDefaults.update).not.toHaveBeenCalled();
    tidakAdaHargaYangDisentuh();
  });

  /* Jawaban pemilik P4 (2026-11-02): persen bawaan diisi sebagai markup ATAU margin; batasnya per dasar. */
  it("menyimpan dasar aturan; margin dibatasi 99,99 dan markup 999,99", async () => {
    await aksi.saveJubelioPushDefaults(isianDari({ defaultMarginPercent: 40, defaultPriceRuleBasis: "MARGIN" }));
    const data = fn(prisma.jubelioPushDefaults.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({ defaultMarginPercent: 40, defaultPriceRuleBasis: "MARGIN" });

    expect(await aksi.saveJubelioPushDefaults(isianDari({ defaultMarginPercent: 100, defaultPriceRuleBasis: "MARGIN" }))).toMatchObject({
      ok: false,
      code: "ISIAN_TIDAK_SAH",
    });
    expect(await aksi.saveJubelioPushDefaults(isianDari({ defaultMarginPercent: 999.99, defaultPriceRuleBasis: "MARKUP" }))).toMatchObject({ ok: true });
    expect(await aksi.saveJubelioPushDefaults(isianDari({ defaultPriceRuleBasis: "PERSEN" }))).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
    tidakAdaHargaYangDisentuh();
  });

  it("layar lama yang tidak mengirim dasar tidak mengosongkannya, dan persennya diperiksa dengan dasar tersimpan", async () => {
    fn(prisma.jubelioPushDefaults.findFirst).mockResolvedValue({ ...BARIS, defaultPriceRuleBasis: "MARGIN" });
    const lama = { ...(isianDari({ defaultMarginPercent: 150 }) as Record<string, unknown>) };
    delete lama.defaultPriceRuleBasis;
    expect(await aksi.saveJubelioPushDefaults(lama as never)).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });

    const baik = { ...(isianDari({ defaultMarginPercent: 40 }) as Record<string, unknown>) };
    delete baik.defaultPriceRuleBasis;
    await aksi.saveJubelioPushDefaults(baik as never);
    const data = fn(prisma.jubelioPushDefaults.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("defaultPriceRuleBasis");
  });

  /* R14: batas persen berlaku untuk setiap gabungan isian — juga dasar baru dengan persen tersimpan. */
  it("dasar dikirim tanpa persen: persen bawaan tersimpan diperiksa dengan dasar baru", async () => {
    fn(prisma.jubelioPushDefaults.findFirst).mockResolvedValue({ ...BARIS, defaultMarginPercent: 178, defaultPriceRuleBasis: "MARKUP" });
    const keMargin = { ...(isianDari({ defaultPriceRuleBasis: "MARGIN" }) as Record<string, unknown>) };
    delete keMargin.defaultMarginPercent;
    expect(await aksi.saveJubelioPushDefaults(keMargin as never)).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(prisma.jubelioPushDefaults.update).not.toHaveBeenCalled();

    fn(prisma.jubelioPushDefaults.findFirst).mockResolvedValue({ ...BARIS, defaultMarginPercent: 40, defaultPriceRuleBasis: "MARKUP" });
    expect(await aksi.saveJubelioPushDefaults(keMargin as never)).toMatchObject({ ok: true });
    const data = fn(prisma.jubelioPushDefaults.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({ defaultPriceRuleBasis: "MARGIN" });
    expect(data).not.toHaveProperty("defaultMarginPercent");
    tidakAdaHargaYangDisentuh();
  });

  it("penghitung barang yang ikut margin bawaan (untuk hitung ulang massal) tetap tidak ada", () => {
    expect("getMarginFallbackItemCount" in aksi).toBe(false);
  });
});
