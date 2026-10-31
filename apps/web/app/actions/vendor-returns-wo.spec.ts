import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * `completeReturn` (PROCESSED → COMPLETED) menambah `returnedQty` di rencana
 * bahan WO. Dulu barisnya diulang sebagai `(ret.lines as any[])` padahal
 * kolomnya berisi STRING JSON — perulangan berjalan per huruf, tidak satu baris
 * pun cocok, dan `returnedQty` WO tidak pernah bertambah.
 */

const sesi = vi.hoisted(() => ({ id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.permissions } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: async () => "Penguji" }));
vi.mock("@/lib/notifications/events", () => ({
  notifyVendorReturnCreated: async () => {},
  notifyVendorReturnStatusUpdated: async () => {},
}));

/* Pembacaan WO di dalam transaksi (`tx.workOrder.findUnique`) bisa ditahan sekali. */
const tunda = vi.hoisted(() => ({ ms: 0, sesudahBaca: [] as Array<() => void> }));
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
          const ms = tunda.ms;
          tunda.ms = 0;
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
      if (p !== "$transaction" || typeof v !== "function") return v;
      return (arg: unknown, opsi?: unknown) =>
        typeof arg === "function"
          ? (v as Fungsi).call(t, (tx: object) => (arg as Fungsi)(bungkusTx(tx)), opsi)
          : (v as Fungsi).call(t, arg, opsi);
    },
  });
  return { ...asli, prisma };
});

const { completeReturn } = await import("./vendor-returns");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const BUKTI = { trackingNumber: "RESI-WO-1", receiptFileUrl: "https://contoh.local/resi.jpg" };

type BarisRencana = { itemId: string; plannedQty: number; issuedQty: number; returnedQty?: number };

