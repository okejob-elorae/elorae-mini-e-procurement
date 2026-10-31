import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Persetujuan pemilik atas GRN terima-lebih (sesi ditiru, basis data uji nyata).
 *
 * Dulu `approveGRNByOwner`/`declineGRNByOwner` memeriksa kolom lama `User.role`
 * milik `userId` KIRIMAN KLIEN: siapa pun yang punya `inventory:manage` cukup
 * mengirim id admin untuk menyetujui/menolak atas nama pemilik. Sekarang
 * pemilik = admin sistem (izin `*`) dari SESI, setuju punya penjaga keadaan, dan
 * keduanya berjalan di `runSerializable` — tolak ganda yang serentak dulu bisa
 * membalik stok dua kali.
 */

const sesi = vi.hoisted(() => ({ ada: true, id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    sesi.ada ? { user: { id: sesi.id, email: null, permissions: sesi.permissions } } : null,
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji",
  notifyGRNCreated: async () => {},
  notifyMaterialArrivedForPo: async () => {},
}));
/* Jurnal GRN tidak diuji di sini dan tidak boleh menyentuh pemetaan akun bersama. */
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(async () => ({ ok: true })),
  postGrnReversalJournal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

/*
 * Balapan yang pasti, bukan untung-untungan waktu. Setiap transaksi yang membaca
 * GRN (`tx.gRN.findUnique`) bisa disuruh diam sesudah membaca. `balapan(a, b)`
 * menjalankan `a`, menunggu sampai `a` sudah membaca keadaan, lalu menjalankan
 * `b` — `b` selesai dan commit SELAMA `a` masih memegang keadaan lamanya. Tanpa
 * serializable, `a` lalu menulis di atas keadaan basi; dengan serializable, `a`
 * kena konflik, diulang, dan melihat keadaan baru. Tanpa penahan ini kedua
 * transaksi biasanya kebetulan berurutan, dan setuju yang TIDAK serializable
 * tetap lolos semua tes balapan (terbukti dengan mutasi).
 */
const tunda = vi.hoisted(() => ({ antrean: [] as number[], sesudahBaca: [] as Array<() => void> }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  type Fungsi = (...args: unknown[]) => unknown;
  const ikat = (t: object, v: unknown) => (typeof v === "function" ? (v as Fungsi).bind(t) : v);
  const bungkusGrn = (delegasi: object) =>
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
        return p === "gRN" && v && typeof v === "object" ? bungkusGrn(v) : ikat(t, v);
      },
    });
  // Juga di luar transaksi: penjaga yang membaca keadaan sebelum transaksinya
  // (bentuk lama) harus ikut tertahan, supaya bentuk itu tertangkap juga.
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

/** Cukup lama agar transaksi kedua pasti selesai selagi yang pertama menahan. */
const TAHAN_MS = 400;

async function balapan(pertama: () => Promise<unknown>, kedua: () => Promise<unknown>) {
  tunda.antrean = [TAHAN_MS];
  const sudahBaca = new Promise<void>((beri) => tunda.sesudahBaca.push(beri));
  const p1 = pertama();
  // Kalau `pertama` gagal sebelum membaca (mis. ditolak penjaga), jangan menunggu selamanya.
  await Promise.race([sudahBaca, p1.then(() => {}, () => {})]);
  const p2 = kedua();
  try {
    return await Promise.allSettled([p1, p2]);
  } finally {
    tunda.antrean = [];
    tunda.sesudahBaca = [];
  }
}

const { approveGRNByOwner, declineGRNByOwner, createGRN } = await import("./grn");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const STOK_AWAL = 100;
const QTY_GRN = 10;

