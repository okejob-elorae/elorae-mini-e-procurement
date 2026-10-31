import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * "Tutup PO" benar-benar menutup: GRN berikutnya ke PO yang ditutup sebelum
 * lengkap (status CLOSED + `closedAt` terisi) ditolak `PO_DITUTUP` — basis data
 * uji nyata, `createGRN` sungguhan, sesi ditiru.
 *
 * Dulu `createGRN` hanya menolak CANCELLED/DRAFT: GRN sesudah penutupan menambah
 * stok, menghitung ulang status jadi PARTIAL (PO "terbuka" lagi dengan
 * `closedAt` tetap terisi), dan utang ke pemasok membengkak lagi.
 *
 * PO yang CLOSED karena LENGKAP lewat GRN (`closedAt` kosong) tetap boleh
 * menerima terima-lebih yang sah — sama seperti PO berstatus OVER.
 */

const sesi = vi.hoisted(() => ({ id: "", izin: ["*"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.izin } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: async () => "Penguji" }));
vi.mock("@/lib/notifications/events", () => ({
  notifyGRNCreated: async () => {},
  notifyMaterialArrivedForPo: async () => {},
  notifyPOCreated: async () => {},
  notifyPOStatusUpdated: async () => {},
  notifyPOPaymentToggled: async () => {},
}));
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(async () => ({ ok: true })),
  postGrnReversalJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => {}) }));

/* Pembacaan PO pertama (`purchaseOrder.findUnique`, di dalam maupun di luar transaksi) bisa ditahan. */
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

