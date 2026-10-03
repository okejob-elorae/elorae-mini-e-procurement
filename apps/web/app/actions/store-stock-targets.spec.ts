import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/**
 * Simpan target stok, terhadap basis data sungguhan (sesi ditiru).
 * Yang dibuktikan: validasi per baris, hapus lewat isian kosong, hanya baris
 * yang BERUBAH yang ditulis, dan jejak audit berisi pasangan sebelum/sesudah.
 */

const sesi = { id: "", permissions: ["stores:manage"] as string[] };
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: sesi.id, permissions: sesi.permissions } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { simpanTargetStokAction, cariBarangTargetAction } = await import("./store-stock-targets");

const tag = `SST-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = "";
let barangId = "";
let uomId = "";
let orangId = "";

beforeEach(async () => {
  tokoId = "";
  barangId = "";
  uomId = "";
  orangId = "";
  sesi.permissions = ["stores:manage"];
  tokoId = (await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "KONSI" } })).id;
  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  barangId = (
    await prisma.item.create({
      data: {
        sku: `${tag}-I`,
        nameId: `${tag} Kemeja`,
        nameEn: "Shirt",
        type: "FINISHED_GOOD",
        uomId,
        variants: [
          { sku: `${tag}-I-M`, size: "M" },
          { sku: `${tag}-I-L`, size: "L" },
        ],
      },
    })
  ).id;
  orangId = (await prisma.user.create({ data: { email: `${tag}@uji.local`, name: `${tag} Admin`, passwordHash: "x" } })).id;
  sesi.id = orangId;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityType: "Store", entityId: seededId(tokoId) } });
  await prisma.storeStockTarget.deleteMany({ where: { storeId: seededId(tokoId) } });
  await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
  await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
  await prisma.user.deleteMany({ where: { id: seededId(orangId) } });
});

const baris = (variantSku: string, minQty: number | null, maxQty: number | null) => ({ itemId: barangId, variantSku, minQty, maxQty });

describe("simpanTargetStokAction", () => {
  it("menolak tanpa stores:manage", async () => {
    sesi.permissions = ["stores:view"];
    expect(await simpanTargetStokAction({ storeId: tokoId, baris: [baris(`${tag}-I-M`, 1, 4)] })).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("menolak maks < min per baris, tanpa menulis apa pun", async () => {
    const r = await simpanTargetStokAction({ storeId: tokoId, baris: [baris(`${tag}-I-M`, 5, 2), baris(`${tag}-I-L`, 1, 3)] });
    expect(r).toEqual({ ok: false, code: "BARIS_TIDAK_VALID", baris: [{ itemId: barangId, variantSku: `${tag}-I-M`, kode: "MAKS_KURANG_DARI_MIN" }] });
    expect(await prisma.storeStockTarget.count({ where: { storeId: tokoId } })).toBe(0);
  });

  it("menyimpan, lalu hanya menulis baris yang berubah, dan menghapus lewat isian kosong", async () => {
    expect(await simpanTargetStokAction({ storeId: tokoId, baris: [baris(`${tag}-I-M`, 1, 4), baris(`${tag}-I-L`, 2, 6)] })).toEqual({ ok: true, diubah: 2 });

    // M sama persis, L dikosongkan → hanya L yang dihitung berubah (dihapus).
    expect(await simpanTargetStokAction({ storeId: tokoId, baris: [baris(`${tag}-I-M`, 1, 4), baris(`${tag}-I-L`, null, null)] })).toEqual({ ok: true, diubah: 1 });
    const sisa = await prisma.storeStockTarget.findMany({ where: { storeId: tokoId }, select: { variantSku: true, minQty: true, maxQty: true, updatedById: true } });
    expect(sisa).toEqual([{ variantSku: `${tag}-I-M`, minQty: 1, maxQty: 4, updatedById: orangId }]);

    const jejak = await prisma.auditLog.findMany({ where: { entityType: "Store", entityId: tokoId }, orderBy: { createdAt: "asc" } });
    expect(jejak).toHaveLength(2);
    expect(jejak[1]).toMatchObject({
      action: "STORE_STOCK_TARGETS_UPDATED",
      userId: orangId,
      changes: {
        before: [{ itemId: barangId, variantSku: `${tag}-I-L`, minQty: 2, maxQty: 6 }],
        after: [{ itemId: barangId, variantSku: `${tag}-I-L`, minQty: null, maxQty: null }],
      },
    });
  });

  it("tanpa perubahan tidak menulis jejak", async () => {
    await simpanTargetStokAction({ storeId: tokoId, baris: [baris(`${tag}-I-M`, 1, 4)] });
    expect(await simpanTargetStokAction({ storeId: tokoId, baris: [baris(`${tag}-I-M`, 1, 4)] })).toEqual({ ok: true, diubah: 0 });
    expect(await prisma.auditLog.count({ where: { entityType: "Store", entityId: tokoId } })).toBe(1);
  });

  it("menolak barang yang tidak ada", async () => {
    expect(await simpanTargetStokAction({ storeId: tokoId, baris: [{ itemId: "tidak-ada", variantSku: "", minQty: 1, maxQty: 2 }] })).toEqual({
      ok: false,
      code: "BARANG_TIDAK_DITEMUKAN",
    });
  });
});

describe("cariBarangTargetAction", () => {
  it("mengembalikan setiap ukuran barang yang cocok", async () => {
    const r = await cariBarangTargetAction(`${tag} Kem`);
    expect(r.ok && r.barang).toEqual([
      expect.objectContaining({
        itemId: barangId,
        varian: [
          { variantSku: `${tag}-I-M`, label: "M" },
          { variantSku: `${tag}-I-L`, label: "L" },
        ],
      }),
    ]);
  });
});
