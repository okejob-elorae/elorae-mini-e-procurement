import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/*
 * Harga jual diketik MANUAL (keputusan pemilik 2026-10-08, ditegaskan lagi
 * 2026-11-01): menyimpan formulir barang tidak pernah menghitung harga jual
 * sendiri. Target margin dan biaya tambahan disimpan sebagai bahan rekomendasi
 * harga saja — mengubahnya tidak menggeser harga. Perubahan harga ketikan
 * tercatat MANUAL_EDIT di riwayat harga.
 *
 * Ke Jubelio harga baru TIDAK langsung dikirim (keputusan pemilik 2026-11-02):
 * barang yang tersambung muncul di Jubelio → Konfirmasi harga sebagai
 * "Perubahan harga menunggu konfirmasi", Jubelio tetap memakai harga
 * terkonfirmasi (di sini 50.000), dan hanya perubahan selain harga yang tetap
 * dikirim otomatis. Sesi ditiru, basis data uji nyata.
 */

const sesi = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: ["*"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: async () => "Penguji" }));
vi.mock("@/lib/notifications/events", () => ({ notifyItemCreated: async () => {} }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));

const { updateItem } = await import("./items");
const { daftarHargaMenunggu } = await import("@/lib/jubelio/harga/queries");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("harga jual manual di formulir barang (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let uomId = "";
  let itemId = "";

  beforeAll(async () => {
    userId = "";
    uomId = "";
    itemId = "";
    userId = (await prisma.user.create({ data: { email: `hjm-${token}@uji.local`, name: "Uji harga manual" }, select: { id: true } })).id;
    sesi.id = userId;
    uomId = (await prisma.uOM.create({ data: { code: `M${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: {
          sku: `FG-HJM-${token}`,
          nameId: "Kaos uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          sellingPrice: 50_000,
          jubelioConfirmedPrice: 50_000,
          jubelioConfirmedAt: new Date(),
          targetMarginPercent: 40,
          additionalCost: 1_000,
        },
        select: { id: true },
      })
    ).id;
    // Dasar yang dulu dipakai penghitung otomatis: avgCost 20.000.
    await prisma.inventoryValue.create({ data: { itemId, variantSku: null, qtyOnHand: 10, avgCost: 20_000, totalValue: 200_000 } });
    const angka = Math.floor(Math.random() * 1e9) + 1e9;
    await prisma.jubelioProductMapping.create({
      data: { itemId, jubelioItemGroupId: angka, jubelioItemId: angka, jubelioItemCode: `FG-HJM-${token}`, erpVariantSku: `FG-HJM-${token}` },
    });
  });

  beforeEach(async () => {
    sesi.id = userId;
    await prisma.jubelioOutbox.deleteMany({ where: { entityId: seededId(itemId) } });
    await prisma.itemPriceChangeLog.deleteMany({ where: { itemId: seededId(itemId) } });
    // Setiap tes mulai dari keadaan yang sama, apa pun yang disimpan tes sebelumnya.
    await prisma.item.update({
      where: { id: seededId(itemId) },
      data: {
        nameId: "Kaos uji",
        sellingPrice: 50_000,
        jubelioConfirmedPrice: 50_000,
        targetMarginPercent: 40,
        priceRuleBasis: "MARKUP",
        additionalCost: 1_000,
      },
    });
  });

  afterAll(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityId: seededId(itemId) } });
    await prisma.itemPriceChangeLog.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(itemId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  const isian = (lain: Record<string, unknown> = {}) =>
    ({ nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD" as const, uomId, sellingPrice: 50_000, ...lain }) as Parameters<
      typeof updateItem
    >[1];

  async function barang() {
    const b = await prisma.item.findUniqueOrThrow({
      where: { id: seededId(itemId) },
      select: { sellingPrice: true, targetMarginPercent: true, additionalCost: true },
    });
    return {
      harga: b.sellingPrice == null ? null : Number(b.sellingPrice),
      margin: b.targetMarginPercent == null ? null : Number(b.targetMarginPercent),
      biaya: b.additionalCost == null ? null : Number(b.additionalCost),
    };
  }

  const antrean = () => prisma.jubelioOutbox.count({ where: { entityId: seededId(itemId), entityType: "product_push" } });
  const menunggu = async () => (await daftarHargaMenunggu({ hanyaBarang: [itemId] })).baris;

  it("formulir tanpa isian margin/biaya tambahan: harga tidak dihitung ulang, kolomnya tidak ditimpa", async () => {
    await updateItem(itemId, isian());
    expect(await barang()).toEqual({ harga: 50_000, margin: 40, biaya: 1_000 });
    expect(await prisma.itemPriceChangeLog.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    // Tidak ada yang berubah untuk Jubelio → tidak ada kiriman produk.
    await new Promise((r) => setTimeout(r, 300));
    expect(await antrean()).toBe(0);
    expect(await menunggu()).toEqual([]);
  });

  it("harga jual diubah manual → tersimpan, riwayat MANUAL_EDIT, menunggu konfirmasi Jubelio, TIDAK dikirim", async () => {
    await updateItem(itemId, isian({ sellingPrice: 65_000 }));
    expect(await barang()).toEqual({ harga: 65_000, margin: 40, biaya: 1_000 });
    const log = await prisma.itemPriceChangeLog.findMany({
      where: { itemId: seededId(itemId) },
      select: { triggerReason: true, oldSellingPrice: true, newSellingPrice: true, changedById: true, marginPercentUsed: true },
    });
    expect(log.map((l) => ({ ...l, oldSellingPrice: Number(l.oldSellingPrice), newSellingPrice: Number(l.newSellingPrice) }))).toEqual([
      { triggerReason: "MANUAL_EDIT", oldSellingPrice: 50_000, newSellingPrice: 65_000, changedById: userId, marginPercentUsed: null },
    ]);
    await new Promise((r) => setTimeout(r, 300));
    expect(await antrean()).toBe(0);
    expect(await menunggu()).toEqual([
      expect.objectContaining({ itemId, jenis: "UBAH", hargaJubelio: "50000.00", hargaErp: "65000.00", diubahOleh: "Uji harga manual" }),
    ]);
  });

  it("perubahan nama saat harga masih menunggu tetap dikirim (dengan harga terkonfirmasi)", async () => {
    await updateItem(itemId, isian({ sellingPrice: 65_000 }));
    await new Promise((r) => setTimeout(r, 300));
    expect(await antrean()).toBe(0);
    await updateItem(itemId, isian({ sellingPrice: 65_000, nameId: "Kaos uji baru" }));
    await vi.waitFor(async () => expect(await antrean()).toBe(1), { timeout: 3_000 });
    // Harga tetap menunggu: kiriman nama tidak mengonfirmasi harga apa pun.
    expect((await menunggu()).map((b) => b.jenis)).toEqual(["UBAH"]);
  });

  it("harga dikembalikan ke harga terkonfirmasi → keluar dari daftar tanpa tindakan apa pun", async () => {
    await updateItem(itemId, isian({ sellingPrice: 65_000 }));
    expect(await menunggu()).toHaveLength(1);
    await updateItem(itemId, isian({ sellingPrice: 50_000 }));
    expect(await menunggu()).toEqual([]);
  });

  it("target margin dan biaya tambahan baru disimpan sebagai bahan rekomendasi; harga jual TIDAK berubah", async () => {
    // Dulu: margin berubah → harga dihitung ulang 20.000 × 1,45 + 2.000 = 31.000 dan menimpa 50.000.
    await updateItem(itemId, isian({ targetMarginPercent: 45, additionalCost: 2_000 }));
    expect(await barang()).toEqual({ harga: 50_000, margin: 45, biaya: 2_000 });
    expect(await prisma.itemPriceChangeLog.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(await antrean()).toBe(0);
  });

  it("margin dikosongkan → kolomnya kosong (ikut margin bawaan untuk rekomendasi), harga tetap", async () => {
    await updateItem(itemId, isian({ targetMarginPercent: null, additionalCost: null }));
    expect(await barang()).toEqual({ harga: 50_000, margin: null, biaya: null });
    expect(await prisma.itemPriceChangeLog.count({ where: { itemId: seededId(itemId) } })).toBe(0);
  });

  it("harga diketik bersamaan dengan margin baru → harga ketikan yang tersimpan, riwayat MANUAL_EDIT, tidak dikirim", async () => {
    await updateItem(itemId, isian({ sellingPrice: 99_000, targetMarginPercent: 45 }));
    expect(await barang()).toEqual({ harga: 99_000, margin: 45, biaya: 1_000 });
    const log = await prisma.itemPriceChangeLog.findMany({
      where: { itemId: seededId(itemId) },
      select: { triggerReason: true, oldSellingPrice: true, newSellingPrice: true },
    });
    expect(log.map((l) => ({ ...l, oldSellingPrice: Number(l.oldSellingPrice), newSellingPrice: Number(l.newSellingPrice) }))).toEqual([
      { triggerReason: "MANUAL_EDIT", oldSellingPrice: 50_000, newSellingPrice: 99_000 },
    ]);
    await new Promise((r) => setTimeout(r, 300));
    expect(await antrean()).toBe(0);
  });

  it("aturan sebagai MARGIN (P4) tersimpan dengan dasarnya; harga jual dan riwayat harga TIDAK berubah", async () => {
    await updateItem(itemId, isian({ targetMarginPercent: 40, priceRuleBasis: "MARGIN" }));
    expect(await barang()).toEqual({ harga: 50_000, margin: 40, biaya: 1_000 });
    const b = await prisma.item.findUniqueOrThrow({ where: { id: seededId(itemId) }, select: { priceRuleBasis: true } });
    expect(b.priceRuleBasis).toBe("MARGIN");
    expect(await prisma.itemPriceChangeLog.count({ where: { itemId: seededId(itemId) } })).toBe(0);
  });

  it("batas per dasar: margin 100 ditolak, markup 999,99 diterima; harga tetap", async () => {
    await expect(updateItem(itemId, isian({ targetMarginPercent: 100, priceRuleBasis: "MARGIN" }))).rejects.toThrow(/Margin harus/);
    await updateItem(itemId, isian({ targetMarginPercent: 999.99, priceRuleBasis: "MARKUP" }));
    expect(await barang()).toEqual({ harga: 50_000, margin: 999.99, biaya: 1_000 });
  });

  it("margin yang bukan angka ditolak, harga dan margin lama tetap", async () => {
    await expect(updateItem(itemId, isian({ targetMarginPercent: "abc" }))).rejects.toThrow(/targetMarginPercent/);
    expect(await barang()).toEqual({ harga: 50_000, margin: 40, biaya: 1_000 });
  });
});
