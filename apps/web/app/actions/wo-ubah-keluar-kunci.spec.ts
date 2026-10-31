import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Produksi: sisa kode galat dan balapan — sesi ditiru, basis data uji nyata.
 *
 * 1. `keluarkanBahan` punya kunci idempotensi per isian formulir. Dulu
 *    kegagalan SESUDAH commit (atau jawaban yang hilang di jalan) membuat
 *    pengguna menekan simpan lagi dan bahan keluar dua kali. Kunci diperiksa
 *    PALING DULU di dalam transaksi; yang sudah tercatat dikembalikan apa adanya.
 * 2. `updateWorkOrder` dulu memeriksa DRAFT di luar transaksi lalu menulis ulang
 *    rencana bahan dengan issuedQty 0: bahan yang keluar di antaranya hilang dari
 *    rencana. Sekarang penjaga DRAFT + tulisan satu `runSerializable`, dan
 *    issuedQty/returnedQty yang sudah ada tidak ditimpa. Penolakan berkode.
 * 3. `issueAdditionalMaterials` mengembalikan kode, pelaku dari sesi.
 */

const sesi = vi.hoisted(() => ({ id: "", izin: ["*"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.izin } })),
}));
/* `revalidatePath` bisa disuruh gagal sekali — meniru kegagalan SESUDAH commit. */
const cache = vi.hoisted(() => ({ gagalSekali: false }));
vi.mock("next/cache", () => ({
  revalidatePath: () => {
    if (cache.gagalSekali) {
      cache.gagalSekali = false;
      throw new Error("revalidate gagal (tiruan)");
    }
  },
}));
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

