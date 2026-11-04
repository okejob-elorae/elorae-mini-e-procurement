import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * "Kembalikan bahan" dari CMT ke gudang + pembatalan WO sesudahnya — sesi
 * ditiru, basis data uji nyata, angka nyata.
 *
 * Kain 100 m @ 30.000 dan kancing 500 pcs @ 1.000 di gudang. WO mengeluarkan
 * kain 60 m dan kancing 200 pcs. Sesudah itu harga gudang kain berubah (140 m
 * @ 35.000), supaya terlihat bahwa yang kembali dinilai pada HARGA KELUARNYA
 * (30.000), bukan harga gudang hari ini.
 *
 * Keputusan pemilik 2026-11-01: bila kartu stok tidak menyimpan nilai
 * pengeluarannya, harga keluar diambil dari DOKUMEN pengeluaran bahan; tanpa
 * harga di keduanya pengembalian ditolak, tidak diam-diam Rp 0.
 */

const sesi = vi.hoisted(() => ({ id: "", izin: ["*"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.izin } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: async () => "Penguji" }));
vi.mock("@/lib/notifications/events", () => ({
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

const { issueMaterials, cancelWorkOrder, kembalikanBahan, getBahanWo, terimaBarangJadi } = await import("./production");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("kembalikan bahan WO (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomMtrId = "";
  let uomPcsId = "";
  let fgId = "";
  let kainId = "";
  let kancingId = "";
  let woId = "";
  let urut = 0;
  let kunciUrut = 0;
  const woIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomMtrId = "";
    uomPcsId = "";
    fgId = "";
    kainId = "";
    kancingId = "";
    userId = (
      await prisma.user.create({ data: { email: `kembali-bahan-${token}@uji.local`, name: "Gudang uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TKB-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (
      await prisma.supplier.create({ data: { code: `CMT-KB-${token}`, name: "Penjahit uji", typeId }, select: { id: true } })
    ).id;
    uomMtrId = (await prisma.uOM.create({ data: { code: `M${token}`.slice(0, 10), nameId: "Meter", nameEn: "Meter" }, select: { id: true } })).id;
    uomPcsId = (await prisma.uOM.create({ data: { code: `P${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({
        data: { sku: `FG-KB-${token}`, nameId: "Kemeja uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId: uomPcsId },
        select: { id: true },
      })
    ).id;
    kainId = (
      await prisma.item.create({
        data: { sku: `KN-KB-${token}`, nameId: "Kain katun uji", nameEn: "Test cotton", type: "FABRIC", uomId: uomMtrId },
        select: { id: true },
      })
    ).id;
    kancingId = (
      await prisma.item.create({
        data: { sku: `KC-KB-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId: uomPcsId },
        select: { id: true },
      })
    ).id;
  });

  const barangUji = () => seededIds([kainId, kancingId, fgId]);

  async function bersihkanGerakan() {
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: barangUji() } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: barangUji() } } });
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: barangUji() } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: barangUji() } } });
  }

  beforeEach(async () => {
    woId = "";
    sesi.id = userId;
    sesi.izin = ["*"];
    await bersihkanGerakan();
    await prisma.inventoryValue.create({
      data: { itemId: kainId, variantSku: null, qtyOnHand: 100, avgCost: 30_000, totalValue: 3_000_000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId: kancingId, variantSku: "", qtyOnHand: 500, avgCost: 1_000, totalValue: 500_000 },
    });
  });

  afterAll(async () => {
    await bersihkanGerakan();
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.itemPriceChangeLog.deleteMany({ where: { itemId: seededId(fgId) } });
    await prisma.fGReceipt.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.materialIssue.deleteMany({ where: { woId: { in: seededIds(woIds) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds(woIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: barangUji() } } });
    await prisma.uOM.deleteMany({ where: { id: { in: seededIds([uomMtrId, uomPcsId]) } } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  /** WO 80 pcs; kain 0,75 m/pcs (60 m), kancing 2,5 pcs/pcs (200 pcs); bahan sudah keluar. */
  async function woBerbahan() {
    urut += 1;
    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-KB-${token}-${urut}`,
        vendorId,
        finishedGoodId: fgId,
        plannedQty: 80,
        consumptionPlan: JSON.stringify([
          { itemId: kainId, itemName: "Kain katun uji", uomCode: "MTR", qtyRequired: 0.75, wastePercent: 0, plannedQty: 60 },
          { itemId: kancingId, itemName: "Kancing uji", uomCode: "PCS", qtyRequired: 2.5, wastePercent: 0, plannedQty: 200 },
        ]),
        createdById: userId,
        status: "ISSUED",
        issuedAt: new Date(),
      },
      select: { id: true },
    });
    woIds.push(wo.id);
    await issueMaterials(
      {
        woId: wo.id,
        items: [
          { itemId: kainId, qty: 60, uomId: uomMtrId },
          { itemId: kancingId, qty: 200, uomId: uomPcsId },
        ],
        issueType: "FABRIC",
        isPartial: false,
      },
      userId,
    );
    // Harga gudang kain berubah sesudah bahan keluar: 40 m tersisa + 100 m baru = 140 m @ 35.000.
    await prisma.inventoryValue.updateMany({
      where: { itemId: seededId(kainId) },
      data: { qtyOnHand: 140, avgCost: 35_000, totalValue: 4_900_000 },
    });
    return wo.id;
  }

  const kunciBaru = () => `uji-kunci-${token}-${++kunciUrut}`;

  async function stok(itemId: string) {
    const rows = await prisma.inventoryValue.findMany({
      where: { itemId: seededId(itemId) },
      select: { qtyOnHand: true, avgCost: true, totalValue: true },
    });
    return rows.map((r) => ({ qty: Number(r.qtyOnHand), avg: Number(r.avgCost), nilai: Number(r.totalValue) }));
  }

  async function rencanaKembali(id: string) {
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: seededId(id) }, select: { consumptionPlan: true } });
    const plan = JSON.parse(String(wo.consumptionPlan)) as Array<{ itemId: string; issuedQty?: number; returnedQty?: number }>;
    return Object.fromEntries(plan.map((p) => [p.itemId, [p.issuedQty ?? 0, p.returnedQty ?? 0]]));
  }

  describe("kembalikanBahan", () => {
    it("kain 20 m kembali → stok 160 m, harga rata-rata 34.375 (dinilai 30.000 per meter, bukan 35.000), satu ADJ POSITIVE, rencana & jejak tercatat", async () => {
      woId = await woBerbahan();
      const hasil = await kembalikanBahan({
        woId,
        baris: [
          { itemId: kainId, qty: "20" },
          { itemId: kancingId, qty: 0 },
        ],
        catatan: "sisa potong",
        kunci: kunciBaru(),
      });
      expect(hasil).toMatchObject({
        ok: true,
        ulangan: false,
        totalNilai: 600_000,
        baris: [{ itemId: kainId, qty: 20, hargaSatuan: 30_000, nilai: 600_000 }],
      });
      expect(await stok(kainId)).toEqual([{ qty: 160, avg: 34_375, nilai: 5_500_000 }]);
      expect(await stok(kancingId)).toEqual([{ qty: 300, avg: 1_000, nilai: 300_000 }]);

      const adj = await prisma.stockAdjustment.findMany({
        where: { itemId: seededId(kainId), source: "WO_MATERIAL_RETURN" },
        select: { type: true, qtyChange: true, prevQty: true, newQty: true, prevAvgCost: true, newAvgCost: true, externalRef: true, createdById: true },
      });
      expect(adj.map((a) => ({ ...a, qtyChange: Number(a.qtyChange), prevQty: Number(a.prevQty), newQty: Number(a.newQty), prevAvgCost: Number(a.prevAvgCost), newAvgCost: Number(a.newAvgCost) }))).toEqual([
        { type: "POSITIVE", qtyChange: 20, prevQty: 140, newQty: 160, prevAvgCost: 35_000, newAvgCost: 34_375, externalRef: woId, createdById: userId },
      ]);
      expect(await rencanaKembali(woId)).toEqual({ [kainId]: [60, 20], [kancingId]: [200, 0] });
      const jejak = await prisma.auditLog.findMany({
        where: { entityType: "WorkOrder", entityId: seededId(woId), action: "WO_MATERIAL_RETURNED" },
        select: { reason: true },
      });
      expect(jejak).toEqual([{ reason: "sisa potong" }]);

      const ringkasan = await getBahanWo(woId);
      expect(ringkasan?.baris.map((b) => [b.nama, b.perPcs, b.rencana, b.keluar, b.kembali, b.diCmt])).toEqual([
        ["Kain katun uji", 0.75, 60, 60, 20, 40],
        ["Kancing uji", 2.5, 200, 200, 0, 200],
      ]);
      expect(ringkasan?.riwayat.map((r) => [r.nama, r.qty, r.hargaSatuan, r.nilai, r.catatan])).toEqual([
        ["Kain katun uji", 20, 30_000, 600_000, "sisa potong"],
      ]);
    });

    it("melebihi sisa di CMT (41 dari 40) → MELEBIHI_SISA beserta sisanya, stok tidak bergerak", async () => {
      woId = await woBerbahan();
      expect(await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 20 }], kunci: kunciBaru() })).toMatchObject({ ok: true });
      expect(await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 40.01 }], kunci: kunciBaru() })).toEqual({
        ok: false,
        code: "MELEBIHI_SISA",
        itemId: kainId,
        sisa: 40,
      });
      expect(await stok(kainId)).toEqual([{ qty: 160, avg: 34_375, nilai: 5_500_000 }]);
    });

    it("isian yang sama dikirim ulang (kunci sama) → hasil pertama, nomor ADJ sama, stok hanya naik sekali", async () => {
      woId = await woBerbahan();
      const kunci = kunciBaru();
      const pertama = await kembalikanBahan({ woId, baris: [{ itemId: kancingId, qty: 50 }], kunci });
      const kedua = await kembalikanBahan({ woId, baris: [{ itemId: kancingId, qty: 50 }], kunci });
      expect(pertama).toMatchObject({ ok: true, ulangan: false });
      expect(kedua).toMatchObject({ ok: true, ulangan: true, totalNilai: 50_000 });
      if (pertama.ok && kedua.ok) expect(kedua.baris[0].docNumber).toBe(pertama.baris[0].docNumber);
      expect(await stok(kancingId)).toEqual([{ qty: 350, avg: 1_000, nilai: 350_000 }]);
    });

    it("barang yang tidak pernah keluar ke WO → BUKAN_BAHAN_WO; tanpa izin kelola → TANPA_AKSES", async () => {
      woId = await woBerbahan();
      expect(await kembalikanBahan({ woId, baris: [{ itemId: fgId, qty: 1 }], kunci: kunciBaru() })).toMatchObject({
        ok: false,
        code: "BUKAN_BAHAN_WO",
      });
      sesi.izin = ["work_orders:view"];
      expect(await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 1 }], kunci: kunciBaru() })).toEqual({
        ok: false,
        code: "TANPA_AKSES",
      });
      expect(await stok(kainId)).toEqual([{ qty: 140, avg: 35_000, nilai: 4_900_000 }]);
    });
  });

  describe("harga bila kartu stok tidak menyimpan nilai pengeluaran (keputusan pemilik 2026-11-01)", () => {
    /**
     * Contoh pemilik: SPK kemeja 20 pcs, kain 10 m keluar saat gudang @ 30.000 (dokumen
     * menulis 10 × 30.000 = Rp 300.000). Sesudahnya gudang 50 m @ 35.000 = Rp 1.750.000.
     */
    async function woKain10() {
      urut += 1;
      const docNumber = `WO-KB-${token}-${urut}`;
      const wo = await prisma.workOrder.create({
        data: {
          docNumber,
          vendorId,
          finishedGoodId: fgId,
          plannedQty: 20,
          consumptionPlan: JSON.stringify([
            { itemId: kainId, itemName: "Kain katun uji", uomCode: "MTR", qtyRequired: 0.5, wastePercent: 0, plannedQty: 10 },
          ]),
          createdById: userId,
          status: "ISSUED",
          issuedAt: new Date(),
        },
        select: { id: true },
      });
      woIds.push(wo.id);
      await issueMaterials({ woId: wo.id, items: [{ itemId: kainId, qty: 10, uomId: uomMtrId }], issueType: "FABRIC", isPartial: false }, userId);
      await prisma.inventoryValue.updateMany({
        where: { itemId: seededId(kainId) },
        data: { qtyOnHand: 50, avgCost: 35_000, totalValue: 1_750_000 },
      });
      const issue = await prisma.materialIssue.findFirstOrThrow({
        where: { woId: seededId(wo.id) },
        select: { id: true, docNumber: true },
      });
      return { id: wo.id, docNumber, issueId: issue.id, issueDoc: issue.docNumber };
    }

    /** Kartu stok pengeluaran ini kehilangan nilainya (baris ada, nilai tidak tercatat). */
    async function hapusNilaiKartuStok(issueId: string) {
      const n = await prisma.stockLedgerEntry.updateMany({
        where: { refType: "MaterialIssue", refId: seededId(issueId) },
        data: { totalCost: null, unitCost: null, balanceValue: null },
      });
      expect(n.count).toBeGreaterThan(0);
    }

    /** Dokumen pengeluaran ini tidak lagi mencantumkan harga per baris. */
    async function hapusHargaDokumen(issueId: string) {
      const issue = await prisma.materialIssue.findUniqueOrThrow({ where: { id: seededId(issueId) }, select: { items: true } });
      const mentah: unknown = typeof issue.items === "string" ? JSON.parse(issue.items) : issue.items;
      const baris = (mentah as Array<Record<string, unknown>>).map((b) => {
        const salin = { ...b };
        delete salin.avgCostAtIssue;
        return salin;
      });
      await prisma.materialIssue.update({ where: { id: seededId(issueId) }, data: { items: JSON.stringify(baris) } });
    }

    const penyesuaianKembali = (id: string) =>
      prisma.stockAdjustment.findMany({
        where: { itemId: seededId(kainId), source: "WO_MATERIAL_RETURN", externalRef: seededId(id) },
        select: { reason: true },
      });

    it("kartu stok menyimpan nilai → jalur biasa: 2 m kembali @ 30.000 = Rp 60.000, gudang 52 m @ 34.807,69 senilai Rp 1.810.000, tanpa tanda harga dokumen", async () => {
      const wo = await woKain10();
      woId = wo.id;
      const hasil = await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 2 }], kunci: kunciBaru() });
      expect(hasil).toMatchObject({
        ok: true,
        ulangan: false,
        dibatasi: false,
        totalNilai: 60_000,
        barangHargaDokumen: [],
        baris: [{ itemId: kainId, qty: 2, hargaSatuan: 30_000, nilai: 60_000, hargaDariDokumen: false }],
      });
      expect(await stok(kainId)).toEqual([{ qty: 52, avg: 34_807.69, nilai: 1_810_000 }]);
      expect((await penyesuaianKembali(woId)).map((a) => a.reason)).toEqual([`Kembali bahan ${wo.docNumber} @ 30000.00 dari Penjahit uji`]);
    });

    it("nilai kartu stok tidak tercatat, dokumen menulis Rp 30.000 → dinilai harga dokumen: Rp 60.000, gudang 52 m @ 34.807,69 (sama dengan jalur biasa), ditandai di hasil, riwayat, jejak, dan kiriman ulang", async () => {
      const wo = await woKain10();
      woId = wo.id;
      await hapusNilaiKartuStok(wo.issueId);
      const kunci = kunciBaru();
      const hasil = await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 2 }], catatan: "sisa potong", kunci });
      expect(hasil).toMatchObject({
        ok: true,
        ulangan: false,
        dibatasi: false,
        totalNilai: 60_000,
        barangHargaDokumen: [kainId],
        baris: [{ itemId: kainId, qty: 2, hargaSatuan: 30_000, nilai: 60_000, hargaDariDokumen: true }],
      });
      expect(await stok(kainId)).toEqual([{ qty: 52, avg: 34_807.69, nilai: 1_810_000 }]);
      expect((await penyesuaianKembali(woId)).map((a) => a.reason)).toEqual([
        `Kembali bahan ${wo.docNumber} @ 30000.00 (harga dokumen) dari Penjahit uji — sisa potong`,
      ]);

      const ulang = await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 2 }], catatan: "sisa potong", kunci });
      expect(ulang).toMatchObject({ ok: true, ulangan: true, totalNilai: 60_000, barangHargaDokumen: [kainId] });
      expect(await stok(kainId)).toEqual([{ qty: 52, avg: 34_807.69, nilai: 1_810_000 }]);

      const jejak = await prisma.auditLog.findMany({
        where: { entityType: "WorkOrder", entityId: seededId(woId), action: "WO_MATERIAL_RETURNED" },
        select: { metadata: true },
      });
      expect(jejak.map((j) => j.metadata)).toEqual([
        expect.objectContaining({ totalNilai: 60_000, barangHargaDokumen: [kainId], barangTanpaHarga: [] }),
      ]);
      const ringkasan = await getBahanWo(woId);
      expect(ringkasan?.riwayat.map((r) => [r.qty, r.hargaSatuan, r.nilai, r.hargaDariDokumen, r.catatan])).toEqual([
        [2, 30_000, 60_000, true, "sisa potong"],
      ]);
      expect(ringkasan?.baris.map((b) => [b.keluar, b.kembali, b.diCmt])).toEqual([[10, 2, 8]]);
    });

    it("tidak ada catatan kartu stok sama sekali (data di luar layar), dokumen menulis Rp 30.000 → tetap dinilai harga dokumen", async () => {
      const wo = await woKain10();
      woId = wo.id;
      await prisma.stockLedgerEntry.deleteMany({ where: { refType: "MaterialIssue", refId: seededId(wo.issueId) } });
      const hasil = await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 2 }], kunci: kunciBaru() });
      expect(hasil).toMatchObject({ ok: true, totalNilai: 60_000, barangHargaDokumen: [kainId], baris: [{ hargaSatuan: 30_000, hargaDariDokumen: true }] });
      expect(await stok(kainId)).toEqual([{ qty: 52, avg: 34_807.69, nilai: 1_810_000 }]);
    });

    it("harga dokumen untuk bahan bervarian → kembali ke baris varian asal pengeluarannya, baris gabungan tidak bergerak", async () => {
      const wo = await woKain10();
      woId = wo.id;
      // Pengeluaran ini tercatat keluar dari varian KAIN-HITAM (sisa 5 m @ 30.000 di gudang).
      const pindah = await prisma.stockLedgerEntry.updateMany({
        where: { refType: "MaterialIssue", refId: seededId(wo.issueId) },
        data: { variantSku: "KAIN-HITAM" },
      });
      expect(pindah.count).toBeGreaterThan(0);
      await prisma.inventoryValue.create({
        data: { itemId: kainId, variantSku: "KAIN-HITAM", qtyOnHand: 5, avgCost: 30_000, totalValue: 150_000 },
      });
      await hapusNilaiKartuStok(wo.issueId);

      const hasil = await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 2 }], kunci: kunciBaru() });
      expect(hasil).toMatchObject({
        ok: true,
        totalNilai: 60_000,
        barangHargaDokumen: [kainId],
        baris: [{ itemId: kainId, qty: 2, hargaSatuan: 30_000, nilai: 60_000, hargaDariDokumen: true }],
      });

      const baris = await prisma.inventoryValue.findMany({
        where: { itemId: seededId(kainId) },
        select: { variantSku: true, qtyOnHand: true, avgCost: true, totalValue: true },
      });
      const perVarian = Object.fromEntries(
        baris.map((r) => [r.variantSku ?? "", { qty: Number(r.qtyOnHand), avg: Number(r.avgCost), nilai: Number(r.totalValue) }]),
      );
      // 5 m @ 30.000 + 2 m @ 30.000 → 7 m @ 30.000; baris gabungan tetap 50 m @ 35.000.
      expect(perVarian).toEqual({
        "": { qty: 50, avg: 35_000, nilai: 1_750_000 },
        "KAIN-HITAM": { qty: 7, avg: 30_000, nilai: 210_000 },
      });
    });

    it("harga dokumen + catatan sepanjang batas (120 karakter) → catatan di riwayat utuh, alasan muat di kolomnya; yang dipendekkan nama CMT", async () => {
      const wo = await woKain10();
      woId = wo.id;
      await hapusNilaiKartuStok(wo.issueId);
      const catatan =
        "Sisa potong kain katun combed 30s warna navy dari meja 3, dihitung ulang bersama kepala produksi CMT, cocok dengan nota.";
      expect(catatan.length).toBe(120);
      const hasil = await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 2 }], catatan, kunci: kunciBaru() });
      expect(hasil).toMatchObject({ ok: true, totalNilai: 60_000, barangHargaDokumen: [kainId] });

      const [penyesuaian] = await penyesuaianKembali(woId);
      expect(penyesuaian.reason.length).toBeLessThanOrEqual(190);
      expect(penyesuaian.reason.startsWith(`Kembali bahan ${wo.docNumber} @ 30000.00 (harga dokumen)`)).toBe(true);
      expect(penyesuaian.reason.endsWith(` — ${catatan}`)).toBe(true);
      const ringkasan = await getBahanWo(woId);
      expect(ringkasan?.riwayat.map((r) => [r.hargaSatuan, r.hargaDariDokumen, r.catatan])).toEqual([[30_000, true, catatan]]);
    });

    it("kartu stok tanpa nilai DAN dokumen tanpa harga → HARGA_KELUAR_TIDAK_DIKETAHUI menyebut dokumennya; stok, sisa di CMT, dan jejak tidak berubah", async () => {
      const wo = await woKain10();
      woId = wo.id;
      await hapusNilaiKartuStok(wo.issueId);
      await hapusHargaDokumen(wo.issueId);
      expect(await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 2 }], kunci: kunciBaru() })).toEqual({
        ok: false,
        code: "HARGA_KELUAR_TIDAK_DIKETAHUI",
        itemId: kainId,
        dokumen: [wo.issueDoc],
      });
      expect(await stok(kainId)).toEqual([{ qty: 50, avg: 35_000, nilai: 1_750_000 }]);
      expect(await penyesuaianKembali(woId)).toEqual([]);
      expect(await prisma.auditLog.count({ where: { entityId: seededId(woId), action: "WO_MATERIAL_RETURNED" } })).toBe(0);
      expect((await getBahanWo(woId))?.baris.map((b) => b.diCmt)).toEqual([10]);
    });

    it("tanpa harga di keduanya tetapi seluruh biaya bahan sudah dibebankan ke barang jadi (batas Rp 0) → tidak ditolak: kembali senilai Rp 0, dibatasi", async () => {
      const wo = await woKain10();
      woId = wo.id;
      expect(await terimaBarangJadi({ woId, qtyReceived: 20, qtyRejected: 0 })).toMatchObject({ ok: true });
      await hapusNilaiKartuStok(wo.issueId);
      await hapusHargaDokumen(wo.issueId);
      const hasil = await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 2 }], kunci: kunciBaru() });
      expect(hasil).toMatchObject({
        ok: true,
        dibatasi: true,
        totalNilai: 0,
        barangHargaDokumen: [],
        baris: [{ itemId: kainId, qty: 2, hargaSatuan: 0, nilai: 0, hargaDariDokumen: false }],
      });
      // 50 m @ 35.000 + 2 m @ 0 → 52 m, nilai tetap Rp 1.750.000 (rata-rata 33.653,85).
      expect(await stok(kainId)).toEqual([{ qty: 52, avg: 33_653.85, nilai: 1_750_000 }]);
      const jejak = await prisma.auditLog.findMany({
        where: { entityType: "WorkOrder", entityId: seededId(woId), action: "WO_MATERIAL_RETURNED" },
        select: { metadata: true },
      });
      expect(jejak.map((j) => j.metadata)).toEqual([
        expect.objectContaining({ dibatasi: true, batasNilai: 0, totalNilai: 0, barangTanpaHarga: [kainId] }),
      ]);
    });
  });

  describe("biaya barang jadi sesudah bahan kembali", () => {
    it("bahan keluar Rp 2.000.000 (kain 60 m @ 30.000 + kancing 200 @ 1.000), kain 20 m kembali (Rp 600.000) → terima 80 pcs memikul Rp 1.400.000", async () => {
      woId = await woBerbahan();
      await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 20 }], kunci: kunciBaru() });
      const hasil = await terimaBarangJadi({ woId, qtyReceived: 80, qtyRejected: 0 });
      expect(hasil).toMatchObject({ ok: true });
      const terima = await prisma.fGReceipt.findMany({
        where: { woId: seededId(woId) },
        select: { totalCostValue: true, avgCostPerUnit: true },
      });
      expect(terima.map((r) => [Number(r.totalCostValue), Number(r.avgCostPerUnit)])).toEqual([[1_400_000, 17_500]]);
    });

    it("sesudah penerimaan penutup (80 pcs memikul Rp 2.000.000) sisa kain 20 m kembali bernilai 0 — stok 160 m, nilai tetap Rp 4.900.000, tidak terhitung dua kali", async () => {
      woId = await woBerbahan();
      expect(await terimaBarangJadi({ woId, qtyReceived: 80, qtyRejected: 0 })).toMatchObject({ ok: true });
      const kunci = kunciBaru();
      const hasil = await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 20 }], kunci });
      expect(hasil).toMatchObject({ ok: true, ulangan: false, dibatasi: true, totalNilai: 0, baris: [{ qty: 20, hargaSatuan: 0, nilai: 0 }] });
      // 140 m @ 35.000 + 20 m @ 0 → 160 m, nilai Rp 4.900.000 (rata-rata 30.625).
      expect(await stok(kainId)).toEqual([{ qty: 160, avg: 30_625, nilai: 4_900_000 }]);
      expect(await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 20 }], kunci })).toMatchObject({
        ok: true,
        ulangan: true,
        dibatasi: true,
        totalNilai: 0,
      });
      const jejak = await prisma.auditLog.findMany({
        where: { entityType: "WorkOrder", entityId: seededId(woId), action: "WO_MATERIAL_RETURNED" },
        select: { metadata: true },
      });
      expect(jejak.map((j) => j.metadata)).toEqual([
        expect.objectContaining({ dibatasi: true, nilaiPenuh: 600_000, batasNilai: 0, totalNilai: 0 }),
      ]);
    });

    it("terima 70 dari 80 (Rp 1.750.000 dibebankan) → kain 20 m + kancing 50 kembali dibatasi Rp 250.000; penerimaan penutup memikul sisanya, Σ barang jadi + bahan kembali = Rp 2.000.000 persis", async () => {
      woId = await woBerbahan();
      expect(await terimaBarangJadi({ woId, qtyReceived: 70, qtyRejected: 0 })).toMatchObject({ ok: true });
      const hasil = await kembalikanBahan({
        woId,
        baris: [
          { itemId: kainId, qty: 20 },
          { itemId: kancingId, qty: 50 },
        ],
        kunci: kunciBaru(),
      });
      // Nilai penuh 650.000 > batas 250.000: harga × 250.000/650.000, dibulatkan ke bawah ke sen.
      expect(hasil).toMatchObject({
        ok: true,
        dibatasi: true,
        totalNilai: 249_999.7,
        baris: [
          { itemId: kainId, qty: 20, hargaSatuan: 11_538.46, nilai: 230_769.2 },
          { itemId: kancingId, qty: 50, hargaSatuan: 384.61, nilai: 19_230.5 },
        ],
      });
      expect(await terimaBarangJadi({ woId, qtyReceived: 10, qtyRejected: 0 })).toMatchObject({ ok: true });
      const terima = await prisma.fGReceipt.findMany({
        where: { woId: seededId(woId) },
        select: { totalCostValue: true },
        orderBy: { receivedAt: "asc" },
      });
      const biaya = terima.map((r) => Number(r.totalCostValue));
      expect(biaya).toEqual([1_750_000, 0.3]);
      expect(biaya.reduce((s, x) => s + x, 0) + 249_999.7).toBeCloseTo(2_000_000, 2);
    });

    it("sebelum ada penerimaan tidak dibatasi: kembali dinilai harga keluarnya (dibatasi = false)", async () => {
      woId = await woBerbahan();
      expect(await kembalikanBahan({ woId, baris: [{ itemId: kancingId, qty: 10 }], kunci: kunciBaru() })).toMatchObject({
        ok: true,
        dibatasi: false,
        totalNilai: 10_000,
      });
    });

    it("cacat melebihi setoran (atau negatif) → CACAT_MELEBIHI_SETORAN, tidak ada penerimaan tercatat", async () => {
      woId = await woBerbahan();
      expect(await terimaBarangJadi({ woId, qtyReceived: 30, qtyRejected: 32 })).toEqual({ ok: false, code: "CACAT_MELEBIHI_SETORAN" });
      expect(await terimaBarangJadi({ woId, qtyReceived: 30, qtyRejected: -2 })).toEqual({ ok: false, code: "CACAT_MELEBIHI_SETORAN" });
      expect(await prisma.fGReceipt.count({ where: { woId: seededId(woId) } })).toBe(0);
      expect(await terimaBarangJadi({ woId, qtyReceived: 30, qtyRejected: 30 })).toMatchObject({ ok: true });
    });
  });

  describe("pembatalan sesudah bahan keluar", () => {
    it("masih ada bahan di CMT → WO_SUDAH_KELUAR_BAHAN menyebut sisanya; sesudah semua kembali → batal berhasil dan tercatat", async () => {
      woId = await woBerbahan();
      await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 20 }], kunci: kunciBaru() });

      expect(await cancelWorkOrder(woId, userId, "pesanan dibatalkan pembeli")).toEqual({
        ok: false,
        code: "WO_SUDAH_KELUAR_BAHAN",
        sisa: [
          { nama: "Kain katun uji", qty: 40, satuan: expect.any(String) },
          { nama: "Kancing uji", qty: 200, satuan: expect.any(String) },
        ],
      });

      expect(
        await kembalikanBahan({
          woId,
          baris: [
            { itemId: kainId, qty: 40 },
            { itemId: kancingId, qty: 200 },
          ],
          kunci: kunciBaru(),
        }),
      ).toMatchObject({ ok: true, totalNilai: 1_400_000 });
      // Kain kembali seluruhnya: 140 + 20 + 40 = 200 m; kancing 300 + 200 = 500.
      expect((await stok(kainId))[0].qty).toBe(200);
      expect(await stok(kancingId)).toEqual([{ qty: 500, avg: 1_000, nilai: 500_000 }]);

      expect(await cancelWorkOrder(woId, userId, "pesanan dibatalkan pembeli")).toEqual({ ok: true });
      const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: seededId(woId) }, select: { status: true, canceledReason: true } });
      expect(wo).toEqual({ status: "CANCELLED", canceledReason: "pesanan dibatalkan pembeli" });
      const jejak = await prisma.auditLog.count({ where: { entityId: seededId(woId), action: "WO_CANCELLED" } });
      expect(jejak).toBe(1);

      expect(await kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 1 }], kunci: kunciBaru() })).toEqual({
        ok: false,
        code: "WO_SUDAH_DIBATALKAN",
      });
    });

    it("alasan kosong → ALASAN_WAJIB, WO tidak berubah", async () => {
      woId = await woBerbahan();
      expect(await cancelWorkOrder(woId, userId, "   ")).toEqual({ ok: false, code: "ALASAN_WAJIB" });
      expect(await cancelWorkOrder(woId, userId)).toEqual({ ok: false, code: "ALASAN_WAJIB" });
    });
  });

  describe("balapan", () => {
    it("dua pengembalian serentak 40 m dari sisa 60 m (kunci berbeda) → satu berhasil, satu MELEBIHI_SISA (sisa 20); stok naik 40 sekali", async () => {
      woId = await woBerbahan();
      const hasil = await Promise.all([
        kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 40 }], kunci: kunciBaru() }),
        kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 40 }], kunci: kunciBaru() }),
      ]);
      const berhasil = hasil.filter((h) => h.ok);
      expect(berhasil).toHaveLength(1);
      expect(hasil.find((h) => !h.ok)).toEqual({ ok: false, code: "MELEBIHI_SISA", itemId: kainId, sisa: 20 });
      expect((await stok(kainId))[0].qty).toBe(180);
      const adj = await prisma.stockAdjustment.count({ where: { itemId: seededId(kainId), source: "WO_MATERIAL_RETURN" } });
      expect(adj).toBe(1);
    });

    it("pengembalian membaca WO lalu tertahan, penerimaan penutup commit selama itu → tidak pernah terhitung dua kali: Σ biaya barang jadi + nilai bahan kembali = Rp 2.000.000", async () => {
      woId = await woBerbahan();
      const [kembali, terima] = await balapan(
        () => kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 20 }], kunci: kunciBaru() }),
        () => terimaBarangJadi({ woId, qtyReceived: 80, qtyRejected: 0 }),
      );
      expect(kembali).toMatchObject({ status: "fulfilled", value: { ok: true } });
      expect(terima).toMatchObject({ status: "fulfilled", value: { ok: true } });
      const biayaFg = (await prisma.fGReceipt.findMany({ where: { woId: seededId(woId) }, select: { totalCostValue: true } })).reduce(
        (s, r) => s + Number(r.totalCostValue),
        0,
      );
      const hasilKembali = kembali.status === "fulfilled" ? (kembali.value as Awaited<ReturnType<typeof kembalikanBahan>>) : null;
      const nilaiKembali = hasilKembali?.ok ? hasilKembali.totalNilai : NaN;
      expect(biayaFg + nilaiKembali).toBeCloseTo(2_000_000, 2);
    });

    it("klik ganda (kunci sama, serentak) → satu catatan, keduanya melihat nomor ADJ yang sama", async () => {
      woId = await woBerbahan();
      const kunci = kunciBaru();
      const [a, b] = await Promise.all([
        kembalikanBahan({ woId, baris: [{ itemId: kancingId, qty: 120 }], kunci }),
        kembalikanBahan({ woId, baris: [{ itemId: kancingId, qty: 120 }], kunci }),
      ]);
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect(a.baris[0].docNumber).toBe(b.baris[0].docNumber);
        expect([a.ulangan, b.ulangan].sort()).toEqual([false, true]);
      }
      expect(await stok(kancingId)).toEqual([{ qty: 420, avg: 1_000, nilai: 420_000 }]);
    });

    it("batal membaca WO lalu tertahan, pengembalian seluruh bahan commit duluan → batal tertata SEBELUM pengembalian (ditolak, sisa penuh); sesudahnya batal berhasil", async () => {
      woId = await woBerbahan();
      const [batal, kembali] = await balapan(
        () => cancelWorkOrder(woId, userId, "uji balapan"),
        () =>
          kembalikanBahan({
            woId,
            baris: [
              { itemId: kainId, qty: 60 },
              { itemId: kancingId, qty: 200 },
            ],
            kunci: kunciBaru(),
          }),
      );
      expect(kembali).toMatchObject({ status: "fulfilled", value: { ok: true } });
      // Pembatalan membaca keadaan sebelum pengembalian commit: urutan serialnya
      // batal → kembali, jadi ia menolak dengan sisa penuh. Tidak pernah ada WO
      // batal yang bahannya masih di CMT.
      expect(batal).toMatchObject({
        status: "fulfilled",
        value: { ok: false, code: "WO_SUDAH_KELUAR_BAHAN", sisa: [{ qty: 60 }, { qty: 200 }] },
      });
      expect((await getBahanWo(woId))?.adaDiCmt).toBe(false);
      expect(await cancelWorkOrder(woId, userId, "uji balapan")).toEqual({ ok: true });
      const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: seededId(woId) }, select: { status: true } });
      expect(wo.status).toBe("CANCELLED");
    });

    it("pengembalian membaca WO lalu tertahan, batal berjalan selama itu → batal ditolak (bahan masih di CMT), pengembalian tetap tercatat", async () => {
      woId = await woBerbahan();
      const [kembali, batal] = await balapan(
        () => kembalikanBahan({ woId, baris: [{ itemId: kainId, qty: 10 }], kunci: kunciBaru() }),
        () => cancelWorkOrder(woId, userId, "uji balapan"),
      );
      expect(kembali).toMatchObject({ status: "fulfilled", value: { ok: true } });
      expect(batal).toMatchObject({ status: "fulfilled", value: { ok: false, code: "WO_SUDAH_KELUAR_BAHAN" } });
      const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: seededId(woId) }, select: { status: true } });
      expect(wo.status).toBe("IN_PRODUCTION");
    });
  });
});
