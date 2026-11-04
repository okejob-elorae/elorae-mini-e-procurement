import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { getNotificationHref } from "@/lib/notifications/navigation";

/*
 * Permintaan stok SPG di toko TANPA salesman pemegang tidak sampai ke kotak
 * masuk HP siapa pun — jadi kantor diberi tahu: satu `AdminNotification`
 * (ditulis dalam transaksi yang sama dengan permintaannya) lalu disebar ke
 * lonceng SESUDAH transaksi. Toko yang punya pemegang tidak membunyikan
 * lonceng kantor; kiriman ulang berkunci sama tidak membunyikannya dua kali.
 *
 * Jangan pernah dijalankan ke basis data produksi (terowongan :3307 / host VPS).
 */

const sebar = vi.hoisted(() => ({ dipanggil: [] as { id: string; category: string }[] }));
vi.mock("@/lib/notifications/admin-fanout", async (asli) => {
  const m = await asli<typeof import("@/lib/notifications/admin-fanout")>();
  return {
    ...m,
    fanOutAdminNotification: vi.fn(async (n: { id: string; category: string }) => {
      sebar.dipanggil.push({ id: n.id, category: n.category });
    }),
  };
});
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => {
  const m = await asli<typeof import("@/lib/notifications/kabar-pengguna")>();
  return { ...m, kabariPengguna: vi.fn(async () => {}) };
});

const { mintaKiriman, KATEGORI_NOTIF_PERMINTAAN_TANPA_PEMEGANG } = await import("./stok-writer");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/** Notifikasi kategori ini milik toko-toko uji — dicocokkan di JS (filter JSON tidak andal lintas adaptor). */
async function notifToko(storeIds: string[]) {
  const semua = await prisma.adminNotification.findMany({
    where: { category: KATEGORI_NOTIF_PERMINTAAN_TANPA_PEMEGANG },
    orderBy: { createdAt: "asc" },
  });
  return semua.filter((n) => {
    const m = n.metadata as { storeId?: unknown } | null;
    return typeof m?.storeId === "string" && storeIds.includes(m.storeId);
  });
}

d("mintaKiriman — toko tanpa pemegang memberi tahu kantor (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let pemegangId = "";
  let spgId = "";
  let tokoTanpaId = "";
  let tokoAdaId = "";

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    pemegangId = "";
    spgId = "";
    tokoTanpaId = "";
    tokoAdaId = "";
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-MKTP-${token}`, nameId: "t", nameEn: "t" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `TEST-MKTP-${token}`, nameId: "Kaos MKTP", nameEn: "Tee MKTP", type: "FINISHED_GOOD", uomId },
      })
    ).id;
    pemegangId = (await prisma.user.create({ data: { email: `test-mktp-h-${token}@example.com`, name: "Pemegang MKTP" } })).id;
    spgId = (await prisma.user.create({ data: { email: `test-mktp-spg-${token}@example.com`, name: "SPG MKTP" } })).id;
    tokoTanpaId = (
      await prisma.store.create({ data: { code: `TEST-MKTP-A-${token}`, name: `Toko Tanpa ${token}`, address: "x", termsType: "KONSI" } })
    ).id;
    tokoAdaId = (
      await prisma.store.create({
        data: { code: `TEST-MKTP-B-${token}`, name: `Toko Ada ${token}`, address: "x", termsType: "KONSI", salesmanId: pemegangId },
      })
    ).id;
  });

  beforeEach(() => {
    sebar.dipanggil = [];
  });

  afterAll(async () => {
    const notif = await notifToko(seededIds([tokoTanpaId, tokoAdaId]));
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notif.map((n) => n.id)) } } });
    await prisma.stockRequest.deleteMany({ where: { storeId: { in: seededIds([tokoTanpaId, tokoAdaId]) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoTanpaId, tokoAdaId]) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([pemegangId, spgId]) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("writes one office notification for an unheld store, fans it out after commit, and links to the unheld filter", async () => {
    const kunci = `mktp-${token}-1`;
    const hasil = await mintaKiriman({
      storeId: tokoTanpaId,
      userId: spgId,
      baris: [{ itemId, variantSku: null, qty: 3, alasan: "TITIP_PEMBELI" }],
      idempotencyKey: kunci,
    });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    // Alasan dari titip pesan pembeli tersimpan apa adanya di barisnya.
    const baris = await prisma.stockRequestLine.findMany({ where: { requestId: hasil.requestId }, select: { qty: true, alasan: true } });
    expect(baris).toEqual([{ qty: 3, alasan: "TITIP_PEMBELI" }]);

    const notif = await notifToko([tokoTanpaId]);
    expect(notif).toHaveLength(1);
    const n = notif[0];
    expect(n.metadata).toEqual({ requestId: hasil.requestId, storeId: tokoTanpaId });
    expect(n.title).toContain(`Toko Tanpa ${token}`);
    expect(n.message).toContain("SPG MKTP");
    expect(n.message).toContain("3");
    expect(sebar.dipanggil).toEqual([{ id: n.id, category: KATEGORI_NOTIF_PERMINTAAN_TANPA_PEMEGANG }]);
    expect(getNotificationHref(n.category, { adminNotificationId: n.id, requestId: hasil.requestId, storeId: tokoTanpaId })).toBe(
      "/backoffice/spg-requests?pemegang=tanpa",
    );

    // Kiriman ulang dari HP yang jawabannya hilang: permintaan yang sama, lonceng tidak berbunyi lagi.
    sebar.dipanggil = [];
    const ulang = await mintaKiriman({ storeId: tokoTanpaId, userId: spgId, baris: [{ itemId, variantSku: null, qty: 1 }], idempotencyKey: kunci });
    expect(ulang).toEqual({ ok: true, requestId: hasil.requestId });
    expect(await notifToko([tokoTanpaId])).toHaveLength(1);
    expect(sebar.dipanggil).toEqual([]);
  });

  it("a store WITH a holder does not ring the office bell", async () => {
    const hasil = await mintaKiriman({ storeId: tokoAdaId, userId: spgId, baris: [{ itemId, variantSku: null, qty: 2 }], idempotencyKey: `mktp-${token}-2` });
    expect(hasil.ok).toBe(true);
    expect(await notifToko([tokoAdaId])).toEqual([]);
    expect(sebar.dipanggil).toEqual([]);
  });

  it("a refused request writes no notification", async () => {
    const sebelum = (await notifToko([tokoTanpaId])).length;
    const hasil = await mintaKiriman({ storeId: tokoTanpaId, userId: spgId, baris: [{ itemId, variantSku: null, qty: 0 }], idempotencyKey: `mktp-${token}-3` });
    expect(hasil).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(await notifToko([tokoTanpaId])).toHaveLength(sebelum);
    expect(sebar.dipanggil).toEqual([]);
  });

  it("two simultaneous submits with the same key make ONE request and ONE notification", async () => {
    const kunci = `mktp-${token}-4`;
    const sebelum = (await notifToko([tokoTanpaId])).length;
    const isi = { storeId: tokoTanpaId, userId: spgId, baris: [{ itemId, variantSku: null, qty: 1 }], idempotencyKey: kunci };
    const [a, b] = await Promise.all([mintaKiriman(isi), mintaKiriman(isi)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.requestId).toBe(b.requestId);
    expect(await prisma.stockRequest.count({ where: { idempotencyKey: kunci } })).toBe(1);
    const sesudah = await notifToko([tokoTanpaId]);
    expect(sesudah).toHaveLength(sebelum + 1);
    expect(sebar.dipanggil).toHaveLength(1);
  });
});