d("completeReturn memperbarui returnedQty rencana WO (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let fgId = "";
  let kancingId = "";
  let kainId = "";
  let lainId = "";
  let woId = "";
  let returIds: string[] = [];
  const woIds: string[] = [];
  let urut = 0;

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    fgId = "";
    kancingId = "";
    kainId = "";
    lainId = "";
    userId = (await prisma.user.create({ data: { email: `retur-wo-${token}@uji.local` }, select: { id: true } })).id;
    typeId = (
      await prisma.supplierType.create({ data: { code: `TRW-${token}`, name: `Jenis ${token}` }, select: { id: true } })
    ).id;
    vendorId = (
      await prisma.supplier.create({
        data: { code: `CMT-RW-${token}`, name: "CMT uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({ data: { code: `V${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })
    ).id;
    const barang = async (sku: string, nameId: string, type: "FINISHED_GOOD" | "ACCESSORIES" | "FABRIC") =>
      (
        await prisma.item.create({
          data: { sku: `${sku}-${token}`, nameId, nameEn: nameId, type, uomId },
          select: { id: true },
        })
      ).id;
    fgId = await barang("RW-FG", "Kemeja uji", "FINISHED_GOOD");
    kancingId = await barang("RW-KC", "Kancing uji", "ACCESSORIES");
    kainId = await barang("RW-KN", "Kain uji", "FABRIC");
    lainId = await barang("RW-LN", "Renda uji", "ACCESSORIES");
    sesi.id = userId;
    sesi.permissions = ["vendor_returns:view", "vendor_returns:manage"];
  });

  beforeEach(async () => {
    returIds = [];
    woId = "";
    urut += 1;
    // Rencana disimpan sebagai STRING JSON, sama seperti `createWorkOrder`/`issueMaterials`.
    const rencana: BarisRencana[] = [
      { itemId: kancingId, plannedQty: 20, issuedQty: 20, returnedQty: 0 },
      { itemId: kainId, plannedQty: 50, issuedQty: 50, returnedQty: 1 },
    ];
    woId = (
      await prisma.workOrder.create({
        data: {
          docNumber: `WO-RW-${token}-${urut}`,
          vendorId,
          finishedGoodId: fgId,
          plannedQty: 10,
          consumptionPlan: JSON.stringify(rencana),
          createdById: userId,
          status: "IN_PRODUCTION",
          issuedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
    woIds.push(woId);
  });

  afterEach(async () => {
    tunda.ms = 0;
    tunda.sesudahBaca = [];
    await prisma.auditLog.deleteMany({ where: { entityType: "VendorReturn", entityId: { in: seededIds(returIds) } } });
    await prisma.vendorReturn.deleteMany({ where: { id: { in: seededIds(returIds) } } });
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds(woIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([fgId, kancingId, kainId, lainId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function buatRetur(baris: Array<Record<string, unknown>>, opsi: { tanpaWo?: boolean } = {}) {
    const ret = await prisma.vendorReturn.create({
      data: {
        docNumber: `RET-RW-${token}-${urut}-${returIds.length + 1}`,
        vendorId,
        woId: opsi.tanpaWo ? null : woId,
        lines: JSON.stringify(baris),
        totalItems: baris.length,
        totalValue: 0,
        status: "PROCESSED",
        createdById: userId,
      },
      select: { id: true },
    });
    returIds.push(ret.id);
    return ret.id;
  }

  async function dikembalikan() {
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: seededId(woId) }, select: { consumptionPlan: true } });
    const raw = wo.consumptionPlan;
    const rencana = (typeof raw === "string" ? JSON.parse(raw) : raw) as BarisRencana[];
    return Object.fromEntries(rencana.map((r) => [r.itemId, r.returnedQty ?? 0]));
  }

  async function rencanaWo() {
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: seededId(woId) }, select: { consumptionPlan: true } });
    const raw = wo.consumptionPlan;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as BarisRencana[];
  }

  it("rencana WO ditulis penulis lain (bahan keluar 20 → 30) di antara baca dan tulis completeReturn → keduanya bertahan: issuedQty 30, returnedQty 3", async () => {
    const id = await buatRetur([{ type: "ACCESSORIES", itemId: kancingId, qty: 3, costValue: 3_000 }]);
    tunda.ms = 800;
    const sudahBaca = new Promise<void>((beri) => tunda.sesudahBaca.push(beri));
    const selesai = completeReturn(id, undefined, BUKTI);
    await Promise.race([sudahBaca, selesai.then(() => {}, () => {})]);
    // Mis. keluarkan bahan +10 kancing commit selama completeReturn tertahan.
    const sekarang = await rencanaWo();
    const baru = sekarang.map((r) => (r.itemId === kancingId ? { ...r, issuedQty: 30 } : r));
    await prisma.workOrder.update({ where: { id: seededId(woId) }, data: { consumptionPlan: JSON.stringify(baru) } });
    expect(await selesai).toEqual({ ok: true });
    const akhir = await rencanaWo();
    expect(akhir.find((r) => r.itemId === kancingId)).toMatchObject({ issuedQty: 30, returnedQty: 3 });
    expect(akhir.find((r) => r.itemId === kainId)).toMatchObject({ issuedQty: 50, returnedQty: 1 });
  });

  it("retur 3 pcs kancing dari bahan WO → returnedQty kancing 0 → 3; kain tetap 1", async () => {
    const id = await buatRetur([{ type: "ACCESSORIES", itemId: kancingId, qty: 3, costValue: 3_000 }]);
    await completeReturn(id, undefined, BUKTI);
    expect(await dikembalikan()).toEqual({ [kancingId]: 3, [kainId]: 1 });
  });

  it("diulang sesudah selesai → ditolak, returnedQty tetap 3 (sekali saja)", async () => {
    const id = await buatRetur([{ type: "ACCESSORIES", itemId: kancingId, qty: 3, costValue: 3_000 }]);
    await completeReturn(id, undefined, BUKTI);
    expect(await completeReturn(id, undefined, BUKTI)).toEqual({ ok: false, code: "SUDAH_SELESAI" });
    expect(await dikembalikan()).toEqual({ [kancingId]: 3, [kainId]: 1 });
  });

  it("dua penyelesaian serentak (Promise.all) → tepat satu berhasil, returnedQty +3 sekali", async () => {
    const id = await buatRetur([{ type: "ACCESSORIES", itemId: kancingId, qty: 3, costValue: 3_000 }]);
    const hasil = await Promise.all([completeReturn(id, undefined, BUKTI), completeReturn(id, undefined, BUKTI)]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, code: "SUDAH_SELESAI" }]);
    expect(await dikembalikan()).toEqual({ [kancingId]: 3, [kainId]: 1 });
  });

  it("qty bertipe teks dijumlah sebagai angka: kain 1 + '2.5' + 1.25 → 4.75; FG_REJECT dan barang di luar rencana diabaikan", async () => {
    const id = await buatRetur([
      { type: "FABRIC", itemId: kainId, qty: "2.5", costValue: 50_000 },
      { type: "FABRIC", itemId: kainId, qty: 1.25, costValue: 25_000 },
      { type: "FG_REJECT", itemId: kancingId, qty: 7, costValue: 0 },
      { type: "ACCESSORIES", itemId: lainId, qty: 4, costValue: 4_000 },
    ]);
    await completeReturn(id, undefined, BUKTI);
    expect(await dikembalikan()).toEqual({ [kancingId]: 0, [kainId]: 4.75 });
  });

  it("retur tanpa WO → tetap selesai, rencana WO mana pun tidak tersentuh", async () => {
    const id = await buatRetur([{ type: "ACCESSORIES", itemId: kancingId, qty: 3, costValue: 3_000 }], { tanpaWo: true });
    await completeReturn(id, undefined, BUKTI);
    expect((await prisma.vendorReturn.findUniqueOrThrow({ where: { id: seededId(id) }, select: { status: true } })).status).toBe(
      "COMPLETED",
    );
    expect(await dikembalikan()).toEqual({ [kancingId]: 0, [kainId]: 1 });
  });
});
