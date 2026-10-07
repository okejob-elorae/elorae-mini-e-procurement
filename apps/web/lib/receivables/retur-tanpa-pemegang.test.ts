import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * KEPUTUSAN SEMENTARA PEMILIK 2026-10-06 — nota retur yang dilaporkan SPG di
 * toko TANPA salesman pemegang membunyikan lonceng kantor, terhadap basis data
 * sungguhan. Toko seperti itu tidak punya orang lapangan yang menindaklanjuti
 * notanya (mengantar barang ke gudang, memotongkannya di BKM), jadi tanpa
 * kabar ini notanya diam sampai ada yang kebetulan membuka daftar retur.
 *
 * Penyebaran (`fanOutAdminNotification`) diganti mata-mata: yang diuji di sini
 * adalah bahwa penulis memanggilnya SESUDAH transaksi dengan baris yang benar.
 * Penerimanya diuji di `retur-tanpa-pemegang-fanout.test.ts`.
 */

const { sebar } = vi.hoisted(() => ({ sebar: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/admin-fanout")>()),
  fanOutAdminNotification: sebar,
}));

const { catatReturToko, KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG } = await import("./return-writer");

const tag = `RTP-${Math.random().toString(36).slice(2, 8)}`;
let uomId = "";
let itemId = "";
let spgId = "";
let salesId = "";
let tokoTanpaId = "";
let tokoAdaId = "";
let urut = 0;

const hari = (iso: string) => new Date(`${iso}T00:00:00+07:00`);

beforeEach(async () => {
  uomId = "";
  itemId = "";
  spgId = "";
  salesId = "";
  tokoTanpaId = "";
  tokoAdaId = "";
  sebar.mockReset();

  const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
  if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
  spgId = orang[0].id;
  salesId = orang[1].id;

  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  itemId = (
    await prisma.item.create({
      data: { sku: tag, nameId: `Kemeja ${tag}`, nameEn: "Shirt", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 80_000 },
    })
  ).id;
  tokoTanpaId = (
    await prisma.store.create({
      data: { code: `${tag}-T`, name: `${tag} Tanpa Pemegang`, address: "uji", termsType: "KONSI", marginPercent: 20, isActive: true },
    })
  ).id;
  tokoAdaId = (
    await prisma.store.create({
      data: {
        code: `${tag}-A`,
        name: `${tag} Berpemegang`,
        address: "uji",
        termsType: "KONSI",
        marginPercent: 20,
        isActive: true,
        salesmanId: salesId,
      },
    })
  ).id;
});

afterEach(async () => {
  const toko = [tokoTanpaId, tokoAdaId].filter(Boolean);
  const nota = toko.length ? await prisma.storeReturn.findMany({ where: { storeId: { in: seededIds(toko) } }, select: { id: true } }) : [];
  if (nota.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: nota.map((n) => seededId(n.id)) } } });
  const notif = await prisma.adminNotification.findMany({
    where: { category: KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG, title: { contains: tag } },
    select: { id: true },
  });
  if (notif.length) await prisma.adminNotification.deleteMany({ where: { id: { in: notif.map((n) => seededId(n.id)) } } });
  if (toko.length) {
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds(toko) } } });
    await prisma.storeReturn.deleteMany({ where: { storeId: { in: seededIds(toko) } } });
  }
  if (itemId) await prisma.item.delete({ where: { id: seededId(itemId) } });
  if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  if (toko.length) await prisma.store.deleteMany({ where: { id: { in: seededIds(toko) } } });
});

const lapor = (storeId: string, opsi: Partial<Parameters<typeof catatReturToko>[0]> = {}) => {
  urut += 1;
  return catatReturToko({
    noNrt: "",
    storeId,
    olehUserId: spgId,
    salesmanId: spgId,
    claimDate: hari("2026-10-05"),
    deliveryMethod: "SALES",
    reportedBySpg: true,
    barisSpg: [{ itemId, qty: 2, condition: "LAYAK" }],
    idempotencyKey: `${tag}-${urut}`,
    ...opsi,
  });
};

const notifikasiToko = () =>
  prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG, title: { contains: tag } } });

describe("NRT SPG di toko tanpa pemegang memberi tahu kantor", () => {
  it("menulis satu notifikasi (tautan ke notanya) dan menyebarkannya SESUDAH transaksi", async () => {
    const h = await lapor(tokoTanpaId);
    if (!h.ok) throw new Error(`gagal: ${h.alasan}`);

    const [n, ...lebih] = await notifikasiToko();
    expect(lebih).toHaveLength(0);
    expect(n.title).toContain(`${tag} Tanpa Pemegang`);
    expect(n.message).toContain(h.noNrt);
    expect(n.message).not.toContain("Rp");
    expect(n.metadata).toMatchObject({ storeReturnId: h.id, storeId: tokoTanpaId, noNrt: h.noNrt });

    expect(sebar).toHaveBeenCalledTimes(1);
    expect(sebar.mock.calls[0][0]).toMatchObject({ id: n.id, category: KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG });
  });

  it("kiriman ulang dengan kunci yang sama tidak menulis atau menyebar notifikasi kedua", async () => {
    const pertama = await lapor(tokoTanpaId, { idempotencyKey: `${tag}-ulang` });
    const kedua = await lapor(tokoTanpaId, { idempotencyKey: `${tag}-ulang` });
    expect(pertama.ok && kedua.ok && pertama.id === kedua.id).toBe(true);
    expect(await notifikasiToko()).toHaveLength(1);
    expect(sebar).toHaveBeenCalledTimes(1);
  });

  it("toko yang punya pemegang tidak membunyikan lonceng kantor", async () => {
    expect((await lapor(tokoAdaId)).ok).toBe(true);
    expect(await notifikasiToko()).toHaveLength(0);
    expect(sebar).not.toHaveBeenCalled();
  });

  it("nota yang dicatat sales (bukan SPG) tidak membunyikannya", async () => {
    const h = await lapor(tokoTanpaId, {
      reportedBySpg: false,
      barisSpg: undefined,
      noNrt: `${tag}-NRT`,
      claimedAmount: 150_000,
      items: [{ itemName: "Kemeja", qty: 1, price: 150_000 }],
    });
    expect(h.ok).toBe(true);
    expect(await notifikasiToko()).toHaveLength(0);
    expect(sebar).not.toHaveBeenCalled();
  });
});
