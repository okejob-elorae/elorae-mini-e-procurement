import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * GRN ke PO yang DIBATALKAN (sesi ditiru, basis data uji nyata).
 *
 * Dulu `createGRN` tidak memeriksa status PO sama sekali: barang bisa diterima
 * ke PO batal (stok naik, hutang terjurnal) dan status PO ditimpa kembali ke
 * PARTIAL/CLOSED. Sekarang status PO dibaca di dalam `runSerializable` sebelum
 * stok disentuh, dan baris PO selalu ditulis transaksi GRN — pembatalan yang
 * commit di tengah GRN membuat GRN konflik, diulang, lalu ditolak.
 */

const sesi = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: ["*"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji",
  notifyGRNCreated: async () => {},
  notifyMaterialArrivedForPo: async () => {},
  notifyPOCreated: async () => {},
  notifyPOStatusUpdated: async () => {},
  notifyPOPaymentToggled: async () => {},
}));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(async () => ({ ok: true })),
  postGrnReversalJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/* Pembacaan PO pertama (`purchaseOrder.findUnique`) bisa disuruh diam sesudah membaca. */
const tunda = vi.hoisted(() => ({ antrean: [] as number[], sesudahBaca: [] as Array<() => void> }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  type Fungsi = (...args: unknown[]) => unknown;
  const ikat = (t: object, v: unknown) => (typeof v === "function" ? (v as Fungsi).bind(t) : v);
  const bungkusPo = (delegasi: object) =>
    new Proxy(delegasi, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p !== "findUnique" || typeof v !== "function") return ikat(t, v);
        return async (...args: unknown[]) => {
          const hasil = await (v as Fungsi).apply(t, args);
          const ms = tunda.antrean.shift() ?? 0;
          for (const beri of tunda.sesudahBaca.splice(0)) beri();
          if (ms > 0) await new Promise((r) => setTimeout(r, ms));
          return hasil;
        };
      },
    });
  const bungkusTx = (tx: object) =>
    new Proxy(tx, {
      get(t, p) {
        const v = Reflect.get(t, p);
        return p === "purchaseOrder" && v && typeof v === "object" ? bungkusPo(v) : ikat(t, v);
      },
    });
  const prisma = new Proxy(asli.prisma, {
    get(t, p) {
      const v = Reflect.get(t, p);
      if (p === "purchaseOrder" && v && typeof v === "object") return bungkusPo(v);
      if (p !== "$transaction" || typeof v !== "function") return v;
      return (arg: unknown, opsi?: unknown) =>
        typeof arg === "function"
          ? (v as Fungsi)((tx: object) => (arg as Fungsi)(bungkusTx(tx)), opsi)
          : (v as Fungsi)(arg, opsi);
    },
  });
  return { ...asli, prisma };
});

const TAHAN_MS = 800;

async function balapan(pertama: () => Promise<unknown>, kedua: () => Promise<unknown>) {
  tunda.antrean = [TAHAN_MS];
  const sudahBaca = new Promise<void>((beri) => tunda.sesudahBaca.push(beri));
  const p1 = pertama();
  await Promise.race([sudahBaca, p1.then(() => {}, () => {})]);
  const p2 = kedua();
  try {
    return await Promise.allSettled([p1, p2]);
  } finally {
    tunda.antrean = [];
    tunda.sesudahBaca = [];
  }
}

const { createGRN } = await import("./grn");
const { changePOStatus } = await import("./purchase-orders");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("GRN dan status PO (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let itemId = "";
  let poId = "";
  let urut = 0;
  const poIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    supplierId = "";
    uomId = "";
    itemId = "";
    userId = (
      await prisma.user.create({ data: { email: `grn-po-${token}@uji.local`, name: "Gudang uji" }, select: { id: true } })
    ).id;
    sesi.id = userId;
    typeId = (await prisma.supplierType.create({ data: { code: `TPB-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-PB-${token}`, name: "Pemasok uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `P${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `PB-UJI-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  async function buatPo(status: "DRAFT" | "SUBMITTED" | "CANCELLED") {
    urut += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-PB-${token}-${urut}`,
        supplierId,
        status,
        totalAmount: 10_000,
        grandTotal: 10_000,
        createdById: userId,
        items: { create: [{ itemId, qty: 10, price: 1_000, uomId }] },
      },
      select: { id: true },
    });
    poIds.push(po.id);
    return po.id;
  }

  beforeEach(async () => {
    poId = "";
    sesi.id = userId;
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
  });

  afterAll(async () => {
    const grnIds = (
      await prisma.gRN.findMany({ where: { supplierId: seededId(supplierId) }, select: { id: true } })
    ).map((g) => g.id);
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

  const terima = (id: string, qty = 4) =>
    createGRN({ poId: id, supplierId, items: [{ itemId, qty, unitCost: 1_000 }] }, userId);

  async function keadaan(id: string) {
    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: seededId(id) },
      select: { status: true, items: { select: { receivedQty: true } }, grns: { select: { id: true } } },
    });
    const stok = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) }, select: { qtyOnHand: true } });
    return {
      status: po.status,
      diterima: po.items.map((i) => Number(i.receivedQty)),
      grn: po.grns.length,
      stok: stok.map((s) => Number(s.qtyOnHand)),
    };
  }

  it("PO yang DIBATALKAN menolak GRN (PO_DIBATALKAN): stok, qty diterima, dan status PO tidak berubah", async () => {
    poId = await buatPo("CANCELLED");
    await expect(terima(poId)).rejects.toMatchObject({ code: "PO_DIBATALKAN" });
    expect(await keadaan(poId)).toEqual({ status: "CANCELLED", diterima: [0], grn: 0, stok: [] });
  });

  it("PO yang masih DRAFT (belum disetujui) menolak GRN (PO_BELUM_DISETUJUI)", async () => {
    poId = await buatPo("DRAFT");
    await expect(terima(poId)).rejects.toMatchObject({ code: "PO_BELUM_DISETUJUI" });
    expect(await keadaan(poId)).toEqual({ status: "DRAFT", diterima: [0], grn: 0, stok: [] });
  });

  it("PO yang sudah dikirim ke pemasok tetap bisa diterima: 4 dari 10 → PARTIAL, stok 4", async () => {
    poId = await buatPo("SUBMITTED");
    await terima(poId);
    expect(await keadaan(poId)).toEqual({ status: "PARTIAL", diterima: [4], grn: 1, stok: [4] });
  });

  it("balapan: GRN membaca PO lalu tertahan, pembatalan commit duluan → GRN ditolak, PO tetap batal", async () => {
    poId = await buatPo("SUBMITTED");
    const [grn, batal] = await balapan(
      () => terima(poId),
      () => changePOStatus(poId, "CANCELLED", userId, "uji balapan", "123456"),
    );
    expect(batal.status).toBe("fulfilled");
    expect(grn.status).toBe("rejected");
    expect((grn as PromiseRejectedResult).reason).toMatchObject({ code: "PO_DIBATALKAN" });
    expect(await keadaan(poId)).toEqual({ status: "CANCELLED", diterima: [0], grn: 0, stok: [] });
  });
});
