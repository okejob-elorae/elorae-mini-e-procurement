import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Kunci kiriman GRN (`idempotencyKey`) — basis data uji nyata, `createGRN`
 * sungguhan, sesi ditiru.
 *
 * Dulu GRN tidak punya kunci: jawaban yang hilang lalu disimpan ulang mencatat
 * penerimaan dua kali — stok, harga rata-rata, qty diterima PO, status PO, dan
 * jurnal hutang ganda. Kini formulir membuat kunci SEKALI per isian; kiriman
 * ulang dengan kunci yang sama mendapat GRN yang sudah ada (`ulang: true`).
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
}));
const sesudah = vi.hoisted(() => ({ jurnal: 0, push: 0 }));
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(async () => {
    sesudah.jurnal += 1;
    return { ok: true };
  }),
  postGrnReversalJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({
  antrekanPushStok: vi.fn(async () => {
    sesudah.push += 1;
  }),
}));

/*
 * Pembacaan PO pertama di dalam transaksi bisa ditahan (meniru simpan yang lambat).
 * `sembunyikanGrn`: sebanyak itu pembacaan GRN berikutnya menjawab "tidak ada" —
 * meniru pembacaan kunci yang terjadi sebelum kembarannya commit (MariaDB tanpa
 * konflik serialisasi), supaya kunci baru bentrok di indeks unik (P2002).
 */
