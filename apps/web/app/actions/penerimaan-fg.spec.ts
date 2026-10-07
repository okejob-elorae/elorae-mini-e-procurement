import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Penerimaan barang jadi (`receiveFG`) dan pembatalan perintah kerja
 * (`cancelWorkOrder`) — sesi ditiru, basis data uji nyata.
 *
 * 1. Dulu SETIAP penerimaan sebagian memikul seluruh biaya bahan WO: rencana
 *    100 pcs, bahan 1.000.000, terima 40 → 25.000/pcs, terima 60 → 16.667/pcs,
 *    nilai stok 2.000.000 untuk bahan 1.000.000 (dan harga jual otomatis ikut
 *    naik). Sekarang 10.000/pcs pada keduanya, Σ = 1.000.000.
 * 2. Barang jadi bisa diterima ke WO yang sudah DIBATALKAN, dan pembatalan bisa
 *    menimpa penerimaan yang serentak. Keduanya kini di `runSerializable`.
 */

const sesi = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: ["*"] } })),
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
/* Jurnal penerimaan tidak diuji di sini dan tidak boleh menyentuh pemetaan akun bersama. */
vi.mock("@/lib/production/fg-receipt-journal", () => ({
  postFgReceiptJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/*
 * Balapan yang pasti: pembacaan WO pertama (`workOrder.findUnique`, di dalam
 * maupun di luar transaksi) bisa disuruh diam sesudah membaca, sehingga pihak
 * kedua selesai dan commit SELAMA pihak pertama memegang keadaan lamanya.
 */
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

const { receiveFG, cancelWorkOrder } = await import("./production");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("penerimaan barang jadi (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let woId = "";
  let urut = 0;
  const woIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    userId = (
      await prisma.user.create({ data: { email: `fg-terima-${token}@uji.local`, name: "Gudang uji" }, select: { id: true } })
    ).id;
    sesi.id = userId;
    typeId = (await prisma.supplierType.create({ data: { code: `TFG-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (
      await prisma.supplier.create({ data: { code: `CMT-${token}`, name: "CMT uji", typeId }, select: { id: true } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `F${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({
        data: { sku: `FG-TRM-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
  });

  /**
   * WO rencana 100 pcs dengan biaya bahan 1.000.000 yang sudah dikeluarkan.
   * `bahan: false` = belum ada bahan keluar — WO yang bahannya sudah keluar
   * tidak bisa dibatalkan (`WO_SUDAH_KELUAR_BAHAN`).
   */
  async function buatWo(
    status: "DRAFT" | "ISSUED" | "IN_PRODUCTION" | "CANCELLED" = "IN_PRODUCTION",
    { bahan = true }: { bahan?: boolean } = {},
  ) {
    urut += 1;
    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-TRM-${token}-${urut}`,
        vendorId,
        finishedGoodId: fgId,
        plannedQty: 100,
        consumptionPlan: {},
        createdById: userId,
        outputMode: "GENERIC",
        status,
        issuedAt: status === "DRAFT" ? null : new Date(),
      },
      select: { id: true },
    });
    woIds.push(wo.id);
    if (!bahan) return wo.id;
    await prisma.materialIssue.create({
      data: {
        docNumber: `MI-TRM-${token}-${urut}`,
        woId: wo.id,
        issueType: "FABRIC",
        items: [],
        totalCost: 1_000_000,
        issuedById: userId,
      },
    });
    return wo.id;
  }

  beforeEach(async () => {
    woId = "";
    sesi.id = userId;
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(fgId) } });
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.itemPriceChangeLog.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.fGReceipt.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.materialIssue.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds(woIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.item.deleteMany({ where: { id: seededId(fgId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function penerimaan(id: string) {
    const rows = await prisma.fGReceipt.findMany({
      where: { woId: seededId(id) },
      orderBy: { receivedAt: "asc" },
      select: { qtyAccepted: true, avgCostPerUnit: true, totalCostValue: true, materialCost: true },
    });
    return rows.map((r) => ({
      qty: Number(r.qtyAccepted),
      perPcs: Number(r.avgCostPerUnit),
      biaya: Number(r.totalCostValue),
      bahan: Number(r.materialCost),
    }));
  }

  async function stokFg() {
    const rows = await prisma.inventoryValue.findMany({
      where: { itemId: seededId(fgId) },
      select: { variantSku: true, qtyOnHand: true, avgCost: true, totalValue: true },
    });
    return rows.map((r) => ({
      varian: r.variantSku,
      qty: Number(r.qtyOnHand),
      avg: Number(r.avgCost),
      nilai: Number(r.totalValue),
    }));
  }

  async function statusWo(id: string) {
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: seededId(id) }, select: { status: true } });
    return wo.status;
  }

  describe("biaya per penerimaan", () => {
    it("bahan 1.000.000, rencana 100: terima 40 lalu 60 → 10.000/pcs pada keduanya, Σ = 1.000.000", async () => {
      woId = await buatWo();
      await receiveFG({ woId, qtyReceived: 40, qtyRejected: 0 }, "id-kiriman-klien");
      await receiveFG({ woId, qtyReceived: 60, qtyRejected: 0 }, "id-kiriman-klien");

      const r = await penerimaan(woId);
      expect(r).toEqual([
        { qty: 40, perPcs: 10_000, biaya: 400_000, bahan: 400_000 },
        { qty: 60, perPcs: 10_000, biaya: 600_000, bahan: 600_000 },
      ]);
      expect(r.reduce((s, x) => s + x.biaya, 0)).toBe(1_000_000);

      expect(await stokFg()).toEqual([{ varian: "", qty: 100, avg: 10_000, nilai: 1_000_000 }]);
      expect(await statusWo(woId)).toBe("COMPLETED");

      // Penerima dicatat dari sesi, bukan dari argumen klien.
      const p = await prisma.fGReceipt.findFirstOrThrow({ where: { woId: seededId(woId) }, select: { receivedById: true } });
      expect(p.receivedById).toBe(userId);
    });

    it("rincian varian: 40 pcs (S 10, M 30) → 100.000 + 300.000, Σ kartu stok = biaya penerimaan", async () => {
      woId = await buatWo();
      await receiveFG(
        {
          woId,
          qtyReceived: 40,
          qtyRejected: 0,
          skuBreakdown: [
            { variantSku: `FG-TRM-${token}-S`, qty: 10 },
            { variantSku: `FG-TRM-${token}-M`, qty: 30 },
          ],
        },
        userId,
      );
      const gerak = await prisma.stockMovement.findMany({
        where: { itemId: seededId(fgId), refType: "FG_RECEIPT" },
        orderBy: { qty: "asc" },
        select: { qty: true, unitCost: true, totalCost: true },
      });
      expect(gerak.map((g) => [Number(g.qty), Number(g.unitCost), Number(g.totalCost)])).toEqual([
        [10, 10_000, 100_000],
        [30, 10_000, 300_000],
      ]);
      expect((await penerimaan(woId))[0].biaya).toBe(400_000);
    });

    it("harga jual otomatis memakai HPP penerimaan, bukan seluruh bahan: margin 50% → 15.000 (dulu 37.500)", async () => {
      await prisma.item.update({
        where: { id: seededId(fgId) },
        data: { targetMarginPercent: 50, additionalCost: 0, sellingPrice: null },
      });
      try {
        woId = await buatWo();
        const harga = async () =>
          Number((await prisma.item.findUniqueOrThrow({ where: { id: seededId(fgId) }, select: { sellingPrice: true } })).sellingPrice);

        await receiveFG({ woId, qtyReceived: 40, qtyRejected: 0 }, userId);
        expect(await harga()).toBe(15_000);
        await receiveFG({ woId, qtyReceived: 60, qtyRejected: 0 }, userId);
        expect(await harga()).toBe(15_000);
        // Lebih produksi sesudah WO lengkap: biaya 0, harga jual tidak diturunkan ke 0 + biaya tambahan.
        await receiveFG({ woId, qtyReceived: 10, qtyRejected: 0 }, userId);
        expect(await harga()).toBe(15_000);
        expect((await penerimaan(woId)).map((r) => r.biaya)).toEqual([400_000, 600_000, 0]);
        expect(await stokFg()).toEqual([{ varian: "", qty: 110, avg: 9_090.91, nilai: 1_000_000 }]);
      } finally {
        await prisma.item.update({
          where: { id: seededId(fgId) },
          data: { targetMarginPercent: null, additionalCost: null, sellingPrice: null },
        });
      }
    });
  });

  describe("penjaga status WO", () => {
    it("WO yang DIBATALKAN menolak penerimaan (WO_DIBATALKAN), tanpa jejak stok", async () => {
      woId = await buatWo("CANCELLED");
      await expect(receiveFG({ woId, qtyReceived: 10, qtyRejected: 0 }, userId)).rejects.toMatchObject({
        code: "WO_DIBATALKAN",
      });
      expect(await penerimaan(woId)).toEqual([]);
      expect(await stokFg()).toEqual([]);
    });

    it("WO yang masih DRAFT menolak penerimaan (WO_BELUM_TERBIT)", async () => {
      woId = await buatWo("DRAFT");
      await expect(receiveFG({ woId, qtyReceived: 10, qtyRejected: 0 }, userId)).rejects.toMatchObject({
        code: "WO_BELUM_TERBIT",
      });
      expect(await penerimaan(woId)).toEqual([]);
    });

    it("WO yang sudah punya penerimaan tidak bisa dibatalkan (WO_SUDAH_ADA_PENERIMAAN)", async () => {
      woId = await buatWo();
      await receiveFG({ woId, qtyReceived: 10, qtyRejected: 0 }, userId);
      // Penolakan batal kini dikembalikan sebagai { ok:false, code }, bukan dilempar.
      expect(await cancelWorkOrder(woId, userId, "batal")).toEqual({ ok: false, code: "WO_SUDAH_ADA_PENERIMAAN" });
      expect(await statusWo(woId)).toBe("PARTIAL");
    });
  });

  describe("balapan batal vs terima", () => {
    it("terima membaca WO lalu tertahan, batal commit duluan → terima ditolak, WO tetap batal", async () => {
      woId = await buatWo("ISSUED", { bahan: false });
      const [terima, batal] = await balapan(
        () => receiveFG({ woId, qtyReceived: 40, qtyRejected: 0 }, userId),
        () => cancelWorkOrder(woId, userId, "uji balapan"),
      );
      expect(batal).toEqual({ status: "fulfilled", value: { ok: true } });
      expect(terima.status).toBe("rejected");
      expect((terima as PromiseRejectedResult).reason).toMatchObject({ code: "WO_DIBATALKAN" });
      expect(await statusWo(woId)).toBe("CANCELLED");
      expect(await penerimaan(woId)).toEqual([]);
      expect(await stokFg()).toEqual([]);
    });

    it("batal membaca WO lalu tertahan, terima commit duluan → batal ditolak, penerimaan bertahan", async () => {
      woId = await buatWo("ISSUED", { bahan: false });
      const [batal, terima] = await balapan(
        () => cancelWorkOrder(woId, userId, "uji balapan"),
        () => receiveFG({ woId, qtyReceived: 40, qtyRejected: 0 }, userId),
      );
      expect(terima.status).toBe("fulfilled");
      expect(batal).toEqual({ status: "fulfilled", value: { ok: false, code: "WO_SUDAH_ADA_PENERIMAAN" } });
      expect(await statusWo(woId)).toBe("PARTIAL");
      expect((await penerimaan(woId)).map((r) => r.qty)).toEqual([40]);
      expect((await stokFg())[0].qty).toBe(40);
    });
  });

  describe("balapan terima vs terima", () => {
    /*
     * Dua penerimaan 60 + 60 ke WO rencana 100 (lebih produksi). Yang membaca
     * keadaan lama dan tidak diulang akan memikul 600.000 lagi (Σ 1.200.000)
     * dan menulis actualQty 60. Yang benar: penerimaan kedua menutup rencana,
     * memikul sisa 400.000, Σ = 1.000.000, actualQty 120.
     */
    it("penerimaan pertama membaca WO lalu tertahan, yang kedua commit duluan → Σ biaya tetap 1.000.000", async () => {
      woId = await buatWo();
      const hasil = await balapan(
        () => receiveFG({ woId, qtyReceived: 60, qtyRejected: 0 }, userId),
        () => receiveFG({ woId, qtyReceived: 60, qtyRejected: 0 }, userId),
      );
      expect(hasil.map((h) => h.status)).toEqual(["fulfilled", "fulfilled"]);

      const r = (await penerimaan(woId)).sort((a, b) => a.biaya - b.biaya);
      expect(r).toEqual([
        { qty: 60, perPcs: 6_666.67, biaya: 400_000, bahan: 400_000 },
        { qty: 60, perPcs: 10_000, biaya: 600_000, bahan: 600_000 },
      ]);
      expect(await stokFg()).toEqual([{ varian: "", qty: 120, avg: 8_333.33, nilai: 1_000_000 }]);
      const wo = await prisma.workOrder.findUniqueOrThrow({
        where: { id: seededId(woId) },
        select: { status: true, actualQty: true },
      });
      expect({ status: wo.status, actualQty: Number(wo.actualQty) }).toEqual({ status: "COMPLETED", actualQty: 120 });
    });
  });
});
