import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Aksi inventori terhadap basis data uji sungguhan (sesi, PIN, dan notifikasi
 * ditiru).
 *
 * Yang dibuktikan:
 *  - penyesuaian stok manual memakai penghitung bersama ADJ, jadi penulis lain
 *    yang memakai `generateDocNumber("ADJ")` sesudahnya tidak pernah mendapat
 *    nomor yang sudah dipakai penyesuaian manual (dulu manual memakai "nomor
 *    terbesar + 1" sendiri → tabrakan unik terus sampai bulan berganti);
 *  - setiap aksi baca inventori butuh `inventory:view` (rata-rata HPP juga
 *    boleh untuk `work_orders:view`, karena halaman keluarkan bahan WO
 *    memakainya), tanpa sesi ditolak, dan pengguna sah tetap boleh;
 *  - daftar penyesuaian tidak lagi membawa id pengguna mentah, hanya nama.
 */

const sesi = vi.hoisted(() => ({ ada: true, id: "", permissions: ["inventory:view"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    sesi.ada ? { user: { id: sesi.id, email: null, permissions: sesi.permissions } } : null,
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async () => ({ success: true, userId: sesi.id })),
}));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(async () => "Penguji"),
  notifyStockAdjustmentCreated: vi.fn(async () => {}),
}));

const {
  createStockAdjustment,
  getGRNs,
  getStockAdjustments,
  getStockAdjustmentById,
  getItemAvgCosts,
  getRejectedGoodsRecap,
  getInventoryStats,
} = await import("./inventory");
const { generateDocNumber } = await import("@/lib/docNumber");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `INVA-${Math.random().toString(36).slice(2, 9)}`;

/** "ADJ/2026/10/0074" → { awalan: "ADJ/2026/10/", angka: 74, lebar: 4 } */
function urai(nomor: string) {
  const potong = nomor.lastIndexOf("/") + 1;
  const ekor = nomor.slice(potong);
  return { awalan: nomor.slice(0, potong), angka: Number.parseInt(ekor, 10), lebar: ekor.length };
}