const { keluarkanBahan, updateWorkOrder, issueAdditionalMaterials } = await import("./production");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("ubah WO, keluarkan bahan berkunci, bahan tambahan (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let lainId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let fgTanpaBomId = "";
  let kancingId = "";
  let woId = "";
  let urut = 0;
  const woIds: string[] = [];
  const kodeSatuan = `U${token}`.slice(0, 10);

  beforeAll(async () => {
    userId = "";
    lainId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    fgTanpaBomId = "";
    kancingId = "";
    userId = (
      await prisma.user.create({ data: { email: `ubah-wo-${token}@uji.local`, name: "Produksi uji" }, select: { id: true } })
    ).id;
    lainId = (
      await prisma.user.create({ data: { email: `ubah-wo-lain-${token}@uji.local`, name: "Orang lain" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TUW-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (
      await prisma.supplier.create({ data: { code: `CMT-UW-${token}`, name: "CMT uji", typeId }, select: { id: true } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: kodeSatuan, nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({
        data: { sku: `FG-UW-${token}`, nameId: "Kemeja uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    fgTanpaBomId = (
      await prisma.item.create({
        data: { sku: `FG2-UW-${token}`, nameId: "Kaos tanpa BOM", nameEn: "No BOM tee", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    kancingId = (
      await prisma.item.create({
        data: { sku: `KC-UW-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    // BOM: 1 kancing per kemeja, tanpa susut.
    await prisma.consumptionRule.create({ data: { finishedGoodId: fgId, materialId: kancingId, qtyRequired: 1, wastePercent: 0 } });
  });

  async function buatWo(
    status: "DRAFT" | "ISSUED" | "IN_PRODUCTION" = "DRAFT",
    opsi: { fg?: string; rencana?: Array<Record<string, unknown>> } = {},
  ) {
    urut += 1;
    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-UW-${token}-${urut}`,
        vendorId,
        finishedGoodId: opsi.fg ?? fgId,
        plannedQty: 100,
        consumptionPlan: JSON.stringify(
          opsi.rencana ?? [
            { itemId: kancingId, itemName: "Kancing uji", qtyRequired: 1, wastePercent: 0, plannedQty: 100, issuedQty: 0, returnedQty: 0 },
          ],
        ),
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
    cache.gagalSekali = false;
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(kancingId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kancingId) } });
    // Stok kancing 100 pcs @ 1.000.
    await prisma.inventoryValue.create({
      data: { itemId: kancingId, variantSku: "", qtyOnHand: 100, avgCost: 1_000, totalValue: 100_000 },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(woIds) } } });
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(kancingId) } });
    await prisma.materialIssue.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.workOrderStep.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds(woIds) } } });
    await prisma.consumptionRule.deleteMany({ where: { finishedGoodId: seededId(fgId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([kancingId, fgId, fgTanpaBomId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kancingId, fgId, fgTanpaBomId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: seededIds([userId, lainId]) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([userId, lainId]) } } });
  });

  async function stok() {
    const baris = await prisma.inventoryValue.findMany({ where: { itemId: seededId(kancingId) }, select: { qtyOnHand: true } });
    return baris.reduce((t, b) => t + Number(b.qtyOnHand), 0);
  }

  async function keadaanWo(id: string) {
    const wo = await prisma.workOrder.findUniqueOrThrow({
      where: { id: seededId(id) },
      select: {
        status: true,
        plannedQty: true,
        consumptionPlan: true,
        issues: { select: { id: true, issuedById: true } },
      },
    });
    const raw = wo.consumptionPlan;
    const rencana = (typeof raw === "string" ? JSON.parse(raw) : raw) as Array<{
      itemId: string;
      plannedQty?: number;
      issuedQty?: number;
      returnedQty?: number;
    }>;
    const kancing = rencana.find((r) => r.itemId === kancingId);
    return {
      status: wo.status,
      plannedQty: Number(wo.plannedQty),
      rencanaKancing: kancing
        ? { plannedQty: kancing.plannedQty, issuedQty: kancing.issuedQty ?? 0, returnedQty: kancing.returnedQty ?? 0 }
        : null,
      pengeluaran: wo.issues.length,
      pelaku: [...new Set(wo.issues.map((i) => i.issuedById))],
    };
  }

  const kancing = (id: string, qty = 10, kunci?: string) => ({
    woId: id,
    items: [{ itemId: kancingId, qty, uomId }],
    issueType: "ACCESSORIES" as const,
    isPartial: false,
    ...(kunci ? { idempotencyKey: kunci } : {}),
  });

  const dataWo = (plannedQty: number) => ({
    vendorId,
    finishedGoodId: fgId,
    outputMode: "GENERIC" as const,
    plannedQty,
  });

  describe("keluarkanBahan dengan kunci idempotensi", () => {
    it("kunci yang sama dua kali → hasil pertama dikembalikan lagi; stok keluar 10 SEKALI, satu dokumen", async () => {
      woId = await buatWo("ISSUED");
      const kunci = `kunci-${token}-a`;
      const pertama = await keluarkanBahan(kancing(woId, 10, kunci));
      expect(pertama).toEqual({ ok: true, id: expect.any(String), docNumber: expect.any(String), totalCost: 10_000 });
      expect(await keluarkanBahan(kancing(woId, 10, kunci))).toEqual(pertama);
      expect(await stok()).toBe(90);
      expect(await keadaanWo(woId)).toMatchObject({ status: "IN_PRODUCTION", pengeluaran: 1, rencanaKancing: { issuedQty: 10 } });
    });

    it("gagal SESUDAH commit (jawaban hilang) → simpan ulang dengan kunci sama tidak mengeluarkan bahan lagi", async () => {
      woId = await buatWo("ISSUED");
      const kunci = `kunci-${token}-b`;
      const catat = vi.spyOn(console, "error").mockImplementation(() => {});
      cache.gagalSekali = true;
      expect(await keluarkanBahan(kancing(woId, 10, kunci))).toEqual({ ok: false, code: "GAGAL" });
      catat.mockRestore();
      expect(await stok()).toBe(90);
      const ulang = await keluarkanBahan(kancing(woId, 10, kunci));
      expect(ulang).toMatchObject({ ok: true, totalCost: 10_000 });
      expect(await stok()).toBe(90);
      expect(await keadaanWo(woId)).toMatchObject({ pengeluaran: 1, rencanaKancing: { issuedQty: 10 } });
    });

    it("Promise.all dua simpan berkunci sama → keduanya { ok:true } dengan dokumen yang SAMA; stok 90", async () => {
      woId = await buatWo("ISSUED");
      const kunci = `kunci-${token}-c`;
      const [a, b] = await Promise.all([keluarkanBahan(kancing(woId, 10, kunci)), keluarkanBahan(kancing(woId, 10, kunci))]);
      expect(a).toMatchObject({ ok: true });
      expect(b).toEqual(a);
      expect(await stok()).toBe(90);
      expect(await keadaanWo(woId)).toMatchObject({ pengeluaran: 1, rencanaKancing: { issuedQty: 10 } });
    });

    it("kunci berbeda = isian berbeda → dua pengeluaran, stok 80", async () => {
      woId = await buatWo("ISSUED");
      expect(await keluarkanBahan(kancing(woId, 10, `kunci-${token}-d1`))).toMatchObject({ ok: true });
      expect(await keluarkanBahan(kancing(woId, 10, `kunci-${token}-d2`))).toMatchObject({ ok: true });
      expect(await stok()).toBe(80);
      expect(await keadaanWo(woId)).toMatchObject({ pengeluaran: 2, rencanaKancing: { issuedQty: 20 } });
    });

    it("kunci dari WO lain tidak dianggap ulangan", async () => {
      const woA = await buatWo("ISSUED");
      const woB = await buatWo("ISSUED");
      const kunci = `kunci-${token}-e`;
      const a = await keluarkanBahan(kancing(woA, 10, kunci));
      const b = await keluarkanBahan(kancing(woB, 10, kunci));
      expect(a.ok && b.ok && a.id !== b.id).toBe(true);
      expect(await stok()).toBe(80);
    });
  });

  describe("updateWorkOrder: penjaga DRAFT di dalam transaksi", () => {
    it("WO draf → { ok:true }, rencana kancing 50", async () => {
      woId = await buatWo("DRAFT");
      expect(await updateWorkOrder(woId, dataWo(50), lainId)).toEqual({ ok: true, id: woId, docNumber: `WO-UW-${token}-${urut}` });
      expect(await keadaanWo(woId)).toMatchObject({
        status: "DRAFT",
        plannedQty: 50,
        rencanaKancing: { plannedQty: 50, issuedQty: 0, returnedQty: 0 },
      });
    });

    it("issuedQty 3 / returnedQty 1 yang sudah ada di rencana TIDAK ditimpa 0", async () => {
      woId = await buatWo("DRAFT", {
        rencana: [{ itemId: kancingId, qtyRequired: 1, wastePercent: 0, plannedQty: 100, issuedQty: 3, returnedQty: 1 }],
      });
      expect(await updateWorkOrder(woId, dataWo(50), userId)).toMatchObject({ ok: true });
      expect((await keadaanWo(woId)).rencanaKancing).toEqual({ plannedQty: 50, issuedQty: 3, returnedQty: 1 });
    });

    it("balapan: ubah membaca WO draf lalu tertahan, keluarkan bahan 10 commit → ubah ditolak WO_BUKAN_DRAF, issuedQty 10 tetap", async () => {
      woId = await buatWo("DRAFT");
      const [ubah, keluar] = await balapan(
        () => updateWorkOrder(woId, dataWo(50), userId),
        () => keluarkanBahan(kancing(woId, 10)),
      );
      expect(keluar).toMatchObject({ status: "fulfilled", value: { ok: true } });
      expect(ubah).toEqual({ status: "fulfilled", value: { ok: false, code: "WO_BUKAN_DRAF" } });
      expect(await keadaanWo(woId)).toMatchObject({
        status: "IN_PRODUCTION",
        plannedQty: 100,
        rencanaKancing: { plannedQty: 100, issuedQty: 10 },
      });
      expect(await stok()).toBe(90);
    });

    it("Promise.all ubah + keluarkan bahan: apa pun urutannya, issuedQty 10 tidak hilang", async () => {
      woId = await buatWo("DRAFT");
      const [ubah, keluar] = await Promise.all([updateWorkOrder(woId, dataWo(50), userId), keluarkanBahan(kancing(woId, 10))]);
      expect(keluar).toMatchObject({ ok: true });
      const akhir = await keadaanWo(woId);
      expect(akhir.rencanaKancing?.issuedQty).toBe(10);
      expect(akhir.plannedQty).toBe(ubah.ok ? 50 : 100);
      if (!ubah.ok) expect(ubah).toEqual({ ok: false, code: "WO_BUKAN_DRAF" });
      expect(await stok()).toBe(90);
    });

    it("kode: WO terbit → WO_BUKAN_DRAF; tidak ada → WO_TIDAK_DITEMUKAN; qty 0 → DATA_TIDAK_VALID; tanpa izin → TANPA_AKSES", async () => {
      woId = await buatWo("ISSUED");
      expect(await updateWorkOrder(woId, dataWo(50), userId)).toEqual({ ok: false, code: "WO_BUKAN_DRAF" });
      expect(await updateWorkOrder("wo-tidak-ada", dataWo(50), userId)).toEqual({ ok: false, code: "WO_TIDAK_DITEMUKAN" });
      woId = await buatWo("DRAFT");
      expect(await updateWorkOrder(woId, dataWo(0), userId)).toEqual({ ok: false, code: "DATA_TIDAK_VALID" });
      sesi.izin = ["work_orders:view"];
      expect(await updateWorkOrder(woId, dataWo(50), userId)).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect((await keadaanWo(woId)).plannedQty).toBe(100);
    });

    it("rencana 500 dari stok 100 → STOK_RENCANA_KURANG: kancing kurang 400; WO tidak berubah", async () => {
      woId = await buatWo("DRAFT");
      expect(await updateWorkOrder(woId, dataWo(500), userId)).toEqual({
        ok: false,
        code: "STOK_RENCANA_KURANG",
        kurang: [{ barang: "Kancing uji", qty: 400, satuan: kodeSatuan }],
      });
      expect((await keadaanWo(woId)).plannedQty).toBe(100);
    });

    it("WO sudah terbit DAN rencana 500 melebihi stok 100 → WO_BUKAN_DRAF (bukan pesan stok); tidak ada → WO_TIDAK_DITEMUKAN", async () => {
      woId = await buatWo("ISSUED");
      expect(await updateWorkOrder(woId, dataWo(500), userId)).toEqual({ ok: false, code: "WO_BUKAN_DRAF" });
      expect(await updateWorkOrder("wo-tidak-ada", dataWo(500), userId)).toEqual({ ok: false, code: "WO_TIDAK_DITEMUKAN" });
      expect((await keadaanWo(woId)).plannedQty).toBe(100);
    });
  });

  describe("issueAdditionalMaterials mengembalikan kode", () => {
    it("WO produksi, +5 pcs → 5 kancing keluar; pelaku dari sesi (bukan id kiriman)", async () => {
      woId = await buatWo("IN_PRODUCTION", { rencana: [] });
      expect(await issueAdditionalMaterials(woId, 5, lainId)).toEqual({
        ok: true,
        id: expect.any(String),
        docNumber: expect.any(String),
        totalCost: 5_000,
      });
      expect(await stok()).toBe(95);
      expect(await keadaanWo(woId)).toMatchObject({ pengeluaran: 1, pelaku: [userId] });
    });

    it("kunci sama dua kali → satu pengeluaran", async () => {
      woId = await buatWo("IN_PRODUCTION", { rencana: [] });
      const kunci = `kunci-${token}-tambah`;
      const a = await issueAdditionalMaterials(woId, 5, userId, kunci);
      expect(await issueAdditionalMaterials(woId, 5, userId, kunci)).toEqual(a);
      expect(await stok()).toBe(95);
      expect((await keadaanWo(woId)).pengeluaran).toBe(1);
    });

    it("kode: WO belum produksi, qty bukan bulat positif, BOM tanpa aksesori, stok kurang, tanpa izin", async () => {
      woId = await buatWo("ISSUED", { rencana: [] });
      expect(await issueAdditionalMaterials(woId, 5, userId)).toEqual({ ok: false, code: "WO_BUKAN_PRODUKSI" });
      woId = await buatWo("IN_PRODUCTION", { rencana: [] });
      expect(await issueAdditionalMaterials(woId, 0, userId)).toEqual({ ok: false, code: "QTY_TAMBAHAN_TIDAK_VALID" });
      expect(await issueAdditionalMaterials(woId, 1.5, userId)).toEqual({ ok: false, code: "QTY_TAMBAHAN_TIDAK_VALID" });
      expect(await issueAdditionalMaterials(woId, 150, userId)).toEqual({
        ok: false,
        code: "STOK_BAHAN_KURANG",
        barang: "Kancing uji",
      });
      const tanpaBom = await buatWo("IN_PRODUCTION", { fg: fgTanpaBomId, rencana: [] });
      expect(await issueAdditionalMaterials(tanpaBom, 5, userId)).toEqual({ ok: false, code: "TANPA_AKSESORI_BOM" });
      expect(await issueAdditionalMaterials("wo-tidak-ada", 5, userId)).toEqual({ ok: false, code: "WO_TIDAK_DITEMUKAN" });
      sesi.izin = ["work_orders:view"];
      expect(await issueAdditionalMaterials(woId, 5, userId)).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect(await stok()).toBe(100);
    });
  });
});
