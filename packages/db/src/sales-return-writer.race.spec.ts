import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "./index";
import { acceptReturnItem } from "./sales-return-writer";
import { seededId, seededIds } from "./spec-teardown";

/*
 * Retur marketplace diterima (restock) bersamaan dengan penulis stok lain.
 *
 * Dulu `acceptReturnItem` membaca `qtyOnHand`, menambah di JavaScript, lalu
 * menulis angka MUTLAK. Penulis lain yang commit di antara baca dan tulisnya
 * (webhook stok, kirim pesanan, penyesuaian) hilang tanpa jejak.
 *
 * Urutan dibuat pasti, bukan untung-untungan waktu: transaksi B menambah stok
 * dan MENAHAN kunci barisnya; selagi B menahan, A (retur diterima) membaca lalu
 * menulis — tulisan A menunggu kunci B, dan baru jalan setelah B commit.
 * Penulisan mutlak menghasilkan 10 + 2 = 12 (tambahan B hilang); increment atom
 * menghasilkan 10 + 5 + 2 = 17.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("acceptReturnItem bersamaan dengan penulis stok lain (test bed only)", () => {
  const tag = `RETRACE-${Math.random().toString(36).slice(2, 9)}`;
  let uomId = "";
  let itemId = "";
  let userId = "";
  let invId = "";
  let returnId = "";
  let returnItemId = "";

  const STOK_AWAL = 10;
  const QTY_RETUR = 2;
  const TAMBAH_LAIN = 5;
  const AVG = 40_000;

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    invId = "";
    returnId = "";
    returnItemId = "";

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kaos retur", nameEn: "Return tee", type: "FINISHED_GOOD", isActive: true, uomId },
      })
    ).id;
    userId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.local`, name: "Penguji retur" } })).id;
    // Barang buatan ERP: baris tanpa varian bernilai null.
    invId = (
      await prisma.inventoryValue.create({
        data: { itemId, variantSku: null, qtyOnHand: STOK_AWAL, avgCost: AVG, totalValue: STOK_AWAL * AVG },
      })
    ).id;
    const ret = await prisma.salesReturn.create({
      data: {
        jubelioReturnId: 1_500_000_000 + Math.floor(Math.random() * 400_000_000),
        channel: "SHOPEE",
        totalQty: QTY_RETUR,
        receivedAt: new Date(),
        rawIngestPayload: {},
        items: {
          create: {
            itemId,
            variantSku: null,
            externalSku: tag,
            productName: "Kaos retur",
            qty: QTY_RETUR,
            unitPrice: 100_000,
            subtotal: QTY_RETUR * 100_000,
          },
        },
      },
      include: { items: { select: { id: true } } },
    });
    returnId = ret.id;
    returnItemId = ret.items[0].id;
  });

  afterEach(async () => {
    await prisma.salesReturnItem.deleteMany({ where: { salesReturnId: seededId(returnId) } });
    await prisma.salesReturn.deleteMany({ where: { id: seededId(returnId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([itemId].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("tambahan stok yang commit di tengah tidak hilang (10 + 5 + 2 = 17 pcs, nilai ikut)", async () => {
    let beriTahuKunci!: () => void;
    const kunciDipegang = new Promise<void>((r) => (beriTahuKunci = r));

    const lain = prisma.$transaction(
      async (tx) => {
        await tx.inventoryValue.update({
          where: { id: invId },
          data: { qtyOnHand: { increment: TAMBAH_LAIN }, totalValue: { increment: TAMBAH_LAIN * AVG } },
        });
        beriTahuKunci();
        await tidur(500);
      },
      { timeout: 10_000 },
    );

    await kunciDipegang;
    const retur = prisma.$transaction(
      (tx) => acceptReturnItem(tx, { returnItemId, reason: "Barang kembali utuh", changedById: userId }),
      { timeout: 10_000 },
    );

    const [, hasil] = await Promise.all([lain, retur]);
    expect(hasil.applied).toBe(true);

    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(STOK_AWAL + TAMBAH_LAIN + QTY_RETUR);
    expect(Number(inv.totalValue)).toBe((STOK_AWAL + TAMBAH_LAIN + QTY_RETUR) * AVG);
    // Tidak ada baris kembar: baris null yang sama yang bertambah.
    expect(await prisma.inventoryValue.count({ where: { itemId } })).toBe(1);

    // Jejak penyesuaian menyebut angka yang sungguh terjadi, bukan bacaan basi.
    const adj = await prisma.stockAdjustment.findFirstOrThrow({
      where: { itemId, source: "ERP_RETURN_ACCEPT" },
      select: { prevQty: true, newQty: true, qtyChange: true },
    });
    expect(Number(adj.qtyChange)).toBe(QTY_RETUR);
    expect(Number(adj.newQty)).toBe(STOK_AWAL + TAMBAH_LAIN + QTY_RETUR);
    expect(Number(adj.prevQty)).toBe(STOK_AWAL + TAMBAH_LAIN);
  });

  it("dua penerimaan serentak atas baris retur yang sama menambah stok sekali (10 + 2 = 12 pcs)", async () => {
    const terima = () =>
      prisma.$transaction(
        (tx) => acceptReturnItem(tx, { returnItemId, reason: "Barang kembali utuh", changedById: userId }),
        { timeout: 10_000 },
      );
    const hasil = await Promise.allSettled([terima(), terima()]);

    // Yang kalah ditolak kunci idempotensi penyesuaian dan seluruh transaksinya
    // (termasuk increment-nya) dibatalkan — atau melihat keputusan yang sudah ada.
    const berhasil = hasil.filter((h) => h.status === "fulfilled" && h.value.applied);
    expect(berhasil).toHaveLength(1);
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(STOK_AWAL + QTY_RETUR);
    expect(await prisma.stockAdjustment.count({ where: { itemId, source: "ERP_RETURN_ACCEPT" } })).toBe(1);
  });

  it("diterima sekali saja walau dipanggil dua kali", async () => {
    const pertama = await prisma.$transaction((tx) =>
      acceptReturnItem(tx, { returnItemId, reason: "Barang kembali utuh", changedById: userId }),
    );
    const kedua = await prisma.$transaction((tx) =>
      acceptReturnItem(tx, { returnItemId, reason: "Barang kembali utuh", changedById: userId }),
    );
    expect(pertama.applied).toBe(true);
    expect(kedua).toEqual({ applied: false, skipped: "already_decided" });
    const inv = await prisma.inventoryValue.findUniqueOrThrow({ where: { id: invId } });
    expect(Number(inv.qtyOnHand)).toBe(STOK_AWAL + QTY_RETUR);
  });
});
