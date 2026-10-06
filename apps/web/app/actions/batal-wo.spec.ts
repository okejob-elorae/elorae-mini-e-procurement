import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Pembatalan perintah kerja vs pengeluaran bahan — sesi ditiru, basis data uji nyata.
 *
 * 1. `issueMaterials` dulu berjalan di `$transaction` read-committed dan menulis
 *    IN_PRODUCTION di akhir: pembatalan yang commit di tengahnya tertimpa (WO
 *    batal hidup lagi, stok bahan sudah keluar). Sekarang `runSerializable` +
 *    penjaga status; yang kalah diulang dan ditolak.
 * 2. WO yang sudah mengeluarkan bahan tidak bisa dibatalkan — belum ada alur
 *    pengembalian bahan ke gudang, jadi pembatalan meninggalkan stok bahan
 *    yang sudah keluar tanpa jejak balik.
 * 3. Penolakan sampai ke layar sebagai `{ ok:false, code }`: `cancelWorkOrder`
 *    dan `terimaBarangJadi` (layar terima barang jadi).
 */

const sesi = vi.hoisted(() => ({ id: "", izin: ["*"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.izin } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji",
  notifyWOCreated: async () => {},
  notifyWOStatusUpdated: async () => {},
  notifyWOMaterialsIssued: async () => {},
  notifyWOCompleted: async () => {},
}));
vi.mock("@/app/actions/settings/ppn", () => ({ getPpnRatePercent: async () => 11 }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({})) }));
vi.mock("@/lib/leadtime/auto-confirm", () => ({ applyChainSignal: vi.fn(async () => {}) }));
vi.mock("@/lib/production/fg-receipt-journal", () => ({
  postFgReceiptJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => {}) }));