d("aksi inventori (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let userId = "";
  let adjIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    userId = "";
    adjIds = [];
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: `Barang ${tag}`, nameEn: "Test", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 10, avgCost: 1000, totalValue: 10_000 },
    });
    userId = (await prisma.user.create({ data: { email: `${tag}@uji.local`, name: `${tag} Gudang` } })).id;
    sesi.id = userId;
  });

  beforeEach(() => {
    sesi.ada = true;
    sesi.permissions = ["inventory:view"];
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { refId: { in: seededIds(adjIds) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(adjIds) } } });
    await prisma.stockAdjustment.deleteMany({ where: { id: { in: seededIds(adjIds) } } });
    if (itemId) {
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.delete({ where: { id: seededId(itemId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  async function penyesuaianManual(qty: number) {
    sesi.permissions = ["inventory:manage"];
    const adj = await createStockAdjustment(
      { itemId, type: "POSITIVE", qty, reason: `uji ${tag} manual` },
      "123456",
      userId,
    );
    adjIds.push(adj.id);
    return adj;
  }

  it("penyesuaian manual memakai penghitung bersama: generator sesudahnya tidak bertabrakan", async () => {
    // Penulis lain (muat van, opname…) sudah memakai nomor terakhir penghitung.
    const dariPenghitung = await generateDocNumber("ADJ");
    const lain = await prisma.stockAdjustment.create({
      data: {
        docNumber: dariPenghitung,
        itemId,
        type: "POSITIVE",
        qtyChange: 1,
        reason: `uji ${tag} van`,
        prevQty: 0,
        newQty: 1,
        prevAvgCost: 0,
        newAvgCost: 0,
      },
      select: { id: true },
    });
    adjIds.push(lain.id);

    const manual = await penyesuaianManual(2);
    // Nomor manual berasal dari penghitung: penghitung sudah mencatatnya.
    const penghitung = await prisma.docNumberConfig.findUniqueOrThrow({ where: { docType: "ADJ" } });
    expect(penghitung.lastNumber).toBeGreaterThanOrEqual(urai(manual.docNumber).angka);

    const sesudah = await generateDocNumber("ADJ");

    expect(manual.docNumber).toMatch(/^ADJ\/\d{4}\/\d{2}\/\d{4,}$/);
    expect(urai(sesudah).awalan).toBe(urai(manual.docNumber).awalan);
    // Penghitung sudah melewati nomor manual, dan nomornya belum dipakai siapa pun.
    expect(urai(sesudah).angka).toBeGreaterThan(urai(manual.docNumber).angka);
    expect(await prisma.stockAdjustment.count({ where: { docNumber: sesudah } })).toBe(0);
  });

  it("dua penyesuaian manual paralel mendapat nomor berbeda dan tidak saling menimpa stok", async () => {
    const stok = async () =>
      Number(
        (
          await prisma.inventoryValue.findUniqueOrThrow({
            where: { itemId_variantSku: { itemId: seededId(itemId), variantSku: "" } },
          })
        ).qtyOnHand,
      );
    const sebelum = await stok();
    const [a, b] = await Promise.all([penyesuaianManual(1), penyesuaianManual(1)]);
    expect(a.docNumber).not.toBe(b.docNumber);
    // Dulu tabrakan nomor kebetulan menggagalkan yang kedua; begitu nomornya
    // berbeda, keduanya harus benar-benar menambah stok, bukan yang belakangan
    // menimpa hasil yang pertama dengan qty yang dibacanya sebelum itu.
    expect(await stok()).toBe(sebelum + 2);
    const rantai = [a, b].sort((x, y) => Number(x.prevQty) - Number(y.prevQty));
    expect(Number(rantai[0].prevQty)).toBe(sebelum);
    expect(Number(rantai[1].prevQty)).toBe(sebelum + 1);
  });

  it("aksi baca menolak pengguna tanpa inventory:view", async () => {
    sesi.permissions = ["pwa:access"];
    await expect(getStockAdjustments(itemId, { page: 1, pageSize: 5 })).rejects.toThrow(/Forbidden/);
    await expect(getStockAdjustmentById("tidak-ada")).rejects.toThrow(/Forbidden/);
    await expect(getRejectedGoodsRecap({ itemId })).rejects.toThrow(/Forbidden/);
    await expect(getItemAvgCosts([itemId])).rejects.toThrow(/Forbidden/);
    await expect(getInventoryStats()).rejects.toThrow(/Forbidden/);
    await expect(getGRNs({ supplierId: "tidak-ada" })).rejects.toThrow(/Forbidden/);
  });

  it("aksi baca menolak tanpa sesi", async () => {
    sesi.ada = false;
    await expect(getStockAdjustments(itemId)).rejects.toThrow(/Unauthorized/);
    await expect(getRejectedGoodsRecap()).rejects.toThrow(/Unauthorized/);
    await expect(getItemAvgCosts([itemId])).rejects.toThrow(/Unauthorized/);
  });

  it("pengguna dengan inventory:view tetap boleh membaca", async () => {
    sesi.permissions = ["inventory:view"];
    const daftar = await getStockAdjustments(itemId, { page: 1, pageSize: 10 });
    expect(Array.isArray(daftar)).toBe(false);
    if (Array.isArray(daftar)) return;
    expect(daftar.totalCount).toBeGreaterThan(0);
    await expect(getRejectedGoodsRecap({ itemId })).resolves.toEqual({ items: [], totalCount: 0 });
    await expect(getItemAvgCosts([itemId])).resolves.toEqual({ [itemId]: expect.any(Number) });
    await expect(getInventoryStats()).resolves.toMatchObject({ totalItems: expect.any(Number) });
    await expect(getGRNs({ supplierId: "tidak-ada" })).resolves.toEqual([]);
  });

  it("admin dengan wildcard * tetap boleh membaca", async () => {
    sesi.permissions = ["*"];
    await expect(getRejectedGoodsRecap({ itemId })).resolves.toEqual({ items: [], totalCount: 0 });
  });

  it("rata-rata HPP juga boleh untuk work_orders:view (halaman keluarkan bahan WO)", async () => {
    sesi.permissions = ["work_orders:view"];
    await expect(getItemAvgCosts([itemId])).resolves.toEqual({ [itemId]: expect.any(Number) });
    // …tapi itu bukan pintu ke aksi inventori lain.
    await expect(getStockAdjustments(itemId)).rejects.toThrow(/Forbidden/);
  });

  it("daftar dan rincian penyesuaian hanya membawa nama pengguna, bukan id mentah", async () => {
    const adj = await penyesuaianManual(1);
    sesi.permissions = ["inventory:view"];

    const daftar = await getStockAdjustments(itemId);
    expect(Array.isArray(daftar)).toBe(true);
    if (!Array.isArray(daftar)) return;
    const baris = daftar.find((r) => r.id === adj.id);
    expect(baris).toBeDefined();
    expect(baris).not.toHaveProperty("approvedById");
    expect(baris).not.toHaveProperty("createdById");
    expect(baris?.createdBy?.name).toBe(`${tag} Gudang`);
    expect(baris?.approvedBy?.name).toBe(`${tag} Gudang`);

    const halaman = await getStockAdjustments(itemId, { page: 1, pageSize: 50 });
    if (Array.isArray(halaman)) throw new Error("bentuk halaman salah");
    const barisHalaman = halaman.items.find((r) => r.id === adj.id);
    expect(barisHalaman).not.toHaveProperty("approvedById");
    expect(barisHalaman).not.toHaveProperty("createdById");

    const rinci = await getStockAdjustmentById(adj.id);
    expect(rinci).not.toHaveProperty("approvedById");
    expect(rinci).not.toHaveProperty("createdById");
    expect(rinci?.approvedBy?.name).toBe(`${tag} Gudang`);
  });
});