d("GRN terima-lebih: persetujuan pemilik (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let pemilikId = "";
  let gudangId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let itemId = "";
  let grnId = "";
  let urut = 0;
  const grnIds: string[] = [];

  const PEMILIK = () => ({ id: pemilikId, permissions: ["*"] });
  const GUDANG = () => ({ id: gudangId, permissions: ["inventory:view", "inventory:manage"] });

  function sebagai(u: { id: string; permissions: string[] }) {
    sesi.ada = true;
    sesi.id = u.id;
    sesi.permissions = u.permissions;
  }

  beforeAll(async () => {
    pemilikId = "";
    gudangId = "";
    typeId = "";
    supplierId = "";
    uomId = "";
    itemId = "";
    pemilikId = (
      await prisma.user.create({
        data: { email: `grn-pemilik-${token}@uji.local`, name: "Pemilik uji", role: "ADMIN" },
        select: { id: true },
      })
    ).id;
    gudangId = (
      await prisma.user.create({
        data: { email: `grn-gudang-${token}@uji.local`, name: "Gudang uji", role: "WAREHOUSE" },
        select: { id: true },
      })
    ).id;
    typeId = (
      await prisma.supplierType.create({
        data: { code: `TGR-${token}`, name: `Jenis GRN ${token}` },
        select: { id: true },
      })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-GRN-${token}`, name: "Pemasok GRN uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({
        data: { code: `G${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" },
        select: { id: true },
      })
    ).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `GRN-UJI-${token}`, nameId: "Aksesori uji", nameEn: "Test accessory", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    grnId = "";
    sebagai(PEMILIK());
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: STOK_AWAL, avgCost: 1000, totalValue: STOK_AWAL * 1000 },
    });
    urut += 1;
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-UJI-${token}-${urut}`,
        supplierId,
        receivedBy: gudangId,
        totalAmount: QTY_GRN * 1000,
        requiresOwnerApproval: true,
        items: JSON.stringify([{ itemId, variantSku: null, qty: QTY_GRN, unitCost: 1000 }]),
      },
      select: { id: true },
    });
    grnId = grn.id;
    grnIds.push(grn.id);
  });

  afterAll(async () => {
    const semuaGrn = (
      await prisma.gRN.findMany({ where: { supplierId: seededId(supplierId) }, select: { id: true } })
    ).map((g) => g.id);
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fabricRoll.deleteMany({ where: { grnId: { in: seededIds(semuaGrn) } } });
    await prisma.gRN.deleteMany({ where: { id: { in: seededIds(semuaGrn) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    for (const id of [pemilikId, gudangId]) {
      await prisma.auditLog.deleteMany({ where: { userId: seededId(id) } });
      await prisma.user.deleteMany({ where: { id: seededId(id) } });
    }
  });

  async function keadaanGrn() {
    return prisma.gRN.findUniqueOrThrow({
      where: { id: seededId(grnId) },
      select: {
        requiresOwnerApproval: true,
        ownerApprovedAt: true,
        ownerApprovedById: true,
        ownerDeclinedAt: true,
        ownerDeclinedById: true,
      },
    });
  }

  async function stok(): Promise<number> {
    const inv = await prisma.inventoryValue.findUniqueOrThrow({
      where: { itemId_variantSku: { itemId: seededId(itemId), variantSku: "" } },
      select: { qtyOnHand: true },
    });
    return Number(inv.qtyOnHand);
  }

  async function jumlahPembalikan(): Promise<number> {
    return prisma.stockMovement.count({ where: { refId: seededId(grnId), refType: "GRN_OWNER_DECLINE" } });
  }

  describe("approveGRNByOwner", () => {
    it("menolak pengguna non-pemilik walau mengirim id admin sebagai argumen", async () => {
      sebagai(GUDANG());
      await expect(approveGRNByOwner(grnId, pemilikId)).rejects.toThrow();
      expect(await keadaanGrn()).toMatchObject({ ownerApprovedAt: null, requiresOwnerApproval: true });
    });

    it("menolak tanpa sesi", async () => {
      sesi.ada = false;
      await expect(approveGRNByOwner(grnId, pemilikId)).rejects.toThrow(/Unauthorized/);
    });

    it("pemilik (izin *) boleh; penyetuju dicatat dari SESI, bukan argumen", async () => {
      sebagai(PEMILIK());
      await approveGRNByOwner(grnId, gudangId);
      const g = await keadaanGrn();
      expect(g.ownerApprovedAt).not.toBeNull();
      expect(g.ownerApprovedById).toBe(pemilikId);
      expect(g.requiresOwnerApproval).toBe(false);
    });

    it("GRN yang sudah ditolak tidak bisa disetujui", async () => {
      sebagai(PEMILIK());
      await declineGRNByOwner(grnId, pemilikId);
      await expect(approveGRNByOwner(grnId, pemilikId)).rejects.toThrow();
      const g = await keadaanGrn();
      expect(g.ownerApprovedAt).toBeNull();
      expect(g.ownerDeclinedAt).not.toBeNull();
    });

    it("setuju ganda serentak: tepat satu yang berhasil", async () => {
      sebagai(PEMILIK());
      const hasil = await balapan(
        () => approveGRNByOwner(grnId, pemilikId),
        () => approveGRNByOwner(grnId, pemilikId),
      );
      expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
    });
  });

  describe("declineGRNByOwner", () => {
    it("menolak pengguna non-pemilik walau mengirim id admin; stok tidak bergerak", async () => {
      sebagai(GUDANG());
      await expect(declineGRNByOwner(grnId, pemilikId)).rejects.toThrow();
      expect(await stok()).toBe(STOK_AWAL);
      expect(await keadaanGrn()).toMatchObject({ ownerDeclinedAt: null, requiresOwnerApproval: true });
    });

    it("pemilik boleh; stok dibalik sekali, penolak dicatat dari sesi", async () => {
      sebagai(PEMILIK());
      await declineGRNByOwner(grnId, gudangId);
      expect(await stok()).toBe(STOK_AWAL - QTY_GRN);
      expect(await jumlahPembalikan()).toBe(1);
      expect((await keadaanGrn()).ownerDeclinedById).toBe(pemilikId);
    });

    it("baris stok tanpa varian bertanda NULL (bahan): tolak membalik baris itu, bukan STOK_KURANG", async () => {
      sebagai(PEMILIK());
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.inventoryValue.create({
        data: { itemId, variantSku: null, qtyOnHand: STOK_AWAL, avgCost: 1000, totalValue: STOK_AWAL * 1000 },
      });
      await declineGRNByOwner(grnId, pemilikId);
      const baris = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) }, select: { variantSku: true, qtyOnHand: true } });
      expect(baris.map((b) => [b.variantSku, Number(b.qtyOnHand)])).toEqual([[null, STOK_AWAL - QTY_GRN]]);
      expect(await jumlahPembalikan()).toBe(1);
    });

    it("tolak ganda serentak: tepat satu berhasil, stok dibalik SEKALI", async () => {
      sebagai(PEMILIK());
      const hasil = await balapan(
        () => declineGRNByOwner(grnId, pemilikId),
        () => declineGRNByOwner(grnId, pemilikId),
      );
      expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
      expect(await stok()).toBe(STOK_AWAL - QTY_GRN);
      expect(await jumlahPembalikan()).toBe(1);
    });

    /** Setuju dan tolak serentak: tepat satu menang, dan GRN-nya tidak pernah dua-duanya. */
    async function periksaSatuPemenang(hasil: PromiseSettledResult<unknown>[], setujuDulu: boolean) {
      expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
      const setujuMenang = hasil[setujuDulu ? 0 : 1].status === "fulfilled";
      const g = await keadaanGrn();
      if (setujuMenang) {
        expect(g.ownerApprovedAt).not.toBeNull();
        expect(g.ownerDeclinedAt).toBeNull();
        expect(await stok()).toBe(STOK_AWAL);
        expect(await jumlahPembalikan()).toBe(0);
      } else {
        expect(g.ownerDeclinedAt).not.toBeNull();
        expect(g.ownerApprovedAt).toBeNull();
        expect(await stok()).toBe(STOK_AWAL - QTY_GRN);
        expect(await jumlahPembalikan()).toBe(1);
      }
    }

    it("setuju membaca dulu, tolak menyalip: tepat satu yang menang, keadaan konsisten", async () => {
      sebagai(PEMILIK());
      const hasil = await balapan(
        () => approveGRNByOwner(grnId, pemilikId),
        () => declineGRNByOwner(grnId, pemilikId),
      );
      await periksaSatuPemenang(hasil, true);
    });

    it("tolak membaca dulu, setuju menyalip: tepat satu yang menang, keadaan konsisten", async () => {
      sebagai(PEMILIK());
      const hasil = await balapan(
        () => declineGRNByOwner(grnId, pemilikId),
        () => approveGRNByOwner(grnId, pemilikId),
      );
      await periksaSatuPemenang(hasil, false);
    });
  });

  describe("createGRN", () => {
    it("penerima dicatat dari sesi, bukan dari argumen userId", async () => {
      sebagai(GUDANG());
      const grn = await createGRN(
        { supplierId, items: [{ itemId, qty: 1, unitCost: 1000 }] },
        pemilikId,
      );
      grnIds.push(grn.id);
      expect(grn.receivedBy).toBe(gudangId);
    });

    it("tetap menolak tanpa inventory:manage", async () => {
      sebagai({ id: gudangId, permissions: ["inventory:view"] });
      await expect(createGRN({ supplierId, items: [{ itemId, qty: 1, unitCost: 1000 }] }, gudangId)).rejects.toThrow(
        /Forbidden/,
      );
    });
  });
});
