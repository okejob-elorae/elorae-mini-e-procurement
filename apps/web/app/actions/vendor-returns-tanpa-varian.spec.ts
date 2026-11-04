import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Retur ke pemasok untuk BAHAN tanpa varian (kain, aksesori). Baris stoknya
 * disimpan ber-`variantSku` NULL (penulis lain mencarinya toleran null/"",
 * `cariBarisStok` di lib/inventory/costing.ts). Retur dulu mencarinya KETAT ke
 * "" — uji akuntansi 2 (Okt 2026): retur 5 m linen bernilai Rp 0, lalu
 * `processReturn` menolak STOK_KURANG "perlu 5, ada 0" padahal stoknya 32,8 m.
 *
 * Benar: nilai retur 5 × 45.000 = 225.000, stok baris NULL turun 5 m (tanpa
 * baris kembaran ""), gerakan keluar 225.000, dan retur bisa diselesaikan.
 */

const sesi = vi.hoisted(() => ({ id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.permissions } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: async () => "Penguji" }));
vi.mock("@/lib/notifications/events", () => ({
  notifyVendorReturnCreated: async () => {},
  notifyVendorReturnStatusUpdated: async () => {},
}));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => {}) }));

const { createVendorReturn, updateVendorReturn, processReturn, completeReturn } = await import("./vendor-returns");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const STOK_AWAL = 32.8;
const HARGA = 45_000;
const BUKTI = { trackingNumber: "RESI-LINEN-1", receiptFileUrl: "https://contoh.local/resi-linen.jpg" };

