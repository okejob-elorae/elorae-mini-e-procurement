import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Pembatalan PO vs penerimaan (GRN) — sesi ditiru, basis data uji nyata.
 *
 * Dulu pembatalan memeriksa "belum ada GRN" di LUAR transaksi lalu menulis
 * CANCELLED terpisah: batal memeriksa → GRN commit → batal menulis, hasilnya PO
 * batal yang punya GRN (stok sudah masuk, hutang terjurnal). Sekarang
 * pemeriksaan dan penulisan satu `runSerializable`; yang kalah diulang dan
 * melihat GRN-nya.
 *
 * Juga: penolakan berkode sampai ke layar sebagai `{ ok:false, code }` —
 * `simpanGRN` (formulir GRN) dan `batalkanPO`.
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
const pin = vi.hoisted(() => ({ sah: true }));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async () => (pin.sah ? { success: true } : { success: false, messageKey: "pinInvalid" })),
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

const { createGRN, simpanGRN } = await import("./grn");
const { changePOStatus, cancelPO, batalkanPO } = await import("./purchase-orders");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("pembatalan PO vs GRN (test bed only)", () => {
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
      await prisma.user.create({ data: { email: `batal-po-${token}@uji.local`, name: "Pembeli uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TBP-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-BP-${token}`, name: "Pemasok uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `B${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `BP-UJI-${token}`, nameId: "Resleting uji", nameEn: "Test zipper", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  async function buatPo(status: "DRAFT" | "SUBMITTED" | "CANCELLED") {
    urut += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-BP-${token}-${urut}`,
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
    sesi.izin = ["*"];
    pin.sah = true;
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
      select: {
        status: true,
        items: { select: { receivedQty: true } },
        grns: { select: { id: true } },
        statusHistory: { select: { status: true } },
      },
    });
    const stok = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) }, select: { qtyOnHand: true } });
    return {
      status: po.status,
      diterima: po.items.map((i) => Number(i.receivedQty)),
      grn: po.grns.length,
      stok: stok.map((s) => Number(s.qtyOnHand)),
      riwayatBatal: po.statusHistory.filter((h) => h.status === "CANCELLED").length,
    };
  }

  describe("balapan batal vs GRN", () => {
    it("changePOStatus: batal membaca PO lalu tertahan, GRN 4 pcs commit duluan → batal ditolak, PO PARTIAL dengan GRN dan stok 4", async () => {
      poId = await buatPo("SUBMITTED");
      const [batal, grn] = await balapan(
        () => changePOStatus(poId, "CANCELLED", userId, "uji balapan", "123456"),
        () => terima(poId),
      );
      expect(grn.status).toBe("fulfilled");
      expect(batal.status).toBe("rejected");
      expect((batal as PromiseRejectedResult).reason).toMatchObject({ code: "SUDAH_ADA_PENERIMAAN" });
      expect(await keadaan(poId)).toEqual({ status: "PARTIAL", diterima: [4], grn: 1, stok: [4], riwayatBatal: 0 });
    });

    it("cancelPO (daftar PO): balapan yang sama → batal ditolak, PO PARTIAL dengan GRN", async () => {
      poId = await buatPo("SUBMITTED");
      const [batal, grn] = await balapan(
        () => cancelPO(poId, userId, "uji balapan", "123456"),
        () => terima(poId),
      );
      expect(grn.status).toBe("fulfilled");
      expect(batal.status).toBe("rejected");
      expect((batal as PromiseRejectedResult).reason).toMatchObject({ code: "SUDAH_ADA_PENERIMAAN" });
      expect(await keadaan(poId)).toEqual({ status: "PARTIAL", diterima: [4], grn: 1, stok: [4], riwayatBatal: 0 });
    });

    it("batalkanPO: balapan yang sama → { ok:false, SUDAH_ADA_PENERIMAAN }, PO PARTIAL dengan GRN", async () => {
      poId = await buatPo("SUBMITTED");
      const [batal, grn] = await balapan(() => batalkanPO(poId, "uji balapan", "123456"), () => terima(poId));
      expect(grn.status).toBe("fulfilled");
      expect(batal).toEqual({ status: "fulfilled", value: { ok: false, code: "SUDAH_ADA_PENERIMAAN" } });
      expect(await keadaan(poId)).toEqual({ status: "PARTIAL", diterima: [4], grn: 1, stok: [4], riwayatBatal: 0 });
    });
  });

  describe("balapan kirim vs batal", () => {
    it("kirim membaca PO DRAFT lalu tertahan, batal commit duluan → kirim ditolak, PO tetap batal", async () => {
      poId = await buatPo("DRAFT");
      const [kirim, batal] = await balapan(
        () => changePOStatus(poId, "SUBMITTED", userId, "kirim"),
        () => batalkanPO(poId, "batal duluan", "123456"),
      );
      expect(batal).toEqual({ status: "fulfilled", value: { ok: true } });
      expect(kirim.status).toBe("rejected");
      expect(String((kirim as PromiseRejectedResult).reason)).toMatch(/draf/i);
      const po = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: seededId(poId) },
        select: { status: true, statusHistory: { select: { status: true } } },
      });
      expect({ status: po.status, riwayat: po.statusHistory.map((h) => h.status) }).toEqual({
        status: "CANCELLED",
        riwayat: ["CANCELLED"],
      });
    });
  });

  describe("balapan batal vs batal", () => {
    it("dua pembatalan serentak → satu berhasil, satu SUDAH_DIBATALKAN, hanya SATU riwayat CANCELLED", async () => {
      poId = await buatPo("SUBMITTED");
      const [pertama, kedua] = await balapan(
        () => batalkanPO(poId, "batal pertama", "123456"),
        () => batalkanPO(poId, "batal kedua", "123456"),
      );
      expect(kedua).toEqual({ status: "fulfilled", value: { ok: true } });
      expect(pertama).toEqual({ status: "fulfilled", value: { ok: false, code: "SUDAH_DIBATALKAN" } });
      const riwayat = await prisma.pOStatusHistory.findMany({
        where: { poId: seededId(poId), status: "CANCELLED" },
        select: { notes: true },
      });
      expect(riwayat).toEqual([{ notes: "batal kedua" }]);
      expect((await keadaan(poId)).status).toBe("CANCELLED");
    });
  });

  describe("batalkanPO mengembalikan kode", () => {
    it("PO terkirim tanpa penerimaan → batal, satu riwayat CANCELLED atas nama sesi", async () => {
      poId = await buatPo("SUBMITTED");
      expect(await batalkanPO(poId, "salah pemasok", "123456")).toEqual({ ok: true });
      expect(await keadaan(poId)).toEqual({ status: "CANCELLED", diterima: [0], grn: 0, stok: [], riwayatBatal: 1 });
      const riwayat = await prisma.pOStatusHistory.findMany({
        where: { poId: seededId(poId), status: "CANCELLED" },
        select: { changedById: true, notes: true },
      });
      expect(riwayat).toEqual([{ changedById: userId, notes: "salah pemasok" }]);
    });

    it("PO yang sudah punya GRN → SUDAH_ADA_PENERIMAAN, tidak ada yang berubah", async () => {
      poId = await buatPo("SUBMITTED");
      await terima(poId, 10);
      expect(await batalkanPO(poId, "telat", "123456")).toEqual({ ok: false, code: "SUDAH_ADA_PENERIMAAN" });
      expect(await keadaan(poId)).toEqual({ status: "CLOSED", diterima: [10], grn: 1, stok: [10], riwayatBatal: 0 });
    });

    it("PO yang sudah batal → SUDAH_DIBATALKAN, tanpa riwayat kedua", async () => {
      poId = await buatPo("CANCELLED");
      expect(await batalkanPO(poId, "lagi", "123456")).toEqual({ ok: false, code: "SUDAH_DIBATALKAN" });
      expect((await keadaan(poId)).riwayatBatal).toBe(0);
    });

    it("PO tidak ada → TIDAK_DITEMUKAN; PIN kosong → PIN_WAJIB; PIN salah → PIN_DITOLAK + kunci pesan", async () => {
      expect(await batalkanPO("po-tidak-ada", "x", "123456")).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
      poId = await buatPo("SUBMITTED");
      expect(await batalkanPO(poId, "x", "")).toEqual({ ok: false, code: "PIN_WAJIB" });
      pin.sah = false;
      expect(await batalkanPO(poId, "x", "000000")).toEqual({ ok: false, code: "PIN_DITOLAK", kunciPesan: "pinInvalid" });
      expect((await keadaan(poId)).status).toBe("SUBMITTED");
    });

    it("tanpa purchase_orders:edit → TANPA_AKSES, PO tidak berubah", async () => {
      poId = await buatPo("SUBMITTED");
      sesi.izin = ["purchase_orders:view"];
      expect(await batalkanPO(poId, "x", "123456")).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect((await keadaan(poId)).status).toBe("SUBMITTED");
    });

    it("changePOStatus tetap melempar pesan yang bisa dibaca untuk layar lama", async () => {
      poId = await buatPo("SUBMITTED");
      await terima(poId);
      await expect(changePOStatus(poId, "CANCELLED", userId, "x", "123456")).rejects.toThrow(/sudah ada barang yang diterima/i);
    });
  });

  describe("simpanGRN (formulir GRN) mengembalikan kode, tidak melempar", () => {
    it("PO batal → { ok:false, PO_DIBATALKAN }, stok tidak bergerak", async () => {
      poId = await buatPo("CANCELLED");
      expect(await simpanGRN({ poId, supplierId, items: [{ itemId, qty: 4, unitCost: 1_000 }] })).toEqual({
        ok: false,
        code: "PO_DIBATALKAN",
      });
      expect(await keadaan(poId)).toEqual({ status: "CANCELLED", diterima: [0], grn: 0, stok: [], riwayatBatal: 0 });
    });

    it("PO draf → { ok:false, PO_BELUM_DISETUJUI }", async () => {
      poId = await buatPo("DRAFT");
      expect(await simpanGRN({ poId, supplierId, items: [{ itemId, qty: 4, unitCost: 1_000 }] })).toEqual({
        ok: false,
        code: "PO_BELUM_DISETUJUI",
      });
    });

    it("PO terkirim → { ok:true, id, docNumber }, 4 pcs masuk", async () => {
      poId = await buatPo("SUBMITTED");
      const hasil = await simpanGRN({ poId, supplierId, items: [{ itemId, qty: 4, unitCost: 1_000 }] });
      expect(hasil).toEqual({ ok: true, id: expect.any(String), docNumber: expect.stringMatching(/^GRN\//) });
      expect(await keadaan(poId)).toEqual({ status: "PARTIAL", diterima: [4], grn: 1, stok: [4], riwayatBatal: 0 });
    });
  });
});
