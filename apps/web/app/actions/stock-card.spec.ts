import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyJubelioStockAdjustment, prisma, seededId, seededIds } from "@elorae/db";

/*
 * Kartu stok terhadap basis data uji sungguhan (sesi ditiru).
 *
 * Yang dibuktikan:
 *  - kartu membaca SEMUA gerakan yang menggerakkan InventoryValue gudang:
 *    GRN (StockMovement), opname dan penyesuaian manual (ditulis di dua buku,
 *    tampil sekali), webhook Jubelio (penulis sungguhan), penjualan marketplace,
 *    muat & retur van, transfer konsi, NRI, tukar barang (StockAdjustment);
 *  - tambahan dari opname masuk kolom Masuk, bukan Keluar;
 *  - Σ masuk − Σ keluar = qtyOnHand, saldo akhir = qtyOnHand, nilai akhir =
 *    totalValue (pcs dan rupiah) untuk barang uji yang semua stoknya berdokumen;
 *  - stok tanpa dokumen disebut sebagai `tanpaDokumen`, bukan membuat saldo meleset;
 *  - mode varian memperingatkan penyesuaian yang tidak mencatat varian.
 */

const sesi = vi.hoisted(() => ({ id: "penguji-kartu-stok", permissions: ["inventory:view", "inventory:manage"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.permissions } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async () => ({ success: true, userId: sesi.id })),
}));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(async () => "Penguji"),
  notifyStockAdjustmentCreated: vi.fn(async () => {}),
}));

const { getStockCard, getStockCardByCategory } = await import("./stock-card");
const { createStockAdjustment } = await import("./inventory");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `KSTK-${Math.random().toString(36).slice(2, 9)}`;
const HARGA = 10_000;
const jam = (n: number) => new Date(Date.UTC(2026, 8, 1, n, 0, 0));
const rentang = { from: new Date("2026-08-01T00:00:00Z"), to: new Date(Date.now() + 86_400_000) };

