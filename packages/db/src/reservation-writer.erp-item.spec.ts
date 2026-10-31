import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { reserveOrder, consumeOrder, releaseOrder } from "./reservation-writer";
import { InventoryValueMissingError } from "./stock-writer";
import { seededId, seededIds } from "./spec-teardown";

/*
 * Pesanan marketplace untuk BARANG BUATAN ERP.
 *
 * Barang yang dibuat di ERP (`lib/items/mutations.ts`) lahir dengan satu baris
 * `InventoryValue` tanpa varian bernilai `null`, sedangkan pemetaan Jubelio
 * barang tanpa varian menyimpan `erpVariantSku = ""` dan barang bervarian
 * menyimpan SKU varian. `reserveOrder` dulu mencari kunci majemuk persis
 * (itemId, variantSku), jadi pesanan untuk barang itu gagal seluruhnya
 * (`InventoryValueMissingError`) — webhook berakhir DEAD, stok tidak pernah
 * ditahan, dan saat kirim stok gudang tidak pernah berkurang.
 *
 * Yang dibuktikan: penahanan memakai baris yang sama (null maupun ""), tanpa
 * membuat baris kembar; buku penahanan menyimpan kunci baris yang DITAHAN
 * sehingga kirim (consume) dan batal (release) mengenai baris yang sama.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const acak = () => 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

d("reserveOrder untuk barang buatan ERP (test bed only)", () => {
  const tag = `RSV-ERP-${Math.random().toString(36).slice(2, 9)}`;
  let uomId = "";
  let itemId = "";
  let salesorderIds: number[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    salesorderIds = [];
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kaos ERP", nameEn: "ERP tee", type: "FINISHED_GOOD", isActive: true, uomId },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([itemId].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  function pesanan(variantSku: string, qty: number) {
    const salesorderId = acak();
    salesorderIds.push(salesorderId);
    return {
      salesorderId,
      salesorderNo: `SP-${salesorderId}`,
      lines: [{ salesorderDetailId: salesorderId + 1, itemId, variantSku, qty }],
    };
  }

  async function baris() {
    const rows = await prisma.inventoryValue.findMany({
      where: { itemId: seededId(itemId) },
      select: { id: true, variantSku: true, qtyOnHand: true, reservedQty: true },
    });
    return rows.map((r) => ({ ...r, qtyOnHand: Number(r.qtyOnHand), reservedQty: Number(r.reservedQty) }));
  }

  it("barang tanpa varian (baris null) ditahan, dikirim, dan dibatalkan di baris yang sama", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 10, avgCost: 50_000, totalValue: 500_000 },
    });

    const kirim = pesanan("", 3);
    const r1 = await reserveOrder(prisma, kirim);
    expect(r1).toMatchObject({ reserved: 1, skipped: 0, oversell: [] });
    expect(await baris()).toEqual([expect.objectContaining({ variantSku: null, qtyOnHand: 10, reservedQty: 3 })]);

    // Kirim memotong stok di baris yang sama: 10 − 3 = 7 pcs, cadangan kembali 0.
    const c = await consumeOrder(prisma, { salesorderId: kirim.salesorderId, salesorderNo: kirim.salesorderNo });
    expect(c.consumed).toBe(1);
    expect(await baris()).toEqual([expect.objectContaining({ variantSku: null, qtyOnHand: 7, reservedQty: 0 })]);

    // Pesanan lain dibatalkan: cadangan 2 pcs dilepas lagi dari baris yang sama.
    const batal = pesanan("", 2);
    await reserveOrder(prisma, batal);
    expect((await baris())[0].reservedQty).toBe(2);
    const rel = await releaseOrder(prisma, { salesorderId: batal.salesorderId });
    expect(rel.released).toBe(1);
    expect(await baris()).toEqual([expect.objectContaining({ variantSku: null, qtyOnHand: 7, reservedQty: 0 })]);
  });

  it("barang bervarian yang stoknya masih satu baris gabungan ditahan di baris gabungan itu", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 12, avgCost: 50_000, totalValue: 600_000 },
    });

    const kirim = pesanan(`${tag}-RED-M`, 4);
    await reserveOrder(prisma, kirim);

    const semua = await baris();
    expect(semua).toHaveLength(1);
    expect(semua[0]).toMatchObject({ variantSku: null, reservedQty: 4 });
    // Buku penahanan mencatat kunci baris yang ditahan, supaya kirim mengenai baris ini juga.
    const resv = await prisma.stockReservation.findUniqueOrThrow({
      where: { salesorderDetailId: kirim.lines[0].salesorderDetailId },
      select: { variantSku: true, qty: true },
    });
    expect(resv.variantSku).toBe("");

    await consumeOrder(prisma, { salesorderId: kirim.salesorderId, salesorderNo: kirim.salesorderNo });
    expect(await baris()).toEqual([expect.objectContaining({ qtyOnHand: 8, reservedQty: 0 })]);
  });

  it("varian yang memang punya baris sendiri tetap memakai barisnya (perilaku lama)", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: `${tag}-RED-M`, qtyOnHand: 5, avgCost: 50_000, totalValue: 250_000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 30, avgCost: 50_000, totalValue: 1_500_000 },
    });

    const kirim = pesanan(`${tag}-RED-M`, 2);
    await reserveOrder(prisma, kirim);

    const perVarian = (await baris()).find((b) => b.variantSku === `${tag}-RED-M`);
    const gabungan = (await baris()).find((b) => b.variantSku === null);
    expect(perVarian).toMatchObject({ reservedQty: 2 });
    expect(gabungan).toMatchObject({ reservedQty: 0 });
    const resv = await prisma.stockReservation.findUniqueOrThrow({
      where: { salesorderDetailId: kirim.lines[0].salesorderDetailId },
      select: { variantSku: true },
    });
    expect(resv.variantSku).toBe(`${tag}-RED-M`);
  });

  it("varian yang tidak ada barisnya padahal barang punya baris per-varian tetap ditolak, tanpa jejak", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: `${tag}-RED-S`, qtyOnHand: 5, avgCost: 50_000, totalValue: 250_000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 30, avgCost: 50_000, totalValue: 1_500_000 },
    });

    await expect(reserveOrder(prisma, pesanan(`${tag}-RED-M`, 2))).rejects.toBeInstanceOf(InventoryValueMissingError);
    expect(await prisma.stockReservation.count({ where: { itemId } })).toBe(0);
    expect((await baris()).every((b) => b.reservedQty === 0)).toBe(true);
  });

  it("baris kembar null dan \"\" yang sudah ada: selalu baris \"\" yang ditahan, tidak ada baris baru", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 4, avgCost: 50_000, totalValue: 200_000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 6, avgCost: 50_000, totalValue: 300_000 },
    });

    const kirim = pesanan("", 1);
    await reserveOrder(prisma, kirim);

    const semua = await baris();
    expect(semua).toHaveLength(2);
    expect(semua.find((b) => b.variantSku === "")).toMatchObject({ reservedQty: 1 });
    expect(semua.find((b) => b.variantSku === null)).toMatchObject({ reservedQty: 0 });

    await consumeOrder(prisma, { salesorderId: kirim.salesorderId, salesorderNo: kirim.salesorderNo });
    expect((await baris()).find((b) => b.variantSku === "")).toMatchObject({ qtyOnHand: 5, reservedQty: 0 });
  });

  it("barang yang sama sekali tidak punya baris stok tetap ditolak seperti dulu", async () => {
    await expect(reserveOrder(prisma, pesanan("", 1))).rejects.toBeInstanceOf(InventoryValueMissingError);
    expect(await prisma.inventoryValue.count({ where: { itemId } })).toBe(0);
  });
});