d("retur pemasok bahan tanpa varian (baris stok variantSku NULL) — test bed only", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let linenId = "";
  let kancingId = "";
  let returIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    supplierId = "";
    uomId = "";
    linenId = "";
    kancingId = "";
    userId = (await prisma.user.create({ data: { email: `retur-null-${token}@uji.local` }, select: { id: true } })).id;
    typeId = (
      await prisma.supplierType.create({ data: { code: `TRN-${token}`, name: `Jenis ${token}` }, select: { id: true } })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-RN-${token}`, name: "Pemasok kain uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({ data: { code: `M${token}`.slice(0, 10), nameId: "Meter", nameEn: "Metre" }, select: { id: true } })
    ).id;
    linenId = (
      await prisma.item.create({
        data: { sku: `RN-LINEN-${token}`, nameId: "Linen uji", nameEn: "Test linen", type: "FABRIC", uomId },
        select: { id: true },
      })
    ).id;
    kancingId = (
      await prisma.item.create({
        data: { sku: `RN-KANCING-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    sesi.id = userId;
    sesi.permissions = ["vendor_returns:view", "vendor_returns:create", "vendor_returns:manage"];
  });

  beforeEach(async () => {
    returIds = [];
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: seededIds([linenId, kancingId]) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([linenId, kancingId]) } } });
    await prisma.inventoryValue.create({
      data: { itemId: linenId, variantSku: null, qtyOnHand: STOK_AWAL, avgCost: HARGA, totalValue: STOK_AWAL * HARGA },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "VendorReturn", userId: seededId(userId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: seededIds([linenId, kancingId]) } } });
    await prisma.vendorReturn.deleteMany({ where: { vendorId: seededId(supplierId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([linenId, kancingId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([linenId, kancingId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function barisStok() {
    return prisma.inventoryValue.findMany({
      where: { itemId: seededId(linenId) },
      select: { variantSku: true, qtyOnHand: true, avgCost: true, totalValue: true },
    });
  }

  async function buatRetur(lines: Parameters<typeof createVendorReturn>[0]["lines"]) {
    const ret = await createVendorReturn({ vendorId: supplierId, lines });
    returIds.push(ret.id);
    return ret;
  }

  it("dibuat: nilai retur 5 m linen = 5 × 45.000 = 225.000 (bukan 0)", async () => {
    const ret = await buatRetur([{ type: "FABRIC", itemId: linenId, qty: 5, reason: "Cacat tenun", condition: "DEFECTIVE" }]);
    expect(Number(ret.totalValue)).toBe(225_000);
    const baris = JSON.parse(String(ret.lines)) as Array<{ costValue: number }>;
    expect(baris.map((b) => b.costValue)).toEqual([225_000]);
  });

  it("varian dikirim sebagai \"\" juga menemukan baris NULL", async () => {
    const ret = await buatRetur([{ type: "FABRIC", itemId: linenId, variantSku: "", qty: 2, reason: "Cacat tenun", condition: "DEFECTIVE" }]);
    expect(Number(ret.totalValue)).toBe(90_000);
  });

  it("diubah selagi draf: nilai dihitung ulang dari baris NULL", async () => {
    const ret = await buatRetur([{ type: "FABRIC", itemId: linenId, qty: 1, reason: "Cacat tenun", condition: "DEFECTIVE" }]);
    const ubah = await updateVendorReturn(
      ret.id,
      { vendorId: supplierId, lines: [{ type: "FABRIC", itemId: linenId, qty: 3, reason: "Cacat tenun", condition: "DEFECTIVE" }] },
      userId,
    );
    expect(Number(ubah.totalValue)).toBe(135_000);
  });

  it("diproses: stok baris NULL turun 5 m (tanpa kembaran \"\"), gerakan keluar 225.000; lalu bisa diselesaikan", async () => {
    const ret = await buatRetur([{ type: "FABRIC", itemId: linenId, qty: 5, reason: "Cacat tenun", condition: "DEFECTIVE" }]);
    expect(await processReturn(ret.id)).toEqual({ ok: true, id: ret.id, docNumber: ret.docNumber });

    const stok = await barisStok();
    expect(stok).toHaveLength(1);
    expect(stok[0].variantSku).toBeNull();
    expect(Number(stok[0].qtyOnHand)).toBeCloseTo(27.8, 6);
    expect(Number(stok[0].totalValue)).toBeCloseTo(27.8 * HARGA, 2);
    expect(Number(stok[0].avgCost)).toBeCloseTo(HARGA, 2);

    const gerak = await prisma.stockLedgerEntry.findMany({
      where: { refType: "VendorReturn", refId: seededId(ret.id) },
      select: { qty: true, totalCost: true, balanceQty: true, balanceValue: true },
    });
    expect(gerak).toHaveLength(1);
    expect(Number(gerak[0].qty)).toBe(-5);
    expect(Number(gerak[0].totalCost)).toBe(5 * HARGA);
    expect(Number(gerak[0].balanceQty)).toBeCloseTo(27.8, 6);
    expect(Number(gerak[0].balanceValue)).toBeCloseTo(27.8 * HARGA, 2);

    expect(await completeReturn(ret.id, undefined, BUKTI)).toEqual({ ok: true });
    expect((await prisma.vendorReturn.findUniqueOrThrow({ where: { id: seededId(ret.id) }, select: { status: true } })).status).toBe("COMPLETED");
  });

  it("draf lama bernilai 0 (dibuat sebelum perbaikan) diproses: gerakan mencatat nilai yang benar-benar keluar", async () => {
    const lama = await prisma.vendorReturn.create({
      data: {
        docNumber: `RET-RN-${token}-LAMA`,
        vendorId: supplierId,
        lines: JSON.stringify([{ type: "FABRIC", itemId: linenId, qty: 5, costValue: 0, reason: "Cacat tenun", condition: "DEFECTIVE" }]),
        totalItems: 1,
        totalValue: 0,
        createdById: userId,
      },
      select: { id: true, docNumber: true },
    });
    returIds.push(lama.id);
    expect(await processReturn(lama.id)).toEqual({ ok: true, id: lama.id, docNumber: lama.docNumber });
    const gerak = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { refType: "VendorReturn", refId: seededId(lama.id) },
      select: { totalCost: true, balanceValue: true },
    });
    expect(Number(gerak.totalCost)).toBe(5 * HARGA);
    // Saldo sebelum − keluar = saldo sesudah: kartu stok dan jurnal (yang membaca `totalCost`) sama.
    expect(Number(gerak.balanceValue)).toBeCloseTo(STOK_AWAL * HARGA - 225_000, 2);
  });

  it("stok baris NULL kurang → STOK_KURANG menyebut stok yang SEBENARNYA ada", async () => {
    const ret = await buatRetur([{ type: "FABRIC", itemId: linenId, qty: 5, reason: "Cacat tenun", condition: "DEFECTIVE" }]);
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(linenId) }, data: { qtyOnHand: 3, totalValue: 3 * HARGA } });
    expect(await processReturn(ret.id)).toEqual({ ok: false, code: "STOK_KURANG", barang: "Linen uji", perlu: 5, ada: 3 });
    expect(Number((await barisStok())[0].qtyOnHand)).toBe(3);
  });

  it("barang tanpa baris stok sama sekali tetap STOK_KURANG ada 0 (tidak membuat baris)", async () => {
    const ret = await buatRetur([{ type: "ACCESSORIES", itemId: kancingId, qty: 2, reason: "Rusak", condition: "DAMAGED" }]);
    expect(Number(ret.totalValue)).toBe(0);
    expect(await processReturn(ret.id)).toEqual({ ok: false, code: "STOK_KURANG", barang: "Kancing uji", perlu: 2, ada: 0 });
    expect(await prisma.inventoryValue.count({ where: { itemId: seededId(kancingId) } })).toBe(0);
  });
});
