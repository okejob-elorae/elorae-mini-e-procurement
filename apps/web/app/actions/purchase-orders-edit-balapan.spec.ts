import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Edit PO vs Tutup PO / batal / GRN — basis data uji nyata, sesi ditiru.
 *
 * Dulu `updatePO` membaca status DI LUAR transaksi lalu menulis di
 * `$transaction` biasa: edit yang membaca PARTIAL lalu kalah cepat dari
 * "Tutup PO" atau pembatalan menulis ulang baris dan total PO yang sudah
 * ditutup/batal. Sekarang baca status + tulis satu `runSerializable` dengan
 * penjaga status; yang kalah diulang dan melihat keadaan baru. Penolakan
 * dikembalikan sebagai `{ ok:false, code }`, bukan dilempar.
 */

const sesi = vi.hoisted(() => ({ id: "", izin: ["*"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.izin } })),
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
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => {}) }));

/*
 * Pembacaan PO (`purchaseOrder.findUnique`, di dalam maupun di luar transaksi)
 * bisa ditahan per urutan panggilan: `antrean[i]` = jeda (ms) untuk panggilan
 * ke-i. `sesudahBaca` dilepas saat panggilan yang DITAHAN terjadi.
 */
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
          if (ms > 0) {
            for (const beri of tunda.sesudahBaca.splice(0)) beri();
            await new Promise((r) => setTimeout(r, ms));
          }
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

/** `pertama` tertahan di pembacaan PO yang ditandai `antrean`; `kedua` berjalan dan commit selama itu. */
async function balapan<A, B>(antrean: number[], pertama: () => Promise<A>, kedua: () => Promise<B>) {
  tunda.antrean = [...antrean];
  const sudahBaca = new Promise<void>((beri) => tunda.sesudahBaca.push(beri));
  const p1 = pertama();
  await Promise.race([sudahBaca, p1.then(() => {}, () => {})]);
  const p2 = kedua();
  try {
    return (await Promise.allSettled([p1, p2])) as [PromiseSettledResult<A>, PromiseSettledResult<B>];
  } finally {
    tunda.antrean = [];
    tunda.sesudahBaca = [];
  }
}

