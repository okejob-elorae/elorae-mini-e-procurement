import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/*
 * Retur ke pemasok: `processReturn` menggerakkan stok keluar dan
 * `completeReturn` menutup dokumennya — dulu keduanya tanpa `auth()` maupun izin
 * sama sekali, dan pelakunya diambil dari `userId` kiriman klien. Sekarang:
 * sesi + `vendor_returns:manage`, pelaku dari sesi, dan penjaga keadaan
 * (DRAFT → PROCESSED → COMPLETED) di `runSerializable` sehingga proses ganda
 * yang serentak tidak mengeluarkan stok dua kali.
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
  notifyVendorReturnCreated: async () => {},
  notifyVendorReturnStatusUpdated: async () => {},
}));

/*
 * Balapan yang pasti, bukan untung-untungan waktu. Setiap transaksi yang membaca
 * retur (`tx.vendorReturn.findUnique`) bisa disuruh diam sesudah membaca.
 * `balapan(a, b)` menjalankan `a`, menunggu sampai `a` sudah membaca keadaan,
 * lalu menjalankan `b` — `b` selesai dan commit SELAMA `a` masih memegang
 * keadaan lamanya. Tanpa serializable, `a` lalu menulis di atas keadaan basi.
 * Tanpa penahan ini, ubah/hapus draf yang TIDAK serializable tetap lolos tes
 * balapannya (terbukti dengan mutasi): kedua transaksi kebetulan berurutan.
 */
