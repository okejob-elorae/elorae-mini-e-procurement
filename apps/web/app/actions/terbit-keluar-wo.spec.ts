import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Menerbitkan perintah kerja dan mengeluarkan bahan — sesi ditiru, basis data uji nyata.
 *
 * 1. `issueWorkOrder` (DRAFT → ISSUED) dulu membaca status DI LUAR transaksi:
 *    "terbitkan" yang kalah cepat dari pembatalan menghidupkan WO batal menjadi
 *    ISSUED. Sekarang penjaga DRAFT dibaca di `runSerializable` yang sama dengan
 *    penulisannya.
 * 2. Layar terbitkan dan layar keluarkan bahan menerima `{ ok:false, code }`
 *    (`terbitkanWorkOrder`, `keluarkanBahan`) — di build produksi Next
 *    menyamarkan pesan galat yang dilempar aksi server.
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

const { issueWorkOrder, terbitkanWorkOrder, issueMaterials, keluarkanBahan, cancelWorkOrder } = await import(
  "./production"
);

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("terbitkan WO & keluarkan bahan (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let kancingId = "";
  let kainId = "";
  let grnId = "";
  let rollId = "";
  let woId = "";
  let urut = 0;
  const woIds: string[] = [];
  const kodeRoll = `ROL-TK-${token}`;

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    kancingId = "";
    kainId = "";
    grnId = "";
    rollId = "";
    userId = (
      await prisma.user.create({ data: { email: `terbit-wo-${token}@uji.local`, name: "Produksi uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TTK-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (
      await prisma.supplier.create({ data: { code: `CMT-TK-${token}`, name: "CMT uji", typeId }, select: { id: true } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `K${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({
        data: { sku: `FG-TK-${token}`, nameId: "Kemeja uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    kancingId = (
      await prisma.item.create({
        data: { sku: `KC-TK-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    kainId = (
      await prisma.item.create({
        data: { sku: `KN-TK-${token}`, nameId: "Kain uji", nameEn: "Test fabric", type: "FABRIC", uomId },
        select: { id: true },
      })
    ).id;
    grnId = (
      await prisma.gRN.create({
        data: { docNumber: `GRN-TK-${token}`, supplierId: vendorId, receivedBy: userId, totalAmount: 0, items: "[]" },
        select: { id: true },
      })
    ).id;
  });

  async function buatWo(
    status: "DRAFT" | "ISSUED" | "IN_PRODUCTION" | "COMPLETED" | "CANCELLED" = "ISSUED",
    opsi: { pakaiKain?: boolean } = {},
  ) {
    urut += 1;
    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-TK-${token}-${urut}`,
        vendorId,
        finishedGoodId: fgId,
        consumptionMaterialId: opsi.pakaiKain ? kainId : null,
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
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: seededIds([kancingId, kainId]) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([kancingId, kainId]) } } });
    await prisma.fabricRoll.deleteMany({ where: { grnId: seededId(grnId) } });
    // Stok kancing 100 pcs @ 1.000; kain 100 m @ 20.000; satu roll kain sisa 5 m.
    await prisma.inventoryValue.create({
      data: { itemId: kancingId, variantSku: "", qtyOnHand: 100, avgCost: 1_000, totalValue: 100_000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId: kainId, variantSku: "", qtyOnHand: 100, avgCost: 20_000, totalValue: 2_000_000 },
    });
    rollId = (
      await prisma.fabricRoll.create({
        data: { grnId, itemId: kainId, rollCode: kodeRoll, rollRef: kodeRoll, initialLength: 5, remainingLength: 5, uomId },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: seededIds([kancingId, kainId, fgId]) } } });
    await prisma.materialIssue.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds(woIds) } } });
    await prisma.fabricRoll.deleteMany({ where: { grnId: seededId(grnId) } });
    await prisma.gRN.deleteMany({ where: { id: seededId(grnId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([kancingId, kainId, fgId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kancingId, kainId, fgId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function keadaanWo(id: string) {
    const wo = await prisma.workOrder.findUniqueOrThrow({
      where: { id: seededId(id) },
      select: { status: true, issuedAt: true, canceledReason: true, issues: { select: { id: true } } },
    });
    return {
      status: wo.status,
      sudahTerbit: wo.issuedAt != null,
      alasanBatal: wo.canceledReason,
      pengeluaran: wo.issues.length,
    };
  }

  async function stok(itemId: string) {
    const baris = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) }, select: { qtyOnHand: true } });
    return baris.map((b) => Number(b.qtyOnHand));
  }

  async function sisaRoll() {
    const r = await prisma.fabricRoll.findUniqueOrThrow({ where: { id: seededId(rollId) }, select: { remainingLength: true } });
    return Number(r.remainingLength);
  }

  const kancing = (id: string, qty = 10) => ({
    woId: id,
    items: [{ itemId: kancingId, qty, uomId }],
    issueType: "ACCESSORIES" as const,
    isPartial: false,
  });

  const kain = (id: string, qty: number, roll: number) => ({
    woId: id,
    items: [{ itemId: kainId, qty, uomId }],
    issueType: "FABRIC" as const,
    isPartial: false,
    rollBreakdown: [{ rollRef: kodeRoll, qty: roll }],
  });

  describe("issueWorkOrder: penjaga DRAFT di dalam transaksi", () => {
    it("terbitkan membaca WO draf lalu tertahan, batal commit duluan → terbitkan ditolak, WO tetap batal tanpa tanggal terbit", async () => {
      woId = await buatWo("DRAFT");
      const [terbit, batal] = await balapan(
        () => issueWorkOrder(woId, userId),
        () => cancelWorkOrder(woId, userId, "uji balapan"),
      );
      expect(batal).toEqual({ status: "fulfilled", value: { ok: true } });
      expect(terbit.status).toBe("rejected");
      expect((terbit as PromiseRejectedResult).reason).toMatchObject({ code: "WO_SUDAH_DIBATALKAN" });
      expect(await keadaanWo(woId)).toEqual({
        status: "CANCELLED",
        sudahTerbit: false,
        alasanBatal: "uji balapan",
        pengeluaran: 0,
      });
    });

    it("terbitkan ganda: yang tertahan kalah → WO_SUDAH_TERBIT, WO ISSUED sekali", async () => {
      woId = await buatWo("DRAFT");
      const [pertama, kedua] = await balapan(
        () => terbitkanWorkOrder(woId),
        () => terbitkanWorkOrder(woId),
      );
      expect(kedua).toEqual({ status: "fulfilled", value: { ok: true } });
      expect(pertama).toEqual({ status: "fulfilled", value: { ok: false, code: "WO_SUDAH_TERBIT" } });
      expect((await keadaanWo(woId)).status).toBe("ISSUED");
    });

    it("Promise.all dua terbitkan → tepat satu { ok:true }", async () => {
      woId = await buatWo("DRAFT");
      const hasil = await Promise.all([terbitkanWorkOrder(woId), terbitkanWorkOrder(woId)]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, code: "WO_SUDAH_TERBIT" }]);
      expect((await keadaanWo(woId)).status).toBe("ISSUED");
    });
  });

  describe("terbitkanWorkOrder mengembalikan kode", () => {
    it("WO draf → { ok:true }, ISSUED dengan tanggal terbit; diulang → WO_SUDAH_TERBIT", async () => {
      woId = await buatWo("DRAFT");
      expect(await terbitkanWorkOrder(woId)).toEqual({ ok: true });
      expect(await keadaanWo(woId)).toEqual({ status: "ISSUED", sudahTerbit: true, alasanBatal: null, pengeluaran: 0 });
      expect(await terbitkanWorkOrder(woId)).toEqual({ ok: false, code: "WO_SUDAH_TERBIT" });
    });

    it("WO batal → WO_SUDAH_DIBATALKAN; WO tidak ada → WO_TIDAK_DITEMUKAN", async () => {
      woId = await buatWo("CANCELLED");
      expect(await terbitkanWorkOrder(woId)).toEqual({ ok: false, code: "WO_SUDAH_DIBATALKAN" });
      expect((await keadaanWo(woId)).status).toBe("CANCELLED");
      expect(await terbitkanWorkOrder("wo-tidak-ada")).toEqual({ ok: false, code: "WO_TIDAK_DITEMUKAN" });
    });

    it("tanpa work_orders:manage → TANPA_AKSES, WO tetap draf", async () => {
      woId = await buatWo("DRAFT");
      sesi.izin = ["work_orders:view"];
      expect(await terbitkanWorkOrder(woId)).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect((await keadaanWo(woId)).status).toBe("DRAFT");
    });
  });

  describe("keluarkanBahan mengembalikan kode", () => {
    it("WO terbit, 10 pcs kancing @ 1.000 → { ok:true, totalCost 10.000 }, stok 90, WO IN_PRODUCTION", async () => {
      woId = await buatWo("ISSUED");
      const hasil = await keluarkanBahan(kancing(woId));
      expect(hasil).toEqual({ ok: true, id: expect.any(String), docNumber: expect.any(String), totalCost: 10_000 });
      expect(await stok(kancingId)).toEqual([90]);
      expect(await keadaanWo(woId)).toMatchObject({ status: "IN_PRODUCTION", pengeluaran: 1 });
    });

    it("WO batal → BAHAN_WO_DIBATALKAN; WO selesai → BAHAN_WO_SELESAI; WO tidak ada → WO_TIDAK_DITEMUKAN; stok tetap 100", async () => {
      woId = await buatWo("CANCELLED");
      expect(await keluarkanBahan(kancing(woId))).toEqual({ ok: false, code: "BAHAN_WO_DIBATALKAN" });
      woId = await buatWo("COMPLETED");
      expect(await keluarkanBahan(kancing(woId))).toEqual({ ok: false, code: "BAHAN_WO_SELESAI" });
      expect(await keluarkanBahan(kancing("wo-tidak-ada"))).toEqual({ ok: false, code: "WO_TIDAK_DITEMUKAN" });
      expect(await stok(kancingId)).toEqual([100]);
    });

    it("150 pcs dari stok 100 → STOK_BAHAN_KURANG dengan nama barang, stok tetap 100, tanpa pengeluaran", async () => {
      woId = await buatWo("ISSUED");
      expect(await keluarkanBahan(kancing(woId, 150))).toEqual({
        ok: false,
        code: "STOK_BAHAN_KURANG",
        barang: "Kancing uji",
      });
      expect(await stok(kancingId)).toEqual([100]);
      expect(await keadaanWo(woId)).toMatchObject({ status: "ISSUED", pengeluaran: 0 });
    });

    it("kain 10 m dengan roll 4 m → ROLL_KURANG_DARI_KAIN (roll 4, kain 10)", async () => {
      woId = await buatWo("ISSUED", { pakaiKain: true });
      expect(await keluarkanBahan(kain(woId, 10, 4))).toEqual({
        ok: false,
        code: "ROLL_KURANG_DARI_KAIN",
        roll: 4,
        kain: 10,
      });
      expect(await stok(kainId)).toEqual([100]);
      expect(await sisaRoll()).toBe(5);
    });

    it("kain 10 m dari roll bersisa 5 m → ROLL_TIDAK_CUKUP kurang 5, stok kain dan roll dikembalikan", async () => {
      woId = await buatWo("ISSUED", { pakaiKain: true });
      expect(await keluarkanBahan(kain(woId, 10, 10))).toEqual({ ok: false, code: "ROLL_TIDAK_CUKUP", kurang: 5 });
      expect(await stok(kainId)).toEqual([100]);
      expect(await sisaRoll()).toBe(5);
      expect(await keadaanWo(woId)).toMatchObject({ status: "ISSUED", pengeluaran: 0 });
    });

    it("tanpa work_orders:manage → TANPA_AKSES, stok tetap 100", async () => {
      woId = await buatWo("ISSUED");
      sesi.izin = ["work_orders:view"];
      expect(await keluarkanBahan(kancing(woId))).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect(await stok(kancingId)).toEqual([100]);
    });

    it("keluarkan tertahan, batal commit duluan → { ok:false, BAHAN_WO_DIBATALKAN }, stok tetap 100", async () => {
      woId = await buatWo("ISSUED");
      const [keluar, batal] = await balapan(
        () => keluarkanBahan(kancing(woId)),
        () => cancelWorkOrder(woId, userId, "uji balapan"),
      );
      expect(batal).toEqual({ status: "fulfilled", value: { ok: true } });
      expect(keluar).toEqual({ status: "fulfilled", value: { ok: false, code: "BAHAN_WO_DIBATALKAN" } });
      expect(await stok(kancingId)).toEqual([100]);
    });
  });

  describe("issueMaterials (pemanggil lain) tetap melempar galat ber-kode", () => {
    it("stok kurang → dilempar dengan code STOK_BAHAN_KURANG dan pesan menyebut barangnya", async () => {
      woId = await buatWo("ISSUED");
      await expect(issueMaterials(kancing(woId, 150), userId)).rejects.toMatchObject({
        code: "STOK_BAHAN_KURANG",
        message: expect.stringContaining("Kancing uji"),
      });
      expect(await stok(kancingId)).toEqual([100]);
    });
  });
});
