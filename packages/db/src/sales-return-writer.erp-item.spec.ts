import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { acceptReturnItem } from "./sales-return-writer";
import { seededId } from "./spec-teardown";

/*
 * Retur marketplace untuk BARANG BUATAN ERP yang stoknya masih satu baris
 * gabungan (null/"").
 *
 * Penahanan dan kirim pesanan marketplace untuk barang ini memakai baris
 * gabungan bila barang belum punya baris per-varian sama sekali
 * (`barisStokPesanan`). Retur ukuran yang sama dulu ditolak `no_inventory_row`
 * — barang yang keluar dari baris gabungan tidak bisa kembali ke sana, jadi
 * retur tidak pernah bisa diterima. Retur memakai aturan baris yang SAMA.
 *
 * Retur yang menyebut baris pesanannya mengikuti cadangan pesanan itu. Varian
 * yang jatuh ke baris gabungan dicatat berkunci "", padahal pemetaan Jubelio
 * barang ini per varian — retur tetap harus mengenali barangnya dari baris
 * gabungan yang dipatok, bukan menolaknya `no_governing_row`.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("acceptReturnItem untuk barang buatan ERP (test bed only)", () => {
  const tag = `RETERP-${Math.random().toString(36).slice(2, 9)}`;
  let uomId = "";
  let itemId = "";
  let userId = "";
  let returnId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    returnId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kaos ERP", nameEn: "ERP tee", type: "FINISHED_GOOD", isActive: true, uomId },
      })
    ).id;
    userId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.local`, name: "Penguji retur" } })).id;
  });

  afterEach(async () => {
    await prisma.salesReturnItem.deleteMany({ where: { salesReturnId: seededId(returnId) } });
    await prisma.salesReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function retur(variantSku: string | null, qty: number, salesOrderDetailId: number | null = null): Promise<string> {
    const ret = await prisma.salesReturn.create({
      data: {
        jubelioReturnId: 1_500_000_000 + Math.floor(Math.random() * 400_000_000),
        channel: "SHOPEE",
        totalQty: qty,
        receivedAt: new Date(),
        rawIngestPayload: {},
        items: {
          create: {
            itemId,
            variantSku,
            salesOrderDetailId,
            externalSku: tag,
            productName: "Kaos ERP",
            qty,
            unitPrice: 100_000,
            subtotal: qty * 100_000,
          },
        },
      },
      include: { items: { select: { id: true } } },
    });
    returnId = ret.id;
    return ret.items[0].id;
  }

  async function terima(returnItemId: string) {
    return prisma.$transaction((tx) =>
      acceptReturnItem(tx, { returnItemId, reason: "Barang kembali utuh", changedById: userId }),
    );
  }

  async function baris() {
    const rows = await prisma.inventoryValue.findMany({
      where: { itemId: seededId(itemId) },
      select: { variantSku: true, qtyOnHand: true, totalValue: true },
    });
    return rows.map((r) => ({ v: r.variantSku, q: Number(r.qtyOnHand), n: Number(r.totalValue) }));
  }

  it("varian yang dijual dari baris gabungan kembali ke baris itu: 12 + 2 = 14 pcs, nilai 14 × 40.000", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 12, avgCost: 40_000, totalValue: 480_000 },
    });
    const id = await retur(`${tag}-RED-M`, 2);

    const hasil = await terima(id);

    expect(hasil.applied).toBe(true);
    expect(await baris()).toEqual([{ v: null, q: 14, n: 560_000 }]);
  });

  it("varian tanpa baris padahal barang punya baris per-varian lain tetap ditolak, stok tidak berubah", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: `${tag}-RED-S`, qtyOnHand: 5, avgCost: 40_000, totalValue: 200_000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 12, avgCost: 40_000, totalValue: 480_000 },
    });
    const id = await retur(`${tag}-RED-M`, 2);

    expect(await terima(id)).toEqual({ applied: false, skipped: "no_inventory_row" });
    expect((await baris()).map((b) => b.q).sort((a, b) => a - b)).toEqual([5, 12]);
  });

  it("baris kembar null dan \"\": selalu baris \"\" yang bertambah (sama dengan penahanan pesanan)", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 4, avgCost: 40_000, totalValue: 160_000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 6, avgCost: 40_000, totalValue: 240_000 },
    });
    const id = await retur(null, 1);

    expect((await terima(id)).applied).toBe(true);
    const semua = await baris();
    expect(semua.find((b) => b.v === "")).toMatchObject({ q: 7 });
    expect(semua.find((b) => b.v === null)).toMatchObject({ q: 4 });
  });

  it("varian pesanan marketplace yang terkirim dari baris gabungan kembali ke baris itu walau pemetaannya per varian", async () => {
    const gabungan = await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 10, avgCost: 40_000, totalValue: 400_000 },
      select: { id: true },
    });
    const varian = `${tag}-RED-M`;
    const idJubelio = 1_500_000_000 + Math.floor(Math.random() * 400_000_000);
    await prisma.jubelioProductMapping.create({
      data: { itemId, jubelioItemGroupId: idJubelio, jubelioItemId: idJubelio, jubelioItemCode: varian, erpVariantSku: varian },
    });
    const detailId = 1_500_000_000 + Math.floor(Math.random() * 400_000_000);
    await prisma.stockReservation.create({
      data: {
        salesorderId: detailId,
        salesorderDetailId: detailId,
        itemId,
        variantSku: "",
        qty: 2,
        state: "CONSUMED",
        inventoryValueId: gabungan.id,
      },
    });
    const id = await retur(varian, 2, detailId);

    const hasil = await terima(id);

    expect(hasil.applied).toBe(true);
    expect(await baris()).toEqual([{ v: null, q: 12, n: 480_000 }]);
  });
});
