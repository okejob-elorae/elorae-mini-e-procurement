import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * `completeReturn` (PROCESSED → COMPLETED) kini juga mengurangi utang PO:
 * retur yang terkait GRN sebuah PO dari pemasok yang sama mendapat `poId` +
 * `poCreditAmount` (harga beli di PO) di transaksi yang sama dengan statusnya.
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

const { completeReturn } = await import("./vendor-returns");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("completeReturn mengurangi utang PO (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let itemId = "";
  let poId = "";
  let grnId = "";
  let returIds: string[] = [];
  let urut = 0;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `retur-po-${token}@uji.local` }, select: { id: true } })).id;
    typeId = (
      await prisma.supplierType.create({ data: { code: `TRP-${token}`, name: `Jenis ${token}` }, select: { id: true } })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-RP-${token}`, name: "Pemasok uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({ data: { code: `Q${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })
    ).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `RP-KANCING-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    poId = (
      await prisma.purchaseOrder.create({
        data: {
          docNumber: `PO-RP-${token}`,
          supplierId,
          status: "CLOSED",
          totalAmount: 1_000_000,
          grandTotal: 1_000_000,
          ppnRatePercent: 11,
          createdById: userId,
          items: { create: [{ itemId, qty: 20, price: 50_000, ppnIncluded: true, receivedQty: 20, uomId }] },
        },
        select: { id: true },
      })
    ).id;
    grnId = (
      await prisma.gRN.create({
        data: { docNumber: `GRN-RP-${token}`, poId, supplierId, receivedBy: userId, totalAmount: 1_000_000, items: "[]" },
        select: { id: true },
      })
    ).id;
    sesi.id = userId;
    sesi.permissions = ["vendor_returns:view", "vendor_returns:manage"];
  });

  beforeEach(() => {
    returIds = [];
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "VendorReturn", entityId: { in: seededIds(returIds) } } });
    await prisma.vendorReturn.deleteMany({ where: { id: { in: seededIds(returIds) } } });
  });

  afterAll(async () => {
    await prisma.gRN.deleteMany({ where: { id: seededId(grnId) } });
    await prisma.pOItem.deleteMany({ where: { poId: seededId(poId) } });
    await prisma.purchaseOrder.deleteMany({ where: { id: seededId(poId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("retur 2 × 50.000 selesai → retur mencatat PO dan kredit 100.000", async () => {
    urut += 1;
    const ret = await prisma.vendorReturn.create({
      data: {
        docNumber: `RET-RP-${token}-${urut}`,
        vendorId: supplierId,
        grnId,
        lines: JSON.stringify([{ type: "ACCESSORIES", itemId, qty: 2, costValue: 80_000 }]),
        totalItems: 1,
        totalValue: 80_000,
        status: "PROCESSED",
        createdById: userId,
      },
      select: { id: true },
    });
    returIds.push(ret.id);

    await completeReturn(ret.id, undefined, { trackingNumber: "RESI-1", receiptFileUrl: "https://contoh.local/resi.jpg" });

    const baris = await prisma.vendorReturn.findUniqueOrThrow({
      where: { id: seededId(ret.id) },
      select: { status: true, poId: true, poCreditAmount: true },
    });
    expect(baris.status).toBe("COMPLETED");
    expect(baris.poId).toBe(poId);
    expect(Number(baris.poCreditAmount)).toBe(100_000);
    expect(
      await prisma.auditLog.count({
        where: { entityType: "VendorReturn", entityId: seededId(ret.id), action: "VENDOR_RETURN_PO_CREDIT" },
      }),
    ).toBe(1);
  });
});