const tunda = vi.hoisted(() => ({ antrean: [] as number[], sesudahBaca: [] as Array<() => void> }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  type Fungsi = (...args: unknown[]) => unknown;
  const ikat = (t: object, v: unknown) => (typeof v === "function" ? (v as Fungsi).bind(t) : v);
  const bungkusRetur = (delegasi: object) =>
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
        return p === "vendorReturn" && v && typeof v === "object" ? bungkusRetur(v) : ikat(t, v);
      },
    });
  // Juga di luar transaksi: penjaga yang membaca keadaan sebelum transaksinya
  // (bentuk lama) harus ikut tertahan, supaya bentuk itu tertangkap juga.
  const prisma = new Proxy(asli.prisma, {
    get(t, p) {
      const v = Reflect.get(t, p);
      if (p === "vendorReturn" && v && typeof v === "object") return bungkusRetur(v);
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

const { processReturn, completeReturn, deleteVendorReturn, updateVendorReturn } = await import("./vendor-returns");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const STOK_AWAL = 100;
const QTY_RETUR = 5;
const BUKTI = { trackingNumber: "RESI-UJI-1", receiptFileUrl: "https://contoh.local/resi.jpg" };

d("retur pemasok: proses & selesai (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let pengelolaId = "";
  let lainId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let itemId = "";
  let returId = "";
  let urut = 0;

  const PENGELOLA = () => ({ id: pengelolaId, permissions: ["vendor_returns:view", "vendor_returns:manage"] });
  const PEMBACA = () => ({ id: lainId, permissions: ["vendor_returns:view", "vendor_returns:create"] });

  function sebagai(u: { id: string; permissions: string[] }) {
    sesi.ada = true;
    sesi.id = u.id;
    sesi.permissions = u.permissions;
  }

  beforeAll(async () => {
    pengelolaId = "";
    lainId = "";
    typeId = "";
    supplierId = "";
    uomId = "";
    itemId = "";
    pengelolaId = (
      await prisma.user.create({ data: { email: `retur-kelola-${token}@uji.local` }, select: { id: true } })
    ).id;
    lainId = (await prisma.user.create({ data: { email: `retur-lain-${token}@uji.local` }, select: { id: true } })).id;
    typeId = (
      await prisma.supplierType.create({ data: { code: `TVR-${token}`, name: `Jenis retur ${token}` }, select: { id: true } })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-VR-${token}`, name: "Pemasok retur uji", typeId, status: "ACTIVE", bankAccountEnc: "rahasia" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({ data: { code: `V${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })
    ).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `VR-UJI-${token}`, nameId: "Aksesori retur", nameEn: "Return accessory", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    returId = "";
    sebagai(PENGELOLA());
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: STOK_AWAL, avgCost: 1000, totalValue: STOK_AWAL * 1000 },
    });
    urut += 1;
    returId = (
      await prisma.vendorReturn.create({
        data: {
          docNumber: `RET-UJI-${token}-${urut}`,
          vendorId: supplierId,
          lines: [{ type: "ACCESSORIES", itemId, variantSku: null, qty: QTY_RETUR, costValue: QTY_RETUR * 1000 }],
          totalItems: QTY_RETUR,
          totalValue: QTY_RETUR * 1000,
          createdById: pengelolaId,
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.vendorReturn.deleteMany({ where: { vendorId: seededId(supplierId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    for (const id of [pengelolaId, lainId]) {
      await prisma.user.deleteMany({ where: { id: seededId(id) } });
    }
  });

  async function retur() {
    return prisma.vendorReturn.findUniqueOrThrow({
      where: { id: seededId(returId) },
      select: { status: true, processedBy: true, completedById: true },
    });
  }

  async function stok(): Promise<number> {
    const inv = await prisma.inventoryValue.findUniqueOrThrow({
      where: { itemId_variantSku: { itemId: seededId(itemId), variantSku: "" } },
      select: { qtyOnHand: true },
    });
    return Number(inv.qtyOnHand);
  }

  async function gerakanKeluar(): Promise<number> {
    return prisma.stockMovement.count({ where: { refId: seededId(returId), refType: "VENDOR_RETURN" } });
  }

  describe("processReturn", () => {
    it("menolak tanpa vendor_returns:manage; stok tidak bergerak", async () => {
      sebagai(PEMBACA());
      await expect(processReturn(returId, pengelolaId)).rejects.toThrow(/Forbidden/);
      expect((await retur()).status).toBe("DRAFT");
      expect(await stok()).toBe(STOK_AWAL);
    });

    it("menolak tanpa sesi", async () => {
      sesi.ada = false;
      await expect(processReturn(returId, pengelolaId)).rejects.toThrow(/Unauthorized/);
      expect((await retur()).status).toBe("DRAFT");
    });

    it("vendor_returns:manage boleh; pelaku dicatat dari sesi", async () => {
      sebagai(PENGELOLA());
      await processReturn(returId, lainId);
      expect(await retur()).toMatchObject({ status: "PROCESSED", processedBy: pengelolaId });
      expect(await stok()).toBe(STOK_AWAL - QTY_RETUR);
    });

    it("proses ganda serentak: tepat satu berhasil, stok keluar SEKALI", async () => {
      sebagai(PENGELOLA());
      const hasil = await balapan(
        () => processReturn(returId, pengelolaId),
        () => processReturn(returId, pengelolaId),
      );
      expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
      expect(await stok()).toBe(STOK_AWAL - QTY_RETUR);
      expect(await gerakanKeluar()).toBe(1);
    });
  });

  describe("ubah/hapus draf vs proses serentak", () => {
    it("hapus membaca dulu, proses menyalip: tepat satu menang, retur yang stoknya keluar tidak terhapus", async () => {
      sebagai(PENGELOLA());
      const [hapus, proses] = await balapan(
        () => deleteVendorReturn(returId, pengelolaId),
        () => processReturn(returId, pengelolaId),
      );
      expect([hapus, proses].filter((h) => h.status === "fulfilled")).toHaveLength(1);
      const sisa = await prisma.vendorReturn.findUnique({ where: { id: seededId(returId) }, select: { status: true } });
      if (proses.status === "fulfilled") {
        expect(sisa?.status).toBe("PROCESSED");
        expect(await stok()).toBe(STOK_AWAL - QTY_RETUR);
      } else {
        expect(sisa).toBeNull();
        expect(await stok()).toBe(STOK_AWAL);
      }
    });

    it("ubah membaca dulu, proses menyalip: stok yang keluar selalu sama dengan baris akhir dokumen", async () => {
      sebagai(PENGELOLA());
      const QTY_BARU = 3;
      const ubahan = {
        vendorId: supplierId,
        lines: [
          { type: "ACCESSORIES" as const, itemId, qty: QTY_BARU, reason: "salah kirim", condition: "DEFECTIVE" as const },
        ],
      };
      await balapan(
        () => updateVendorReturn(returId, ubahan, pengelolaId),
        () => processReturn(returId, pengelolaId),
      );
      const r = await prisma.vendorReturn.findUniqueOrThrow({
        where: { id: seededId(returId) },
        select: { status: true, lines: true },
      });
      expect(r.status).toBe("PROCESSED");
      const baris = (typeof r.lines === "string" ? JSON.parse(r.lines) : r.lines) as Array<{ qty: number }>;
      const qtyDokumen = baris.reduce((t, b) => t + Number(b.qty), 0);
      expect(STOK_AWAL - (await stok())).toBe(qtyDokumen);
    });
  });

  describe("completeReturn", () => {
    beforeEach(async () => {
      sebagai(PENGELOLA());
      await processReturn(returId, pengelolaId);
    });

    it("menolak tanpa vendor_returns:manage", async () => {
      sebagai(PEMBACA());
      await expect(completeReturn(returId, pengelolaId, BUKTI)).rejects.toThrow(/Forbidden/);
      expect((await retur()).status).toBe("PROCESSED");
    });

    it("vendor_returns:manage boleh; penutup dicatat dari sesi", async () => {
      sebagai(PENGELOLA());
      await completeReturn(returId, lainId, BUKTI);
      expect(await retur()).toMatchObject({ status: "COMPLETED", completedById: pengelolaId });
    });

    it("selesai ganda serentak: tepat satu berhasil", async () => {
      sebagai(PENGELOLA());
      const hasil = await balapan(
        () => completeReturn(returId, pengelolaId, BUKTI),
        () => completeReturn(returId, pengelolaId, BUKTI),
      );
      expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
    });
  });
});
