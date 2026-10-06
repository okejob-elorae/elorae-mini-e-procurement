import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * `mintaKiriman` terhadap basis data sungguhan: alasan per baris tersimpan dan
 * divalidasi, kiriman ulang dengan kunci yang sama tidak membuat permintaan
 * kedua (juga bila dua kiriman datang BERSAMAAN), dan salesman pemegang toko
 * dikabari tepat sekali — hanya untuk permintaan yang baru dibuat.
 *
 * Jangan pernah dijalankan ke basis data produksi (terowongan :3307 / host VPS).
 */

const kabar = vi.hoisted(() => ({ kirim: [] as { userId: string; jenis: string; data: Record<string, string> }[] }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => {
  const m = await asli<typeof import("@/lib/notifications/kabar-pengguna")>();
  return {
    ...m,
    kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; data: Record<string, string> }) => {
      kabar.kirim.push({ userId, jenis: k.jenis, data: k.data });
    }),
  };
});

const { mintaKiriman, KATEGORI_NOTIF_PERMINTAAN_TANPA_PEMEGANG } = await import("./stok-writer");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("mintaKiriman — alasan, kunci kiriman, kabar pemegang toko (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let pemegangId = "";
  let spgId = "";
  let tokoId = "";
  let tokoTanpaId = "";

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    pemegangId = "";
    spgId = "";
    tokoId = "";
    tokoTanpaId = "";
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-MK-${token}`, nameId: "t", nameEn: "t" } })).id;
    itemId = (
      await prisma.item.create({
        data: {
          sku: `TEST-MK-${token}`,
          nameId: "Kaos MK",
          nameEn: "Tee MK",
          type: "FINISHED_GOOD",
          uomId,
          variants: [{ sku: `TEST-MK-${token}-M`, size: "M" }],
        },
      })
    ).id;
    pemegangId = (await prisma.user.create({ data: { email: `test-mk-h-${token}@example.com`, name: "Pemegang MK" } })).id;
    spgId = (await prisma.user.create({ data: { email: `test-mk-spg-${token}@example.com`, name: "SPG MK" } })).id;
    tokoId = (
      await prisma.store.create({ data: { code: `TEST-MK-A-${token}`, name: "Toko MK", address: "x", termsType: "KONSI", salesmanId: pemegangId } })
    ).id;
    tokoTanpaId = (await prisma.store.create({ data: { code: `TEST-MK-B-${token}`, name: "Toko MK tanpa pemegang", address: "x", termsType: "KONSI" } })).id;
  });

  beforeEach(() => {
    kabar.kirim = [];
  });

  afterAll(async () => {
    // Toko tanpa pemegang membunyikan lonceng kantor (`AdminNotification`) — dibersihkan
    // juga, dicocokkan di JS lewat metadata.storeId (filter JSON tidak andal lintas adaptor).
    const notif = (
      await prisma.adminNotification.findMany({
        where: { category: KATEGORI_NOTIF_PERMINTAAN_TANPA_PEMEGANG },
        select: { id: true, metadata: true },
      })
    ).filter((n) => {
      const m = n.metadata as { storeId?: unknown } | null;
      return typeof m?.storeId === "string" && seededIds([tokoId, tokoTanpaId]).includes(m.storeId);
    });
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notif.map((n) => n.id)) } } });
    await prisma.stockRequest.deleteMany({ where: { storeId: { in: seededIds([tokoId, tokoTanpaId]) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoId, tokoTanpaId]) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([pemegangId, spgId]) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const varian = () => `TEST-MK-${token}-M`;

  it("stores a reason per line (a suggestion beats MANUAL when merged) and notifies the store holder once", async () => {
    const kunci = `mk-${token}-1`;
    const hasil = await mintaKiriman({
      storeId: tokoId,
      userId: spgId,
      baris: [
        { itemId, variantSku: varian(), qty: 2, alasan: "LAKU_DI_TOKO_LAIN" },
        { itemId, variantSku: varian(), qty: 1, alasan: "MANUAL" },
        { itemId, variantSku: null, qty: 1 },
      ],
      idempotencyKey: kunci,
    });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    const baris = await prisma.stockRequestLine.findMany({ where: { requestId: hasil.requestId }, orderBy: { variantSku: "asc" } });
    expect(baris.map((b) => [b.variantSku, b.qty, b.alasan, b.productName])).toEqual([
      ["", 1, "MANUAL", "Kaos MK"],
      [varian(), 3, "LAKU_DI_TOKO_LAIN", "Kaos MK — size: M"],
    ]);
    expect(kabar.kirim).toEqual([{ userId: pemegangId, jenis: "PERMINTAAN_SPG_MASUK", data: { requestId: hasil.requestId } }]);

    // Kiriman ulang dari HP yang jawabannya hilang: permintaan yang sama, tanpa kabar kedua.
    kabar.kirim = [];
    const ulang = await mintaKiriman({ storeId: tokoId, userId: spgId, baris: [{ itemId, variantSku: null, qty: 9 }], idempotencyKey: kunci });
    expect(ulang).toEqual({ ok: true, requestId: hasil.requestId });
    expect(kabar.kirim).toEqual([]);
    expect(await prisma.stockRequest.count({ where: { idempotencyKey: kunci } })).toBe(1);
  });

  it("refuses an unknown reason and writes nothing", async () => {
    const sebelum = await prisma.stockRequest.count({ where: { storeId: tokoId } });
    const hasil = await mintaKiriman({
      storeId: tokoId,
      userId: spgId,
      baris: [{ itemId, variantSku: null, qty: 1, alasan: "DICARI" }],
      idempotencyKey: `mk-${token}-2`,
    });
    expect(hasil).toEqual({ ok: false, alasan: "ALASAN_TIDAK_VALID" });
    expect(await prisma.stockRequest.count({ where: { storeId: tokoId } })).toBe(sebelum);
    expect(kabar.kirim).toEqual([]);
  });

  it("a store without a holder still records the request, and notifies no salesperson (the office bell: minta-kiriman-tanpa-pemegang.test)", async () => {
    const hasil = await mintaKiriman({ storeId: tokoTanpaId, userId: spgId, baris: [{ itemId, variantSku: null, qty: 2 }], idempotencyKey: `mk-${token}-3` });
    expect(hasil.ok).toBe(true);
    expect(kabar.kirim).toEqual([]);
  });

  it("two simultaneous submits with the same key make ONE request, and one notification", async () => {
    const kunci = `mk-${token}-4`;
    const isi = { storeId: tokoId, userId: spgId, baris: [{ itemId, variantSku: null, qty: 1, alasan: "BARANG_BARU" }], idempotencyKey: kunci };
    const [a, b] = await Promise.all([mintaKiriman(isi), mintaKiriman(isi)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.requestId).toBe(b.requestId);
    expect(await prisma.stockRequest.count({ where: { idempotencyKey: kunci } })).toBe(1);
    expect(kabar.kirim).toHaveLength(1);
  });
});
