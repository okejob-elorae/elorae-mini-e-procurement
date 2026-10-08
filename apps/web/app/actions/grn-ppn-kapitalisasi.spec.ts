import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";

/*
 * PPN pembelian saat Elorae BUKAN PKP masuk harga perolehan — basis data uji
 * nyata, `createGRN` sungguhan, sesi dan pengaturan PPN ditiru.
 *
 * Baris PO "Exclude PPN" = pemasok menagih PPN di atas harga. Pembeli PKP
 * mengkreditkannya (`GRN.ppnAmount` → PPN masukan); pembeli bukan PKP tidak
 * bisa, jadi PPN-nya ikut nilai kartu stok (harga rata-rata) dan hutang bruto.
 * Dulu hilang dari keduanya.
 */

const sesi = vi.hoisted(() => ({ id: "", izin: ["*"] as string[] }));
const ppn = vi.hoisted(() => ({ nilai: null as unknown as PengaturanPpn }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.izin } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji",
  notifyGRNCreated: async () => {},
  notifyMaterialArrivedForPo: async () => {},
}));
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(async () => ({ ok: true })),
  postGrnReversalJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => {}) }));
vi.mock("@/lib/finance/pajak/ppn-pengaturan", () => ({ bacaPengaturanPpn: vi.fn(async () => ppn.nilai) }));

const { createGRN } = await import("./grn");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP", berlakuSejak: null };

d("PPN pembelian dikapitalisasi saat bukan PKP (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let itemId = "";
  let urut = 0;
  const poIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    supplierId = "";
    uomId = "";
    itemId = "";
    userId = (await prisma.user.create({ data: { email: `grn-ppn-${token}@uji.local`, name: "Gudang uji" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TGP-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    supplierId = (
      await prisma.supplier.create({ data: { code: `SUP-GP-${token}`, name: "Pemasok uji", typeId, status: "ACTIVE" }, select: { id: true } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `P${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `GP-UJI-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId, overReceiveThreshold: 50 },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    sesi.id = userId;
    ppn.nilai = NON_PKP;
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
  });

  afterAll(async () => {
    const grnIds = (await prisma.gRN.findMany({ where: { supplierId: seededId(supplierId) }, select: { id: true } })).map((g) => g.id);
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.gRN.deleteMany({ where: { id: { in: seededIds(grnIds) } } });
    await prisma.pOStatusHistory.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
    await prisma.pOItem.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  /** PO terkirim: 10 pcs × Rp1.000, tarif PPN 11%. */
  async function buatPo(ppnIncluded: boolean) {
    urut += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-GP-${token}-${urut}`,
        supplierId,
        status: "SUBMITTED",
        totalAmount: 10_000,
        taxAmount: ppnIncluded ? 0 : 1_100,
        grandTotal: ppnIncluded ? 10_000 : 11_100,
        ppnRatePercent: 11,
        createdById: userId,
        items: { create: [{ itemId, qty: 10, price: 1_000, uomId, ppnIncluded }] },
      },
      select: { id: true },
    });
    poIds.push(po.id);
    return po.id;
  }

  async function keadaan(grnId: string) {
    const grn = await prisma.gRN.findUniqueOrThrow({ where: { id: grnId }, select: { totalAmount: true, ppnAmount: true, items: true } });
    const stok = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) }, select: { avgCost: true, totalValue: true } });
    const gerak = await prisma.stockMovement.findMany({ where: { refId: grnId }, select: { totalCost: true } });
    const baris = JSON.parse(String(grn.items)) as Array<Record<string, unknown>>;
    return {
      total: Number(grn.totalAmount),
      ppnMasukan: grn.ppnAmount == null ? null : Number(grn.ppnAmount),
      hargaRata: stok.map((s) => Number(s.avgCost)),
      nilaiStok: stok.map((s) => Number(s.totalValue)),
      gerak: gerak.map((g) => Number(g.totalCost)),
      baris: baris.map((b) => ({ unitCost: b.unitCost, hargaPo: b.hargaPo, ppnDikapitalisasi: b.ppnDikapitalisasi })),
    };
  }

  it("bukan PKP, baris Exclude PPN → PPN masuk nilai stok, harga rata-rata, dan hutang (total GRN)", async () => {
    const poId = await buatPo(false);
    const g = await createGRN({ poId, supplierId, items: [{ itemId, qty: 10, unitCost: 1_000 }] });
    expect(await keadaan(g.id)).toEqual({
      total: 11_100,
      ppnMasukan: 0,
      hargaRata: [1_110],
      nilaiStok: [11_100],
      gerak: [11_100],
      baris: [{ unitCost: 1_110, hargaPo: 1_000, ppnDikapitalisasi: 1_100 }],
    });
  });

  it("PKP → PPN jadi PPN masukan, nilai stok tetap harga PO", async () => {
    ppn.nilai = PKP;
    const poId = await buatPo(false);
    const g = await createGRN({ poId, supplierId, items: [{ itemId, qty: 10, unitCost: 1_000 }] });
    expect(await keadaan(g.id)).toMatchObject({ total: 10_000, ppnMasukan: 1_100, hargaRata: [1_000], gerak: [10_000] });
  });

  it("baris Include PPN (bawaan) tidak dikapitalisasi lagi", async () => {
    const poId = await buatPo(true);
    const g = await createGRN({ poId, supplierId, items: [{ itemId, qty: 10, unitCost: 1_000 }] });
    expect(await keadaan(g.id)).toMatchObject({ total: 10_000, hargaRata: [1_000], gerak: [10_000], baris: [{ unitCost: 1_000 }] });
  });
});