/* Pembacaan WO pertama (`workOrder.findUnique`, di dalam maupun di luar transaksi) bisa ditahan. */
const tunda = vi.hoisted(() => ({ antrean: [] as number[], sesudahBaca: [] as Array<() => void> }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  type Fungsi = (...args: unknown[]) => unknown;
  const ikat = (t: object, v: unknown) => (typeof v === "function" ? (v as Fungsi).bind(t) : v);
  const bungkusWo = (delegasi: object) =>
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
        return p === "workOrder" && v && typeof v === "object" ? bungkusWo(v) : ikat(t, v);
      },
    });
  const prisma = new Proxy(asli.prisma, {
    get(t, p) {
      const v = Reflect.get(t, p);
      if (p === "workOrder" && v && typeof v === "object") return bungkusWo(v);
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

/** `pertama` membaca WO lalu tertahan; `kedua` berjalan dan commit selama itu. */
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

const { issueMaterials, cancelWorkOrder, terimaBarangJadi } = await import("./production");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("pembatalan perintah kerja (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let bahanId = "";
  let woId = "";
  let urut = 0;
  const woIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    bahanId = "";
    userId = (
      await prisma.user.create({ data: { email: `batal-wo-${token}@uji.local`, name: "Produksi uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TBW-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (
      await prisma.supplier.create({ data: { code: `CMT-BW-${token}`, name: "CMT uji", typeId }, select: { id: true } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `W${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({
        data: { sku: `FG-BW-${token}`, nameId: "Kemeja uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    bahanId = (
      await prisma.item.create({
        data: { sku: `KC-BW-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  async function buatWo(status: "DRAFT" | "ISSUED" | "IN_PRODUCTION" | "CANCELLED" = "ISSUED") {
    urut += 1;
    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-BW-${token}-${urut}`,
        vendorId,
        finishedGoodId: fgId,
        plannedQty: 100,
        consumptionPlan: [],
        createdById: userId,
        status,
        issuedAt: status === "DRAFT" ? null : new Date(),
      },
      select: { id: true },
    });
    woIds.push(wo.id);
    return wo.id;
  }

  beforeEach(async () => {
    woId = "";
    sesi.id = userId;
    sesi.izin = ["*"];
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: seededIds([bahanId, fgId]) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([bahanId, fgId]) } } });
    // Stok bahan 100 pcs @ 1.000.
    await prisma.inventoryValue.create({
      data: { itemId: bahanId, variantSku: "", qtyOnHand: 100, avgCost: 1_000, totalValue: 100_000 },
    });
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: seededIds([bahanId, fgId]) } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.itemPriceChangeLog.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.fGReceipt.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.materialIssue.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds(woIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([bahanId, fgId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([bahanId, fgId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  const keluarkan = (id: string, qty = 10) =>
    issueMaterials(
      { woId: id, items: [{ itemId: bahanId, qty, uomId }], issueType: "ACCESSORIES", isPartial: false },
      userId,
    );

  async function keadaan(id: string) {
    const wo = await prisma.workOrder.findUniqueOrThrow({
      where: { id: seededId(id) },
      select: { status: true, canceledReason: true, issues: { select: { id: true } } },
    });
    const stok = await prisma.inventoryValue.findMany({ where: { itemId: seededId(bahanId) }, select: { qtyOnHand: true } });
    return {
      status: wo.status,
      alasanBatal: wo.canceledReason,
      pengeluaran: wo.issues.length,
      stokBahan: stok.map((s) => Number(s.qtyOnHand)),
    };
  }

  describe("cancelWorkOrder mengembalikan kode", () => {
    it("WO terbit tanpa pengeluaran bahan → { ok:true }, CANCELLED dengan alasan", async () => {
      woId = await buatWo("ISSUED");
      expect(await cancelWorkOrder(woId, userId, "salah vendor")).toEqual({ ok: true });
      expect(await keadaan(woId)).toEqual({ status: "CANCELLED", alasanBatal: "salah vendor", pengeluaran: 0, stokBahan: [100] });
    });

    it("WO yang sudah mengeluarkan 10 pcs bahan → WO_SUDAH_KELUAR_BAHAN, WO tetap IN_PRODUCTION, stok bahan tetap 90", async () => {
      woId = await buatWo("ISSUED");
      await keluarkan(woId);
      expect(await cancelWorkOrder(woId, userId, "batal")).toEqual({ ok: false, code: "WO_SUDAH_KELUAR_BAHAN" });
      expect(await keadaan(woId)).toEqual({ status: "IN_PRODUCTION", alasanBatal: null, pengeluaran: 1, stokBahan: [90] });
    });

    it("WO yang sudah batal → WO_SUDAH_DIBATALKAN; WO tidak ada → WO_TIDAK_DITEMUKAN", async () => {
      woId = await buatWo("CANCELLED");
      expect(await cancelWorkOrder(woId, userId)).toEqual({ ok: false, code: "WO_SUDAH_DIBATALKAN" });
      expect(await cancelWorkOrder("wo-tidak-ada", userId)).toEqual({ ok: false, code: "WO_TIDAK_DITEMUKAN" });
    });

    it("tanpa work_orders:manage → TANPA_AKSES, WO tidak berubah", async () => {
      woId = await buatWo("ISSUED");
      sesi.izin = ["work_orders:view"];
      expect(await cancelWorkOrder(woId, userId)).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect((await keadaan(woId)).status).toBe("ISSUED");
    });
  });

  describe("balapan keluarkan bahan vs batal", () => {
    it("keluarkan membaca WO lalu tertahan, batal commit duluan → keluarkan ditolak, WO tetap batal, stok bahan tetap 100", async () => {
      woId = await buatWo("ISSUED");
      const [keluar, batal] = await balapan(
        () => keluarkan(woId),
        () => cancelWorkOrder(woId, userId, "uji balapan"),
      );
      expect(batal).toEqual({ status: "fulfilled", value: { ok: true } });
      expect(keluar.status).toBe("rejected");
      expect((keluar as PromiseRejectedResult).reason).toMatchObject({ code: "BAHAN_WO_DIBATALKAN" });
      expect(await keadaan(woId)).toEqual({ status: "CANCELLED", alasanBatal: "uji balapan", pengeluaran: 0, stokBahan: [100] });
    });

    it("batal membaca WO lalu tertahan, keluarkan commit duluan → batal ditolak (WO_SUDAH_KELUAR_BAHAN), stok bahan 90", async () => {
      woId = await buatWo("ISSUED");
      const [batal, keluar] = await balapan(
        () => cancelWorkOrder(woId, userId, "uji balapan"),
        () => keluarkan(woId),
      );
      expect(keluar.status).toBe("fulfilled");
      expect(batal).toEqual({ status: "fulfilled", value: { ok: false, code: "WO_SUDAH_KELUAR_BAHAN" } });
      expect(await keadaan(woId)).toEqual({ status: "IN_PRODUCTION", alasanBatal: null, pengeluaran: 1, stokBahan: [90] });
    });
  });

  describe("balapan batal vs batal", () => {
    it("dua pembatalan serentak → satu berhasil, satu WO_SUDAH_DIBATALKAN; alasan dari yang menang", async () => {
      woId = await buatWo("ISSUED");
      const [pertama, kedua] = await balapan(
        () => cancelWorkOrder(woId, userId, "batal pertama"),
        () => cancelWorkOrder(woId, userId, "batal kedua"),
      );
      expect(kedua).toEqual({ status: "fulfilled", value: { ok: true } });
      expect(pertama).toEqual({ status: "fulfilled", value: { ok: false, code: "WO_SUDAH_DIBATALKAN" } });
      expect(await keadaan(woId)).toEqual({ status: "CANCELLED", alasanBatal: "batal kedua", pengeluaran: 0, stokBahan: [100] });
    });
  });

  describe("issueMaterials menolak WO yang tidak bisa dikeluarkan bahannya", () => {
    it("WO batal → BAHAN_WO_DIBATALKAN, stok bahan tetap 100", async () => {
      woId = await buatWo("CANCELLED");
      await expect(keluarkan(woId)).rejects.toMatchObject({ code: "BAHAN_WO_DIBATALKAN" });
      expect(await keadaan(woId)).toEqual({ status: "CANCELLED", alasanBatal: null, pengeluaran: 0, stokBahan: [100] });
    });
  });

  describe("terimaBarangJadi (layar terima barang jadi) mengembalikan kode", () => {
    it("WO batal → { ok:false, WO_DIBATALKAN }; WO draf → { ok:false, WO_BELUM_TERBIT }", async () => {
      woId = await buatWo("CANCELLED");
      expect(await terimaBarangJadi({ woId, qtyReceived: 10, qtyRejected: 0 })).toEqual({ ok: false, code: "WO_DIBATALKAN" });
      woId = await buatWo("DRAFT");
      expect(await terimaBarangJadi({ woId, qtyReceived: 10, qtyRejected: 0 })).toEqual({ ok: false, code: "WO_BELUM_TERBIT" });
    });

    it("WO berjalan → { ok:true, id, docNumber }, 10 pcs barang jadi masuk", async () => {
      woId = await buatWo("ISSUED");
      await keluarkan(woId);
      const hasil = await terimaBarangJadi({ woId, qtyReceived: 10, qtyRejected: 0 });
      expect(hasil).toEqual({ ok: true, id: expect.any(String), docNumber: expect.any(String) });
      const fg = await prisma.inventoryValue.findMany({ where: { itemId: seededId(fgId) }, select: { qtyOnHand: true } });
      expect(fg.map((r) => Number(r.qtyOnHand))).toEqual([10]);
    });
  });
});