const { updatePO, batalkanPO } = await import("./purchase-orders");
const { createGRN } = await import("./grn");
const { tutupPurchaseOrder } = await import("@/lib/purchase-orders/tutup");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("edit PO vs Tutup PO / batal / GRN (test bed only)", () => {
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
    userId = (
      await prisma.user.create({ data: { email: `edit-po-${token}@uji.local`, name: "Pembeli uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TEP-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-EP-${token}`, name: "Pemasok uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `E${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `EP-UJI-${token}`, nameId: "Benang uji", nameEn: "Test thread", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    sesi.id = userId;
    sesi.izin = ["*"];
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

  /** PO terkirim: 10 pcs × Rp1.000 (tanpa PPN). */
  async function buatPo() {
    urut += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-EP-${token}-${urut}`,
        supplierId,
        status: "SUBMITTED",
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

  const terima = (poId: string, qty: number) =>
    createGRN({ poId, supplierId, items: [{ itemId, qty, unitCost: 1_000 }] });

  /** Edit: qty 10 → 12 (Rp12.000), PIN karena PO sudah terkirim. */
  const edit = (poId: string, qty = 12) =>
    updatePO(poId, { supplierId, items: [{ itemId, variantSku: undefined, qty, price: 1_000, ppnIncluded: true, uomId }] }, undefined, "123456");

  async function keadaan(poId: string) {
    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: seededId(poId) },
      select: {
        status: true,
        closedAt: true,
        grandTotal: true,
        items: { select: { qty: true, receivedQty: true } },
        statusHistory: { select: { notes: true } },
      },
    });
    return {
      status: po.status,
      ditutupManual: po.closedAt != null,
      grandTotal: Number(po.grandTotal),
      dipesan: po.items.map((i) => Number(i.qty)),
      diterima: po.items.map((i) => Number(i.receivedQty)),
      riwayatEdit: po.statusHistory.filter((h) => h.notes === "PO Edited (PIN verified)").length,
    };
  }

  it("tanpa balapan: edit PO PARTIAL (PIN) menulis qty baru, qty diterima tetap, satu riwayat edit", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    expect(await edit(poId)).toEqual({ ok: true, id: poId });
    expect(await keadaan(poId)).toEqual({
      status: "PARTIAL",
      ditutupManual: false,
      grandTotal: 12_000,
      dipesan: [12],
      diterima: [4],
      riwayatEdit: 1,
    });
  });

  it("PO yang sudah ditutup → edit ditolak PO_TERTUTUP, tidak ada yang berubah", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    expect((await tutupPurchaseOrder({ poId, userId, alasan: "uji" })).ok).toBe(true);
    expect(await edit(poId)).toEqual({ ok: false, code: "PO_TERTUTUP" });
    expect(await keadaan(poId)).toMatchObject({ status: "CLOSED", grandTotal: 10_000, dipesan: [10], riwayatEdit: 0 });
  });

  it("balapan: edit membaca PO PARTIAL lalu tertahan, Tutup PO commit duluan → edit ditolak, PO ditutup tidak ditulis ulang", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    const [hasilEdit, tutup] = await balapan(
      [TAHAN_MS],
      () => edit(poId),
      () => tutupPurchaseOrder({ poId, userId, alasan: "tutup duluan" }),
    );
    expect(tutup).toMatchObject({ status: "fulfilled", value: { ok: true, qtySisa: 6 } });
    expect(hasilEdit).toEqual({ status: "fulfilled", value: { ok: false, code: "PO_TERTUTUP" } });
    expect(await keadaan(poId)).toEqual({
      status: "CLOSED",
      ditutupManual: true,
      grandTotal: 10_000,
      dipesan: [10],
      diterima: [4],
      riwayatEdit: 0,
    });
  });

  it("balapan di dalam transaksi: edit tertahan sesudah membaca PO, Tutup PO commit → edit konflik, diulang, ditolak", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    // Panggilan ke-1 = baca awal untuk keputusan PIN; ke-2 = baca DI DALAM transaksi edit.
    const [hasilEdit, tutup] = await balapan(
      [0, TAHAN_MS],
      () => edit(poId),
      () => tutupPurchaseOrder({ poId, userId, alasan: "tutup di tengah edit" }),
    );
    expect(tutup).toMatchObject({ status: "fulfilled", value: { ok: true, qtySisa: 6 } });
    expect(hasilEdit).toEqual({ status: "fulfilled", value: { ok: false, code: "PO_TERTUTUP" } });
    expect(await keadaan(poId)).toMatchObject({ status: "CLOSED", grandTotal: 10_000, dipesan: [10], riwayatEdit: 0 });
  });

  it("balapan: edit tertahan, pembatalan commit duluan → edit ditolak, PO batal tidak ditulis ulang", async () => {
    const poId = await buatPo();
    const [hasilEdit, batal] = await balapan(
      [TAHAN_MS],
      () => edit(poId),
      () => batalkanPO(poId, "batal duluan", "123456"),
    );
    expect(batal).toEqual({ status: "fulfilled", value: { ok: true } });
    expect(hasilEdit).toEqual({ status: "fulfilled", value: { ok: false, code: "PO_TERTUTUP" } });
    expect(await keadaan(poId)).toMatchObject({ status: "CANCELLED", grandTotal: 10_000, dipesan: [10], riwayatEdit: 0 });
  });

  it("balapan di dalam transaksi: edit tertahan, GRN 4 pcs commit → edit diulang dan qty diterima 4 tidak hilang", async () => {
    const poId = await buatPo();
    const [hasilEdit, grn] = await balapan([0, TAHAN_MS], () => edit(poId), () => terima(poId, 4));
    expect(grn.status).toBe("fulfilled");
    expect(hasilEdit).toEqual({ status: "fulfilled", value: { ok: true, id: poId } });
    expect(await keadaan(poId)).toEqual({
      status: "PARTIAL",
      ditutupManual: false,
      grandTotal: 12_000,
      dipesan: [12],
      diterima: [4],
      riwayatEdit: 1,
    });
  });
});
