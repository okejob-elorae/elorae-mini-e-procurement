import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { getDashboardStats } from "./queries";
import { getInventorySnapshot } from "@/lib/inventory/costing";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Kartu Beranda "Stok menipis"/"Stok habis" menautkan ke daftar Inventori
 * tersaring `?status=MENIPIS|HABIS`. Angka kartu HARUS sama dengan jumlah baris
 * daftar tersaring — keduanya dari satu definisi (per barang, tersedia = Σ di
 * tangan − Σ dipesan). Terhadap basis data sungguhan; tiga barang dibuat sendiri
 * supaya kedua kelompok tidak kosong, termasuk barang bervarian yang baris
 * variannya dijumlah. Hanya baris yang diseed yang dihapus, lewat `seededId()`.
 */
d("stok Beranda = daftar Inventori tersaring (test bed only)", () => {
  let token = "";
  let uomId = "";
  let menipisId = "";
  let habisId = "";
  let variannyaId = "";

  beforeEach(async () => {
    token = "";
    uomId = "";
    menipisId = "";
    habisId = "";
    variannyaId = "";
    token = `SBD${Math.floor(Math.random() * 10_000_000)}`;
    uomId = (await prisma.uOM.create({ data: { code: `U-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = async (sku: string, reorderPoint: number | null) =>
      (
        await prisma.item.create({
          data: { sku: `${sku}-${token}`, nameId: sku, nameEn: sku, type: "FINISHED_GOOD", isActive: true, uomId, reorderPoint },
          select: { id: true },
        })
      ).id;
    menipisId = await barang("MENIPIS", 10);
    habisId = await barang("HABIS", 10);
    variannyaId = await barang("VARIAN", 10);
    // Menipis: 8 di tangan, 3 dipesan → tersedia 5 ≤ 10.
    await prisma.inventoryValue.create({ data: { itemId: menipisId, variantSku: null, qtyOnHand: 8, reservedQty: 3 } });
    // Habis: 4 di tangan, 4 dipesan → tersedia 0.
    await prisma.inventoryValue.create({ data: { itemId: habisId, variantSku: null, qtyOnHand: 4, reservedQty: 4 } });
    // Bervarian: satu varian 0, satu 6 → per barang tersedia 6 → MENIPIS, bukan HABIS.
    await prisma.inventoryValue.create({ data: { itemId: variannyaId, variantSku: `V-${token}-S`, qtyOnHand: 0, reservedQty: 0 } });
    await prisma.inventoryValue.create({ data: { itemId: variannyaId, variantSku: `V-${token}-M`, qtyOnHand: 6, reservedQty: 0 } });
  });

  afterEach(async () => {
    const barang = [menipisId, habisId, variannyaId].filter(Boolean);
    if (barang.length) {
      await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(barang) } } });
      await prisma.item.deleteMany({ where: { id: { in: seededIds(barang) } } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  it("angka kartu = jumlah baris daftar tersaring, untuk MENIPIS dan HABIS", async () => {
    const [stat, menipis, habis] = await Promise.all([
      getDashboardStats({ stok: true }),
      getInventorySnapshot({ status: "MENIPIS" }),
      getInventorySnapshot({ status: "HABIS" }),
    ]);
    expect(stat.items.lowStockCount).toBe(menipis.totalCount);
    expect(stat.items.habisCount).toBe(habis.totalCount);
    expect(menipis.items).toHaveLength(menipis.totalCount);
    expect(habis.items).toHaveLength(habis.totalCount);

    const idMenipis = menipis.items.map((r) => r.itemId);
    const idHabis = habis.items.map((r) => r.itemId);
    expect(idMenipis).toEqual(expect.arrayContaining([menipisId, variannyaId]));
    expect(idMenipis).not.toContain(habisId);
    expect(idHabis).toContain(habisId);
    expect(idHabis).not.toContain(variannyaId);
  });
});
