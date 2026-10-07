import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Kunci pengeluaran bahan pindah dari `AuditLog.metadata` ke kolom unik
 * `MaterialIssue.idempotencyKey` (`<woId>:<kunci>`) — basis data uji nyata,
 * `keluarkanBahan` sungguhan, sesi ditiru.
 *
 * - Kunci baru dicatat di kolom; kiriman ulang dikembalikan dari kolom.
 * - Pengeluaran LAMA yang kuncinya hanya ada di AuditLog tetap dikenali.
 * - Dua kiriman kembar yang lolos pembacaan kunci bentrok di indeks unik; yang
 *   kalah membaca pemenangnya (bukan GAGAL, bukan bahan keluar dua kali).
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

/*
 * `sembunyikan`: sebanyak itu pembacaan kunci berikutnya (kolom `materialIssue.findUnique`
 * dan jejak `auditLog.findMany`) menjawab "tidak ada" — meniru pembacaan yang terjadi
 * sebelum kembarannya commit, supaya kunci baru bentrok di indeks unik (P2002).
 */
const tiru = vi.hoisted(() => ({ sembunyikanKolom: 0, sembunyikanJejak: 0 }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  type Fungsi = (...args: unknown[]) => unknown;
  const ikat = (t: object, v: unknown) => (typeof v === "function" ? (v as Fungsi).bind(t) : v);
  const bungkus = (delegasi: object, metode: string, sisa: "sembunyikanKolom" | "sembunyikanJejak", kosong: unknown) =>
    new Proxy(delegasi, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p !== metode || typeof v !== "function") return ikat(t, v);
        return async (...args: unknown[]) => {
          if (tiru[sisa] > 0) {
            tiru[sisa] -= 1;
            return kosong;
          }
          return (v as Fungsi).apply(t, args);
        };
      },
    });
  const bungkusKlien = (k: object) =>
    new Proxy(k, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p === "materialIssue" && v && typeof v === "object") return bungkus(v, "findUnique", "sembunyikanKolom", null);
        if (p === "auditLog" && v && typeof v === "object") return bungkus(v, "findMany", "sembunyikanJejak", []);
        if (p === "$transaction" && typeof v === "function") {
          return (arg: unknown, opsi?: unknown) =>
            typeof arg === "function"
              ? (v as Fungsi).call(t, (tx: object) => (arg as Fungsi)(bungkusKlien(tx)), opsi)
              : (v as Fungsi).call(t, arg, opsi);
        }
        return ikat(t, v);
      },
    });
  return { ...asli, prisma: bungkusKlien(asli.prisma) };
});