/** `pertama` membaca PO lalu tertahan; `kedua` berjalan dan commit selama itu. */
async function balapan<A, B>(pertama: () => Promise<A>, kedua: () => Promise<B>) {
  tunda.antrean = [TAHAN_MS];
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

const { createGRN, simpanGRN } = await import("./grn");
const { tutupPurchaseOrder } = await import("@/lib/purchase-orders/tutup");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("GRN ke PO yang ditutup (test bed only)", () => {
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
      await prisma.user.create({ data: { email: `grn-tutup-${token}@uji.local`, name: "Gudang uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TGT-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-GT-${token}`, name: "Pemasok uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `G${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })).id;
    // Ambang terima-lebih 5 pcs: kelebihan sampai 5 tidak butuh persetujuan pemilik.
    itemId = (
      await prisma.item.create({
        data: {
          sku: `GT-UJI-${token}`,
          nameId: "Kancing uji",
          nameEn: "Test button",
          type: "ACCESSORIES",
          uomId,
          overReceiveThreshold: 5,
        },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    sesi.id = userId;
    sesi.izin = ["*"];
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
  });

  afterAll(async () => {
    const grnIds = (
      await prisma.gRN.findMany({ where: { supplierId: seededId(supplierId) }, select: { id: true } })
    ).map((g) => g.id);
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
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

  /** PO terkirim: 10 pcs × Rp1.000. */
  async function buatPo() {
    urut += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-GT-${token}-${urut}`,
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

  async function keadaan(poId: string) {
    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: seededId(poId) },
      select: { status: true, closedAt: true, items: { select: { receivedQty: true } }, grns: { select: { id: true } } },
    });
    const stok = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) }, select: { qtyOnHand: true } });
    return {
      status: po.status,
      ditutupManual: po.closedAt != null,
      diterima: po.items.map((i) => Number(i.receivedQty)),
      grn: po.grns.length,
      stok: stok.map((s) => Number(s.qtyOnHand)),
    };
  }

  it("PO ditutup lewat Tutup PO → GRN berikutnya ditolak PO_DITUTUP; stok, qty diterima dan status tidak berubah", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    const tutup = await tutupPurchaseOrder({ poId, userId, alasan: "pemasok tidak sanggup kirim sisa" });
    expect(tutup).toMatchObject({ ok: true, qtySisa: 6 });
    const sebelum = await keadaan(poId);
    expect(sebelum).toEqual({ status: "CLOSED", ditutupManual: true, diterima: [4], grn: 1, stok: [4] });

    await expect(terima(poId, 3)).rejects.toMatchObject({ code: "PO_DITUTUP" });
    expect(await simpanGRN({ poId, supplierId, items: [{ itemId, qty: 3, unitCost: 1_000 }] })).toEqual({
      ok: false,
      code: "PO_DITUTUP",
    });
    expect(await keadaan(poId)).toEqual(sebelum);
  });

  it("pesan lemparan createGRN untuk PO ditutup bisa dibaca (layar lama)", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    expect((await tutupPurchaseOrder({ poId, userId, alasan: "uji pesan" })).ok).toBe(true);
    await expect(terima(poId, 1)).rejects.toThrow(/sudah ditutup/i);
  });

  it("PO PARTIAL → GRN diterima: qty diterima 4 + 3 = 7, stok 7, status tetap PARTIAL", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    expect((await keadaan(poId)).status).toBe("PARTIAL");
    const hasil = await simpanGRN({ poId, supplierId, items: [{ itemId, qty: 3, unitCost: 1_000 }] });
    expect(hasil).toMatchObject({ ok: true });
    expect(await keadaan(poId)).toEqual({ status: "PARTIAL", ditutupManual: false, diterima: [7], grn: 2, stok: [7] });
  });

  it("PO lengkap lewat GRN (CLOSED, closedAt kosong) tetap menerima terima-lebih dalam ambang → OVER", async () => {
    const poId = await buatPo();
    await terima(poId, 10);
    expect(await keadaan(poId)).toEqual({ status: "CLOSED", ditutupManual: false, diterima: [10], grn: 1, stok: [10] });
    await terima(poId, 2);
    expect(await keadaan(poId)).toEqual({ status: "OVER", ditutupManual: false, diterima: [12], grn: 2, stok: [12] });
  });

  it("PO CLOSED lama tanpa closedAt tetapi barang belum lengkap (ditutup lewat jalur lama) → GRN ditolak PO_DITUTUP", async () => {
    // Sebelum `closedAt` ada, "tutup" lewat changePOStatus hanya menulis status CLOSED.
    urut += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-GT-${token}-${urut}`,
        supplierId,
        status: "CLOSED",
        totalAmount: 10_000,
        grandTotal: 10_000,
        createdById: userId,
        items: { create: [{ itemId, qty: 10, receivedQty: 4, price: 1_000, uomId }] },
      },
      select: { id: true },
    });
    poIds.push(po.id);
    const sebelum = await keadaan(po.id);
    expect(sebelum).toEqual({ status: "CLOSED", ditutupManual: false, diterima: [4], grn: 0, stok: [] });

    await expect(terima(po.id, 3)).rejects.toMatchObject({ code: "PO_DITUTUP" });
    expect(await keadaan(po.id)).toEqual(sebelum);
  });

  it("balapan: GRN membaca PO PARTIAL lalu tertahan, Tutup PO commit duluan → GRN diulang dan ditolak PO_DITUTUP", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    const [grn, tutup] = await balapan(
      () => terima(poId, 3),
      () => tutupPurchaseOrder({ poId, userId, alasan: "balapan tutup duluan" }),
    );
    expect(tutup).toMatchObject({ status: "fulfilled", value: { ok: true, qtySisa: 6 } });
    expect(grn.status).toBe("rejected");
    expect((grn as PromiseRejectedResult).reason).toMatchObject({ code: "PO_DITUTUP" });
    // Sisa 6 yang dicatat penutupan + 4 yang benar-benar diterima = 10 dipesan.
    expect(await keadaan(poId)).toEqual({ status: "CLOSED", ditutupManual: true, diterima: [4], grn: 1, stok: [4] });
  });

  it("balapan: Tutup PO membaca PO lalu tertahan, GRN 3 pcs commit duluan → penutupan diulang dengan sisa 3", async () => {
    const poId = await buatPo();
    await terima(poId, 4);
    const [tutup, grn] = await balapan(
      () => tutupPurchaseOrder({ poId, userId, alasan: "balapan GRN duluan" }),
      () => terima(poId, 3),
    );
    expect(grn.status).toBe("fulfilled");
    expect(tutup).toMatchObject({ status: "fulfilled", value: { ok: true, qtySisa: 3 } });
    expect(await keadaan(poId)).toEqual({ status: "CLOSED", ditutupManual: true, diterima: [7], grn: 2, stok: [7] });
  });
});
