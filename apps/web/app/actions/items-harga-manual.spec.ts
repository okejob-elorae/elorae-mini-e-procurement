import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/*
 * Harga jual diisi MANUAL oleh pemilik (keputusan pemilik 2026-10-08): menyimpan
 * formulir barang tidak pernah menghitung harga jual sendiri, isian margin lama
 * tidak lagi ditulis, dan perubahan harga manual tetap tercatat di riwayat harga
 * serta tetap dikirim ke Jubelio untuk barang yang tersambung. Sesi ditiru,
 * basis data uji nyata.
 */

const sesi = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: ["*"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji",
  notifyItemCreated: async () => {},
}));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));

const { updateItem } = await import("./items");

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

  it("isian margin/biaya tambahan dari klien lama diabaikan: harga tidak dihitung ulang, kolomnya tidak ditimpa", async () => {
    await updateItem(itemId, isian({ targetMarginPercent: 80, additionalCost: 5_000 }));
    expect(await barang()).toEqual({ harga: 50_000, margin: 40, biaya: 1_000 });
    expect(await prisma.itemPriceChangeLog.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    // Tidak ada yang berubah untuk Jubelio → tidak ada kiriman produk.
    await new Promise((r) => setTimeout(r, 300));
    expect(await antrean()).toBe(0);
  });

  it("harga jual diubah manual → tersimpan apa adanya, riwayat MANUAL_EDIT, dan dikirim ke Jubelio", async () => {
    await updateItem(itemId, isian({ sellingPrice: 65_000, targetMarginPercent: 10 }));
    expect(await barang()).toEqual({ harga: 65_000, margin: 40, biaya: 1_000 });
    const log = await prisma.itemPriceChangeLog.findMany({
      where: { itemId: seededId(itemId) },
      select: { triggerReason: true, oldSellingPrice: true, newSellingPrice: true, changedById: true, marginPercentUsed: true },
    });
    expect(log.map((l) => ({ ...l, oldSellingPrice: Number(l.oldSellingPrice), newSellingPrice: Number(l.newSellingPrice) }))).toEqual([
      { triggerReason: "MANUAL_EDIT", oldSellingPrice: 50_000, newSellingPrice: 65_000, changedById: userId, marginPercentUsed: null },
    ]);
    await vi.waitFor(async () => expect(await antrean()).toBe(1), { timeout: 3_000 });
  });
});