const { keluarkanBahan } = await import("./production");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("kunci pengeluaran bahan di kolom MaterialIssue (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let kancingId = "";
  let urut = 0;
  const woIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    kancingId = "";
    userId = (
      await prisma.user.create({ data: { email: `kunci-bahan-${token}@uji.local`, name: "Produksi uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TKB-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (
      await prisma.supplier.create({ data: { code: `CMT-KB-${token}`, name: "CMT uji", typeId }, select: { id: true } })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `B${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    fgId = (
      await prisma.item.create({
        data: { sku: `FG-KB-${token}`, nameId: "Kemeja uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    kancingId = (
      await prisma.item.create({
        data: { sku: `KC-KB-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  async function buatWo() {
    urut += 1;
    const wo = await prisma.workOrder.create({
      data: {
        docNumber: `WO-KB-${token}-${urut}`,
        vendorId,
        finishedGoodId: fgId,
        plannedQty: 100,
        consumptionPlan: JSON.stringify([
          { itemId: kancingId, itemName: "Kancing uji", qtyRequired: 1, wastePercent: 0, plannedQty: 100, issuedQty: 0, returnedQty: 0 },
        ]),
        createdById: userId,
        status: "ISSUED",
        issuedAt: new Date(),
      },
      select: { id: true },
    });
    woIds.push(wo.id);
    return wo.id;
  }

  beforeEach(async () => {
    sesi.id = userId;
    sesi.izin = ["*"];
    tiru.sembunyikanKolom = 0;
    tiru.sembunyikanJejak = 0;
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
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds([kancingId, fgId]) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kancingId, fgId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  const kancing = (woId: string, qty: number, kunci?: string) => ({
    woId,
    items: [{ itemId: kancingId, qty, uomId }],
    issueType: "ACCESSORIES" as const,
    isPartial: false,
    ...(kunci ? { idempotencyKey: kunci } : {}),
  });

  async function stok() {
    const baris = await prisma.inventoryValue.findMany({ where: { itemId: seededId(kancingId) }, select: { qtyOnHand: true } });
    return baris.reduce((t, b) => t + Number(b.qtyOnHand), 0);
  }

  const pengeluaran = (woId: string) =>
    prisma.materialIssue.findMany({ where: { woId: seededId(woId) }, select: { id: true, idempotencyKey: true } });

  it("kunci dicatat di kolom sebagai <woId>:<kunci>; tanpa kunci = kolom kosong", async () => {
    const woId = await buatWo();
    const kunci = `kunci-kolom-${token}-a`;
    const a = await keluarkanBahan(kancing(woId, 10, kunci));
    const b = await keluarkanBahan(kancing(woId, 5));
    expect(a.ok && b.ok).toBe(true);
    const baris = await pengeluaran(woId);
    expect(Object.fromEntries(baris.map((r) => [r.id, r.idempotencyKey]))).toEqual({
      [a.ok ? a.id : ""]: `${woId}:${kunci}`,
      [b.ok ? b.id : ""]: null,
    });
  });

  it("kiriman ulang dikenali dari KOLOM walau jejak AuditLog-nya tidak ada", async () => {
    const woId = await buatWo();
    const kunci = `kunci-kolom-${token}-b`;
    const pertama = await keluarkanBahan(kancing(woId, 10, kunci));
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(woId), action: "MATERIAL_ISSUED" } });
    expect(await keluarkanBahan(kancing(woId, 10, kunci))).toEqual(pertama);
    expect(await stok()).toBe(90);
    expect(await pengeluaran(woId)).toHaveLength(1);
  });

  it("pengeluaran LAMA (kunci hanya di AuditLog, kolom kosong) tetap dikenali saat dikirim ulang", async () => {
    const woId = await buatWo();
    const kunci = `kunci-kolom-${token}-c`;
    const pertama = await keluarkanBahan(kancing(woId, 10, kunci));
    if (!pertama.ok) throw new Error("pengeluaran pertama gagal");
    // Bentuk data sebelum 2026-10-06: kolom kosong, kunci hanya di jejak.
    await prisma.materialIssue.update({ where: { id: seededId(pertama.id) }, data: { idempotencyKey: null } });
    expect(await keluarkanBahan(kancing(woId, 10, kunci))).toEqual(pertama);
    expect(await stok()).toBe(90);
    expect(await pengeluaran(woId)).toHaveLength(1);
  });

  it("kembaran yang lolos pembacaan kunci bentrok di indeks unik → hasil pertama, bukan GAGAL; bahan keluar sekali", async () => {
    const woId = await buatWo();
    const kunci = `kunci-kolom-${token}-d`;
    const pertama = await keluarkanBahan(kancing(woId, 10, kunci));
    tiru.sembunyikanKolom = 1;
    tiru.sembunyikanJejak = 1;
    const kedua = await keluarkanBahan(kancing(woId, 10, kunci));
    expect(tiru).toEqual({ sembunyikanKolom: 0, sembunyikanJejak: 0 });
    expect(kedua).toEqual(pertama);
    expect(await stok()).toBe(90);
    expect(await pengeluaran(woId)).toHaveLength(1);
  });

  it("Promise.all tiga kiriman berkunci sama → satu pengeluaran, stok 90", async () => {
    const woId = await buatWo();
    const kunci = `kunci-kolom-${token}-e`;
    const hasil = await Promise.all([1, 2, 3].map(() => keluarkanBahan(kancing(woId, 10, kunci))));
    expect(hasil.every((h) => h.ok)).toBe(true);
    expect(new Set(hasil.map((h) => (h.ok ? h.id : "")))).toHaveProperty("size", 1);
    expect(await stok()).toBe(90);
    expect(await pengeluaran(woId)).toHaveLength(1);
  });

  it("kunci yang sama di WO lain = isian baru (kolom berisi woId masing-masing)", async () => {
    const woA = await buatWo();
    const woB = await buatWo();
    const kunci = `kunci-kolom-${token}-f`;
    const a = await keluarkanBahan(kancing(woA, 10, kunci));
    const b = await keluarkanBahan(kancing(woB, 10, kunci));
    expect(a.ok && b.ok && a.id !== b.id).toBe(true);
    expect(await stok()).toBe(80);
  });
});