d("kartu stok lengkap (test bed only)", () => {
  let uomId = "";
  let kategoriId = "";
  let itemId = "";
  let itemTanpaDokId = "";

  /** Ubah stok barang uji persis seperti penulis sungguhan: increment atom, avg tetap. */
  async function geser(id: string, qty: number) {
    await prisma.inventoryValue.update({
      where: { itemId_variantSku: { itemId: seededId(id), variantSku: "" } },
      data: { qtyOnHand: { increment: qty }, totalValue: { increment: qty * HARGA } },
    });
  }

  async function stok(id: string) {
    const r = await prisma.inventoryValue.findUniqueOrThrow({
      where: { itemId_variantSku: { itemId: seededId(id), variantSku: "" } },
    });
    return { qty: Number(r.qtyOnHand), nilai: Number(r.totalValue) };
  }

  async function penyesuaian(
    id: string,
    p: { n: number; type: "POSITIVE" | "NEGATIVE"; qtyChange: number; source: string; externalRef?: string },
  ) {
    const r = await prisma.stockAdjustment.create({
      data: {
        docNumber: `${tag}-ADJ-${p.n}-${id.slice(-4)}`,
        itemId: id,
        type: p.type,
        qtyChange: p.qtyChange,
        reason: `uji ${tag} ${p.source}`,
        prevQty: 0,
        newQty: 0,
        prevAvgCost: HARGA,
        newAvgCost: HARGA,
        source: p.source,
        externalRef: p.externalRef ?? null,
        createdAt: jam(p.n),
      },
    });
    await geser(id, p.type === "POSITIVE" ? Math.abs(p.qtyChange) : -Math.abs(p.qtyChange));
    return r;
  }

  async function movement(
    id: string,
    p: { n: number; type: "IN" | "OUT" | "ADJUSTMENT"; refType: string; refId: string; qty: number; variantSku?: string },
    ubahStok = true,
  ) {
    await prisma.stockMovement.create({
      data: {
        itemId: id,
        variantSku: p.variantSku ?? "",
        type: p.type,
        refType: p.refType,
        refId: p.refId,
        refDocNumber: `${tag}-${p.refType}-${p.n}`,
        qty: p.qty,
        unitCost: HARGA,
        totalCost: p.qty * HARGA,
        balanceQty: 0,
        balanceValue: 0,
        createdAt: jam(p.n),
      },
    });
    if (ubahStok) await geser(id, p.qty);
  }

  beforeAll(async () => {
    uomId = "";
    kategoriId = "";
    itemId = "";
    itemTanpaDokId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriId = (await prisma.itemCategory.create({ data: { name: `Kategori ${tag}`, code: tag } })).id;
    for (const akhiran of ["A", "B"]) {
      const id = (
        await prisma.item.create({
          data: {
            sku: `${tag}-${akhiran}`,
            nameId: `Barang ${tag} ${akhiran}`,
            nameEn: "Test",
            type: "FINISHED_GOOD",
            uomId,
            categoryId: kategoriId,
            isActive: true,
          },
        })
      ).id;
      await prisma.inventoryValue.create({
        data: { itemId: id, variantSku: "", qtyOnHand: 0, avgCost: HARGA, totalValue: 0 },
      });
      if (akhiran === "A") itemId = id;
      else itemTanpaDokId = id;
    }

    // Barang A: semua stoknya berdokumen.
    await movement(itemId, { n: 1, type: "IN", refType: "GRN", refId: `${tag}-grn`, qty: 10 }); // 10
    // Opname +2, ditulis di DUA buku seperti opname-approve.
    await penyesuaian(itemId, { n: 2, type: "POSITIVE", qtyChange: 2, source: "ERP_OPNAME", externalRef: `${tag}-opn` }); // 12
    await movement(itemId, { n: 2, type: "ADJUSTMENT", refType: "OPNAME", refId: `${tag}-opn`, qty: 2 }, false);
    await penyesuaian(itemId, { n: 3, type: "NEGATIVE", qtyChange: -3, source: "FULFILLMENT_CONSUME" }); // 9
    await penyesuaian(itemId, { n: 4, type: "NEGATIVE", qtyChange: -2, source: "VAN_LOAD" }); // 7
    await penyesuaian(itemId, { n: 5, type: "POSITIVE", qtyChange: 1, source: "VAN_RETURN" }); // 8
    await penyesuaian(itemId, { n: 6, type: "NEGATIVE", qtyChange: -1, source: "KONSI_TRANSFER" }); // 7
    await penyesuaian(itemId, { n: 7, type: "POSITIVE", qtyChange: 1, source: "STORE_RETURN_RECEIVE" }); // 8
    await penyesuaian(itemId, { n: 8, type: "NEGATIVE", qtyChange: -1, source: "STORE_EXCHANGE_OUT" }); // 7
    await penyesuaian(itemId, { n: 9, type: "NEGATIVE", qtyChange: -1, source: "FIELD_SALES_CONSUME" }); // 6
    // Penyesuaian manual +4, dua buku seperti createStockAdjustment.
    const manual = await penyesuaian(itemId, { n: 10, type: "POSITIVE", qtyChange: 4, source: "ERP" }); // 10
    await movement(itemId, { n: 10, type: "ADJUSTMENT", refType: "ADJUSTMENT", refId: manual.id, qty: 4 }, false);
    // Webhook Jubelio lewat penulis sungguhan: stok absolut 10 → 11.
    await applyJubelioStockAdjustment(prisma, {
      itemId,
      variantSku: "",
      newQty: 11,
      idempotencyKey: `${tag}-webhook`,
      externalRef: `${tag}-webhook`,
      reason: `uji ${tag} webhook`,
    });

    // Barang B: 15 pcs di gudang, tapi hanya +10 − 3 yang berdokumen (8 pcs stok awal tanpa dokumen).
    await prisma.inventoryValue.update({
      where: { itemId_variantSku: { itemId: seededId(itemTanpaDokId), variantSku: "" } },
      data: { qtyOnHand: 8, totalValue: 8 * HARGA },
    });
    await movement(itemTanpaDokId, { n: 1, type: "IN", refType: "GRN", refId: `${tag}-grnB`, qty: 10 });
    await penyesuaian(itemTanpaDokId, { n: 2, type: "NEGATIVE", qtyChange: -3, source: "FULFILLMENT_CONSUME" });
    // Gerakan varian S (StockMovement saja) untuk mode varian.
    await prisma.inventoryValue.create({
      data: { itemId: itemTanpaDokId, variantSku: `${tag}-S`, qtyOnHand: 0, avgCost: HARGA, totalValue: 0 },
    });
    await movement(itemTanpaDokId, { n: 3, type: "IN", refType: "GRN", refId: `${tag}-grnS`, qty: 4, variantSku: `${tag}-S` }, false);
    await prisma.inventoryValue.update({
      where: { itemId_variantSku: { itemId: seededId(itemTanpaDokId), variantSku: `${tag}-S` } },
      data: { qtyOnHand: 4, totalValue: 4 * HARGA },
    });
  }, 60_000);

  afterAll(async () => {
    for (const id of [itemId, itemTanpaDokId]) {
      if (!id) continue;
      await prisma.stockMovement.deleteMany({ where: { itemId: seededId(id) } });
      await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(id) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(id) } });
      await prisma.item.delete({ where: { id: seededId(id) } });
    }
    if (kategoriId) await prisma.itemCategory.delete({ where: { id: seededId(kategoriId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  it("memuat semua sumber gerakan, sekali per kejadian, dengan arah yang benar", async () => {
    const kartu = await getStockCard(itemId, rentang);
    expect(kartu.movements.map((m) => [m.jenis, m.in, m.out])).toEqual([
      ["GRN", 10, null],
      ["OPNAME", 2, null],
      ["FULFILLMENT_CONSUME", null, 3],
      ["VAN_LOAD", null, 2],
      ["VAN_RETURN", 1, null],
      ["KONSI_TRANSFER", null, 1],
      ["STORE_RETURN_RECEIVE", 1, null],
      ["STORE_EXCHANGE_OUT", null, 1],
      ["FIELD_SALES_CONSUME", null, 1],
      ["ADJUSTMENT", 4, null],
      ["JUBELIO_WEBHOOK", 1, null],
    ]);
  });

  it("Σ gerakan = qtyOnHand dan saldo/nilai akhir = InventoryValue (pcs dan rupiah)", async () => {
    const kartu = await getStockCard(itemId, rentang);
    const sekarang = await stok(itemId);
    expect(sekarang).toEqual({ qty: 11, nilai: 110_000 });
    const masuk = kartu.movements.reduce((s, m) => s + (m.in ?? 0), 0);
    const keluar = kartu.movements.reduce((s, m) => s + (m.out ?? 0), 0);
    expect(masuk - keluar).toBe(11);
    expect(kartu.openingBalance).toBe(0);
    expect(kartu.openingValue).toBe(0);
    expect(kartu.closingBalance).toBe(11);
    expect(kartu.closingValue).toBe(110_000);
    expect(kartu.movements.at(-1)?.balance).toBe(11);
    expect(kartu.movements.map((m) => m.balance)).toEqual([10, 12, 9, 7, 8, 7, 8, 7, 6, 10, 11]);
    expect(kartu.tanpaDokumen).toBe(0);
  });

  it("rentang di tengah: saldo awal = gerakan sebelumnya, saldo akhir = posisi di akhir rentang", async () => {
    const kartu = await getStockCard(itemId, { from: jam(3), to: jam(6) });
    expect(kartu.openingBalance).toBe(12);
    expect(kartu.openingValue).toBe(120_000);
    expect(kartu.movements.map((m) => m.jenis)).toEqual(["FULFILLMENT_CONSUME", "VAN_LOAD", "VAN_RETURN", "KONSI_TRANSFER"]);
    expect(kartu.closingBalance).toBe(7);
    expect(kartu.closingValue).toBe(70_000);
  });

  it("stok tanpa dokumen disebut, saldo akhir tetap Σ qtyOnHand semua varian", async () => {
    const kartu = await getStockCard(itemTanpaDokId, rentang);
    // 8 tanpa dokumen + 10 − 3 (tanpa varian) + 4 (varian S) = 19.
    expect(kartu.openingBalance).toBe(8);
    expect(kartu.openingValue).toBe(80_000);
    expect(kartu.tanpaDokumen).toBe(8);
    expect(kartu.closingBalance).toBe(19);
    expect(kartu.closingValue).toBe(190_000);
    expect(kartu.penyesuaianTanpaVarian).toBe(0);
  });

  it("mode varian: hanya gerakan varian itu, dan penyesuaian tanpa varian diperingatkan", async () => {
    const kartu = await getStockCard(itemTanpaDokId, rentang, `${tag}-S`);
    expect(kartu.movements.map((m) => [m.jenis, m.in, m.variantSku])).toEqual([["GRN", 4, `${tag}-S`]]);
    expect(kartu.closingBalance).toBe(4);
    expect(kartu.penyesuaianTanpaVarian).toBe(1);
    expect(kartu.tanpaDokumen).toBeNull();
  });

  it("mode varian, rentang lampau: penyesuaian SESUDAH rentang tetap diperingatkan (menggeser saldo jangkar)", async () => {
    // Rentang berakhir jam 1, penjualan tanpa varian jam 2: tidak tampil di rentang,
    // tapi ikut menggeser saldo yang dijangkar ke stok sekarang.
    const kartu = await getStockCard(itemTanpaDokId, { from: jam(0), to: jam(1) }, `${tag}-S`);
    expect(kartu.movements).toHaveLength(0);
    expect(kartu.penyesuaianTanpaVarian).toBe(1);
  });

  it("per kategori memakai sumber yang sama: saldo akhir tiap barang = qtyOnHand", async () => {
    const hasil = await getStockCardByCategory(kategoriId, rentang);
    const per = new Map(hasil.items.map((r) => [r.item?.sku, r]));
    expect(per.get(`${tag}-A`)?.closingBalance).toBe(11);
    expect(per.get(`${tag}-A`)?.movements).toHaveLength(11);
    expect(per.get(`${tag}-A`)?.closingValue).toBe(110_000);
    expect(per.get(`${tag}-B`)?.closingBalance).toBe(19);
  });
});

d("kartu stok lewat penulis sungguhan (test bed only)", () => {
  // Penyesuaian manual ditulis createStockAdjustment ke DUA buku (StockAdjustment +
  // StockMovement); webhook Jubelio lewat applyJubelioStockAdjustment. Kartu harus
  // memuat tiap kejadian sekali dan Σ masuk − Σ keluar = qtyOnHand.
  let uomId = "";
  let itemId = "";
  let userId = "";
  const tagC = `${tag}-C`;

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tagC}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tagC, nameId: `Barang ${tagC}`, nameEn: "Test", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 0, avgCost: 1_000, totalValue: 0 },
    });
    userId = (await prisma.user.create({ data: { email: `${tagC.toLowerCase()}@uji.local`, name: `${tagC} Gudang` } })).id;
    sesi.id = userId;
  }, 60_000);

  afterAll(async () => {
    if (itemId) {
      const adj = await prisma.stockAdjustment.findMany({ where: { itemId: seededId(itemId) }, select: { id: true } });
      const adjIds = adj.map((a) => a.id);
      await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(adjIds) } } });
      await prisma.stockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.delete({ where: { id: seededId(itemId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
    sesi.id = "penguji-kartu-stok";
  });

  it("penyesuaian manual dua buku tampil sekali; Σ gerakan = qtyOnHand, nilai akhir = totalValue", async () => {
    await createStockAdjustment({ itemId, type: "POSITIVE", qty: 5, reason: `uji ${tagC} tambah` }, "123456", userId);
    await createStockAdjustment({ itemId, type: "NEGATIVE", qty: 2, reason: `uji ${tagC} kurang` }, "123456", userId);
    await applyJubelioStockAdjustment(prisma, {
      itemId,
      variantSku: "",
      newQty: 2,
      idempotencyKey: `${tagC}-webhook`,
      externalRef: `${tagC}-webhook`,
      reason: `uji ${tagC} webhook`,
    });
    // Kedua buku sungguh terisi untuk penyesuaian manual.
    expect(await prisma.stockMovement.count({ where: { itemId: seededId(itemId) } })).toBe(2);
    expect(await prisma.stockAdjustment.count({ where: { itemId: seededId(itemId) } })).toBe(3);

    const kartu = await getStockCard(itemId, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(kartu.movements.map((m) => [m.jenis, m.in, m.out, m.balance])).toEqual([
      ["ADJUSTMENT", 5, null, 5],
      ["ADJUSTMENT", null, 2, 3],
      ["JUBELIO_WEBHOOK", null, 1, 2],
    ]);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({
      where: { itemId_variantSku: { itemId: seededId(itemId), variantSku: "" } },
    });
    expect(Number(inv.qtyOnHand)).toBe(2);
    const masuk = kartu.movements.reduce((s, m) => s + (m.in ?? 0), 0);
    const keluar = kartu.movements.reduce((s, m) => s + (m.out ?? 0), 0);
    expect(masuk - keluar).toBe(Number(inv.qtyOnHand));
    expect(kartu.openingBalance).toBe(0);
    expect(kartu.openingValue).toBe(0);
    expect(kartu.tanpaDokumen).toBe(0);
    expect(kartu.closingBalance).toBe(2);
    expect(kartu.closingValue).toBe(Number(inv.totalValue));
    expect(kartu.closingValue).toBe(2_000);
  });
});
