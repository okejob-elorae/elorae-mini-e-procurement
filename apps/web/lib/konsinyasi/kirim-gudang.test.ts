import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds, transferKonsiStock } from "@elorae/db";
import { bukaSiklus, catatLaporan, kirimTitipan, kunciAngka } from "./writer";
import { catatHitunganGudang } from "@/lib/receivables/return-writer";
import { stokDiToko } from "./stok-di-toko";

/**
 * Toko konsinyasi = gudang lain milik kita (keputusan pemilik), lewat jalur kiriman modul
 * konsinyasi (`kirimTitipan`), terhadap basis data sungguhan:
 *
 *   gudang 50 pcs × Rp40.000 (Rp2.000.000)
 *   kirim 10  → gudang 40 (Rp1.600.000), titipan toko 10, satu entri buku stok gudang
 *   jual 3    → gudang tetap 40,           titipan 7   (angka resmi siklus dikunci)
 *   retur 2   → gudang 42 (Rp1.680.000),   titipan 5   (NRI dihitung gudang)
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("kiriman titipan konsinyasi memindahkan stok gudang ke toko", () => {
  const tag = `KGD${Math.random().toString(36).slice(2, 8)}`;
  let tokoId = "";
  let uomId = "";
  let barangId = "";
  let adminId = "";
  let siklusId = "";
  let kirimIds: string[] = [];
  let nriIds: string[] = [];
  let tokoPutusId = "";

  beforeEach(async () => {
    tokoId = "";
    tokoPutusId = "";
    uomId = "";
    barangId = "";
    adminId = "";
    siklusId = "";
    kirimIds = [];
    nriIds = [];
    tokoId = (await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "KONSI", isActive: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    barangId = (
      await prisma.item.create({
        data: { sku: `${tag}-I`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    adminId = (await prisma.user.create({ data: { email: `${tag}@uji.local`.toLowerCase(), name: `${tag} Admin`, passwordHash: "x" } })).id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: seededId(adminId) } });
    await prisma.warehouseReturnItem.deleteMany({ where: { warehouseReturnId: { in: seededIds(nriIds) } } });
    await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nriIds) } } });
    await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: seededId(siklusId) } } });
    await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklusId) } });
    await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
    await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklusId) } });
    await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: { in: seededIds(kirimIds) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds(kirimIds) } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(barangId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(barangId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(barangId) } });
    await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(adminId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    if (tokoPutusId) await prisma.store.delete({ where: { id: tokoPutusId } });
  });

  const stokAwal = async (rows: Array<{ variantSku: string | null; qty: number }>) => {
    for (const r of rows) {
      await prisma.inventoryValue.create({
        data: { itemId: barangId, variantSku: r.variantSku, qtyOnHand: r.qty, reservedQty: 0, avgCost: 40000, totalValue: r.qty * 40000 },
      });
    }
  };

  const gudang = async (variantSku: string | null = null) => {
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: barangId, variantSku } });
    return { qty: Number(inv!.qtyOnHand), nilai: Number(inv!.totalValue) };
  };

  const titipan = async () =>
    (await stokDiToko(tokoId)).baris.filter((b) => b.itemId === barangId).reduce((s, b) => s + b.qty, 0);

  const kirim = async (items: Parameters<typeof kirimTitipan>[0]["items"]) => {
    const h = await kirimTitipan({ storeId: tokoId, olehUserId: adminId, shippedAt: new Date("2026-09-02T03:00:00Z"), items });
    if (h.ok) kirimIds.push(h.id);
    return h;
  };

  it("kirim 10 → jual 3 → retur 2: gudang 50→40→40→42, titipan 10→7→5", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);

    const h = await kirim([{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 100000 }]);
    expect(h.ok).toBe(true);
    expect(await gudang()).toEqual({ qty: 40, nilai: 1_600_000 });
    expect(await titipan()).toBe(10);
    const adj = await prisma.stockAdjustment.findMany({ where: { itemId: barangId } });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ source: "KONSI_TRANSFER", type: "NEGATIVE", createdById: adminId });
    expect(Number(adj[0].qtyChange)).toBe(-10);
    expect(Number(adj[0].prevAvgCost)).toBe(40000);
    expect(Number(adj[0].newAvgCost)).toBe(40000);
    // Potongan gudang tercatat di buku stok, menunjuk penyesuaiannya.
    const buku = await prisma.stockLedgerEntry.findMany({ where: { itemId: barangId } });
    expect(buku).toHaveLength(1);
    expect(buku[0]).toMatchObject({ locationType: "MAIN", type: "OUT", refType: "StockAdjustment", refId: adj[0].id, createdById: adminId });
    expect([Number(buku[0].qty), Number(buku[0].balanceQty), Number(buku[0].balanceValue)]).toEqual([-10, 40, 1_600_000]);

    // Jual 3 di toko: angka resmi siklus dikunci. Gudang tidak bergerak.
    const s = await bukaSiklus({ storeId: tokoId, periodYear: 2026, periodMonth: 9, olehUserId: adminId });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    siklusId = s.id;
    const laporan = [{ itemId: barangId, itemName: `${tag} Blus`, qty: 3 }];
    expect((await catatLaporan({ cycleId: siklusId, source: "SPG", reportedAt: new Date("2026-09-30T05:00:00Z"), olehUserId: adminId, items: laporan })).ok).toBe(true);
    expect((await catatLaporan({ cycleId: siklusId, source: "TOKO", reportedAt: new Date("2026-09-30T05:00:00Z"), olehUserId: adminId, items: laporan })).ok).toBe(true);
    expect((await kunciAngka({ cycleId: siklusId, olehUserId: adminId, baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 3, price: 100000 }] })).ok).toBe(true);
    expect(await gudang()).toEqual({ qty: 40, nilai: 1_600_000 });
    expect(await titipan()).toBe(7);

    // Retur 2 dari toko, dihitung gudang (NRI): kembali ke gudang utama, sekali.
    const nri = await catatHitunganGudang({
      storeId: tokoId,
      warehouseUserId: adminId,
      receivedAt: new Date("2026-10-02T03:00:00Z"),
      deliveryMethod: "SALES",
      items: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 2, price: 100000, condition: "LAYAK" }],
    });
    expect(nri.ok).toBe(true);
    if (nri.ok) nriIds.push(nri.id);
    expect(await gudang()).toEqual({ qty: 42, nilai: 1_680_000 });
    expect(await titipan()).toBe(5);
    expect(await prisma.stockAdjustment.count({ where: { itemId: barangId } })).toBe(2);
  });

  it("stok gudang kurang: ditolak STOK_KURANG, tidak ada kiriman, gudang tetap", async () => {
    await stokAwal([{ variantSku: null, qty: 4 }]);
    const h = await kirim([{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 100000 }]);
    expect(h).toMatchObject({ ok: false, alasan: "STOK_KURANG" });
    expect(await prisma.consignmentShipment.count({ where: { storeId: tokoId } })).toBe(0);
    expect(await gudang()).toEqual({ qty: 4, nilai: 160_000 });
  });

  it("toko PUTUS atau toko yang tidak ada: ditolak TOKO_BUKAN_KONSI, gudang tidak bergerak", async () => {
    // Titipan hanya dihitung untuk toko KONSI. Kiriman ke toko lain akan mengeluarkan barang dari
    // gudang tanpa pernah tercatat di stok toko mana pun — barangnya hilang dari semua hitungan.
    await stokAwal([{ variantSku: null, qty: 50 }]);
    tokoPutusId = (await prisma.store.create({ data: { code: `${tag}-P`, name: `${tag} Putus`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    const baris = [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 100000 }];
    const putus = await kirimTitipan({ storeId: tokoPutusId, olehUserId: adminId, shippedAt: new Date("2026-09-02T03:00:00Z"), items: baris });
    if (putus.ok) kirimIds.push(putus.id);
    expect(putus).toMatchObject({ ok: false, alasan: "TOKO_BUKAN_KONSI" });
    const hilang = await kirimTitipan({ storeId: `${tag}-tidak-ada`, olehUserId: adminId, shippedAt: new Date("2026-09-02T03:00:00Z"), items: baris });
    if (hilang.ok) kirimIds.push(hilang.id);
    expect(hilang).toMatchObject({ ok: false, alasan: "TOKO_BUKAN_KONSI" });
    expect(await gudang()).toEqual({ qty: 50, nilai: 2_000_000 });
    expect(await prisma.stockAdjustment.count({ where: { itemId: barangId } })).toBe(0);
  });

  it("stok yang sudah dicadangkan pesanan lain tidak ikut terkirim", async () => {
    await stokAwal([{ variantSku: null, qty: 12 }]);
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(barangId) }, data: { reservedQty: 5 } });
    const h = await kirim([{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 100000 }]);
    expect(h).toMatchObject({ ok: false, alasan: "STOK_KURANG" });
    expect((await gudang()).qty).toBe(12);
  });

  it("barang bervarian tanpa varian dipilih: VARIAN_WAJIB; dengan varian: hanya varian itu yang berkurang", async () => {
    await stokAwal([
      { variantSku: `${tag}-S`, qty: 20 },
      { variantSku: `${tag}-M`, qty: 20 },
    ]);
    const tanpa = await kirim([{ itemId: barangId, itemName: `${tag} Blus`, qty: 5, price: 100000 }]);
    expect(tanpa).toMatchObject({ ok: false, alasan: "VARIAN_WAJIB" });
    expect(await prisma.consignmentShipment.count({ where: { storeId: tokoId } })).toBe(0);

    const dengan = await kirim([{ itemId: barangId, variantSku: `${tag}-M`, itemName: `${tag} Blus`, qty: 5, price: 100000 }]);
    expect(dengan.ok).toBe(true);
    expect((await gudang(`${tag}-S`)).qty).toBe(20);
    expect(await gudang(`${tag}-M`)).toEqual({ qty: 15, nilai: 600_000 });
    const baris = await prisma.consignmentShipmentItem.findMany({ where: { shipmentId: { in: seededIds(kirimIds) } } });
    expect(baris.map((b) => b.variantSku)).toEqual([`${tag}-M`]);
    // Titipan per ukuran memakai varian kiriman.
    const toko = await stokDiToko(tokoId);
    expect(toko.baris.filter((b) => b.itemId === barangId).map((b) => [b.variantSku, b.qty])).toEqual([[`${tag}-M`, 5]]);
  });

  it("barang dengan SATU baris stok (varian tunggal) dipotong tanpa harus memilih varian", async () => {
    await stokAwal([{ variantSku: `${tag}-ALL`, qty: 8 }]);
    const h = await kirim([{ itemId: barangId, itemName: `${tag} Blus`, qty: 3, price: 100000 }]);
    expect(h.ok).toBe(true);
    expect((await gudang(`${tag}-ALL`)).qty).toBe(5);
  });

  it("baris yang hanya diketik namanya (tanpa itemId) tercatat tapi tidak menggerakkan stok", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const h = await kirim([{ itemName: `${tag} Barang lepas`, qty: 7, price: 50000 }]);
    expect(h.ok).toBe(true);
    expect((await gudang()).qty).toBe(50);
    expect(await prisma.stockAdjustment.count({ where: { itemId: barangId } })).toBe(0);
  });

  it("pemindahan dengan kunci yang sama tidak memotong dua kali (kirim ulang)", async () => {
    await stokAwal([{ variantSku: null, qty: 50 }]);
    const baris = {
      itemId: barangId,
      variantSku: "",
      qty: 10,
      idempotencyKey: `uji-${tag}-1`,
      docNumber: `UJI-${tag}-1`,
      reason: "uji",
      externalRef: "uji",
    };
    const a = await transferKonsiStock(prisma, { lines: [baris] });
    const b = await transferKonsiStock(prisma, { lines: [baris] });
    expect([a.transferred, b.transferred, b.skipped]).toEqual([1, 0, 1]);
    expect(await gudang()).toEqual({ qty: 40, nilai: 1_600_000 });
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: barangId } })).toBe(1);
  });

  it("pemindahan menolak stok yang sudah dicadangkan, tanpa menulis apa pun; ON_HAND hanya menjaga stok fisik", async () => {
    await stokAwal([{ variantSku: null, qty: 12 }]);
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(barangId) }, data: { reservedQty: 5 } });
    const baris = (n: number) => ({
      itemId: barangId,
      variantSku: "",
      qty: 10,
      idempotencyKey: `uji-${tag}-cadangan-${n}`,
      docNumber: `UJI-${tag}-C${n}`,
      reason: "uji",
      externalRef: "uji",
    });

    const tersedia = await transferKonsiStock(prisma, { lines: [baris(1)] });
    expect(tersedia).toEqual({ transferred: 0, skipped: 0, shortLines: [{ itemId: barangId, variantSku: "", requested: 10, available: 7 }] });
    expect(await gudang()).toEqual({ qty: 12, nilai: 480_000 });
    expect(await prisma.stockAdjustment.count({ where: { itemId: barangId } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: barangId } })).toBe(0);

    const fisik = await transferKonsiStock(prisma, { lines: [baris(2)], guard: "ON_HAND" });
    expect(fisik.transferred).toBe(1);
    expect(await gudang()).toEqual({ qty: 2, nilai: 80_000 });
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: barangId } })).toBe(1);
  });
});