const tunda = vi.hoisted(() => ({ antrean: [] as number[], sesudahBaca: [] as Array<() => void>, sembunyikanGrn: 0 }));
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
  const bungkusGrn = (delegasi: object) =>
    new Proxy(delegasi, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p !== "findUnique" || typeof v !== "function") return ikat(t, v);
        return async (...args: unknown[]) => {
          if (tunda.sembunyikanGrn > 0) {
            tunda.sembunyikanGrn -= 1;
            return null;
          }
          return (v as Fungsi).apply(t, args);
        };
      },
    });
  const bungkusTx = (tx: object) =>
    new Proxy(tx, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p === "purchaseOrder" && v && typeof v === "object") return bungkusPo(v);
        if (p === "gRN" && v && typeof v === "object") return bungkusGrn(v);
        return ikat(t, v);
      },
    });
  const prisma = new Proxy(asli.prisma, {
    get(t, p) {
      const v = Reflect.get(t, p);
      if (p === "gRN" && v && typeof v === "object") return bungkusGrn(v);
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

/** `pertama` membaca PO di dalam transaksinya lalu tertahan; `kedua` berjalan dan commit selama itu. */
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

d("kunci kiriman GRN (test bed only)", () => {
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
      await prisma.user.create({ data: { email: `grn-kunci-${token}@uji.local`, name: "Gudang uji" }, select: { id: true } })
    ).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TGK-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-GK-${token}`, name: "Pemasok uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (await prisma.uOM.create({ data: { code: `K${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })).id;
    // Ambang terima-lebih 50 pcs: GRN kedua yang tidak sengaja tetap LOLOS penjaga —
    // satu-satunya yang menghentikannya adalah kunci.
    itemId = (
      await prisma.item.create({
        data: {
          sku: `GK-UJI-${token}`,
          nameId: "Kancing uji",
          nameEn: "Test button",
          type: "ACCESSORIES",
          uomId,
          overReceiveThreshold: 50,
        },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    sesi.id = userId;
    sesi.izin = ["*"];
    tunda.sembunyikanGrn = 0;
    sesudah.jurnal = 0;
    sesudah.push = 0;
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

  /** PO terkirim: 10 pcs × Rp1.000. */
  async function buatPo() {
    urut += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-GK-${token}-${urut}`,
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

  const kunciBaru = (huruf: string) => `kunci-grn-${token}-${huruf}`;
  const isian = (poId: string | undefined, qty: number, kunci?: string, unitCost = 1_000) => ({
    ...(poId ? { poId } : {}),
    supplierId,
    items: [{ itemId, qty, unitCost }],
    ...(kunci ? { idempotencyKey: kunci } : {}),
  });

  async function keadaan(poId: string) {
    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: seededId(poId) },
      select: { status: true, items: { select: { receivedQty: true } }, grns: { select: { id: true } } },
    });
    const stok = await prisma.inventoryValue.findMany({
      where: { itemId: seededId(itemId) },
      select: { qtyOnHand: true, avgCost: true },
    });
    const gerak = await prisma.stockMovement.count({ where: { itemId: seededId(itemId) } });
    return {
      status: po.status,
      diterima: po.items.map((i) => Number(i.receivedQty)),
      grn: po.grns.length,
      stok: stok.map((s) => Number(s.qtyOnHand)),
      hargaRata: stok.map((s) => Number(s.avgCost)),
      gerakStok: gerak,
    };
  }

  it("kunci sama dua kali → GRN yang sama (ulang), stok 4 bukan 8; jurnal & push stok sekali", async () => {
    const poId = await buatPo();
    const kunci = kunciBaru("a");
    const pertama = await createGRN(isian(poId, 4, kunci));
    expect(pertama.ulang).toBe(false);
    const kedua = await createGRN(isian(poId, 4, kunci));
    expect(kedua).toMatchObject({ id: pertama.id, docNumber: pertama.docNumber, totalAmount: 4_000, ulang: true });
    expect(await keadaan(poId)).toEqual({
      status: "PARTIAL",
      diterima: [4],
      grn: 1,
      stok: [4],
      hargaRata: [1_000],
      gerakStok: 1,
    });
    expect(sesudah).toEqual({ jurnal: 1, push: 1 });
  });

  it("simpan ulang membawa harga lain dengan kunci sama → isian pertama yang tercatat; harga rata-rata tidak bergeser", async () => {
    const poId = await buatPo();
    const kunci = kunciBaru("b");
    await createGRN(isian(poId, 4, kunci, 1_000));
    const ulang = await createGRN(isian(poId, 4, kunci, 3_000));
    expect(ulang).toMatchObject({ totalAmount: 4_000, ulang: true });
    expect(await keadaan(poId)).toMatchObject({ diterima: [4], stok: [4], hargaRata: [1_000], grn: 1 });
  });

  it("GRN pertama melengkapi PO (CLOSED) → simpan ulang berkunci sama tidak menerima 10 lagi sebagai terima-lebih", async () => {
    const poId = await buatPo();
    const kunci = kunciBaru("c");
    const pertama = await createGRN(isian(poId, 10, kunci));
    expect((await keadaan(poId)).status).toBe("CLOSED");
    const ulang = await createGRN(isian(poId, 10, kunci));
    expect(ulang).toMatchObject({ id: pertama.id, ulang: true });
    expect(await keadaan(poId)).toMatchObject({ status: "CLOSED", diterima: [10], grn: 1, stok: [10] });
  });

  it("PO ditutup sesudah GRN pertama → simpan ulang berkunci sama tetap GRN yang sama, bukan PO_DITUTUP", async () => {
    const poId = await buatPo();
    const kunci = kunciBaru("d");
    const pertama = await createGRN(isian(poId, 4, kunci));
    expect((await tutupPurchaseOrder({ poId, userId, alasan: "uji kunci" })).ok).toBe(true);
    expect(await simpanGRN(isian(poId, 4, kunci))).toEqual({
      ok: true,
      id: pertama.id,
      docNumber: pertama.docNumber,
      ulang: true,
    });
    expect(await keadaan(poId)).toMatchObject({ status: "CLOSED", diterima: [4], grn: 1, stok: [4] });
  });

  it("simpanGRN: GRN baru tanpa `ulang`; kunci berbeda = isian berbeda → dua GRN, stok 7", async () => {
    const poId = await buatPo();
    const a = await simpanGRN(isian(poId, 4, kunciBaru("e1")));
    expect(a).toEqual({ ok: true, id: expect.any(String), docNumber: expect.stringMatching(/^GRN\//) });
    const b = await simpanGRN(isian(poId, 3, kunciBaru("e2")));
    expect(b).toMatchObject({ ok: true });
    expect(b.ok && a.ok && b.id !== a.id).toBe(true);
    expect(await keadaan(poId)).toMatchObject({ status: "PARTIAL", diterima: [7], grn: 2, stok: [7] });
  });

  it("Promise.all dua simpan berkunci sama → GRN yang sama, stok 4, satu GRN; sesudah-commit sekali", async () => {
    const poId = await buatPo();
    const kunci = kunciBaru("f");
    const [a, b] = await Promise.all([createGRN(isian(poId, 4, kunci)), createGRN(isian(poId, 4, kunci))]);
    expect(b.id).toBe(a.id);
    expect([a.ulang, b.ulang].sort()).toEqual([false, true]);
    expect(await keadaan(poId)).toMatchObject({ status: "PARTIAL", diterima: [4], grn: 1, stok: [4], gerakStok: 1 });
    expect(sesudah).toEqual({ jurnal: 1, push: 1 });
  });

  it("balapan: simpan pertama tertahan sesudah membaca PO, kembarannya commit → yang tertahan mendapat GRN pemenang", async () => {
    const poId = await buatPo();
    const kunci = kunciBaru("g");
    const [p1, p2] = await balapan(
      () => createGRN(isian(poId, 4, kunci)),
      () => createGRN(isian(poId, 4, kunci)),
    );
    expect(p1.status).toBe("fulfilled");
    expect(p2.status).toBe("fulfilled");
    const a = (p1 as PromiseFulfilledResult<Awaited<ReturnType<typeof createGRN>>>).value;
    const b = (p2 as PromiseFulfilledResult<Awaited<ReturnType<typeof createGRN>>>).value;
    expect(a.id).toBe(b.id);
    expect(a.ulang).toBe(true);
    expect(b.ulang).toBe(false);
    expect(await keadaan(poId)).toMatchObject({ diterima: [4], grn: 1, stok: [4], gerakStok: 1 });
  });

  it("kembaran yang lolos kedua pembacaan kunci bentrok di indeks unik → tetap GRN yang sama, tidak melempar", async () => {
    const poId = await buatPo();
    const kunci = kunciBaru("p2002");
    const pertama = await createGRN(isian(poId, 4, kunci));
    // Pembacaan di luar dan di dalam transaksi sama-sama "tidak melihat" GRN pertama.
    tunda.sembunyikanGrn = 2;
    const kedua = await createGRN(isian(poId, 4, kunci));
    expect(tunda.sembunyikanGrn).toBe(0);
    expect(kedua).toMatchObject({ id: pertama.id, ulang: true });
    expect(await keadaan(poId)).toMatchObject({ diterima: [4], grn: 1, stok: [4], gerakStok: 1 });
    expect(sesudah).toEqual({ jurnal: 1, push: 1 });
  });

  it("GRN tanpa PO juga dilindungi kunci", async () => {
    const kunci = kunciBaru("h");
    const a = await createGRN(isian(undefined, 6, kunci));
    const b = await createGRN(isian(undefined, 6, kunci));
    expect(b).toMatchObject({ id: a.id, ulang: true });
    const stok = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) }, select: { qtyOnHand: true } });
    expect(stok.map((s) => Number(s.qtyOnHand))).toEqual([6]);
  });

  it("kunci yang terlalu pendek ditolak validasi, tidak ada yang tercatat", async () => {
    const poId = await buatPo();
    await expect(createGRN(isian(poId, 4, "pendek"))).rejects.toThrow();
    expect(await keadaan(poId)).toMatchObject({ grn: 0, stok: [] });
  });
});
