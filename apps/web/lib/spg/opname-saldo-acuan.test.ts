import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { kurangDariOpname } from "./hilang";

/*
 * Opname toko dibandingkan dengan saldo buku SAAT BARANG DIHITUNG, bukan saat
 * opname disimpan — terhadap basis data uji. Penjualan atau kiriman yang
 * tercatat di antara keduanya tidak boleh menjadi selisih (lebih palsu yang
 * kelak menjadi barang hilang SPG, atau kurang palsu seketika).
 *
 * Kait sesudah transaksi (titip pesan, barang hilang) ditirukan; yang dites
 * buku stok dan baris opname. Teardown hanya lewat id yang diseed.
 */

vi.mock("./titip-tersedia", () => ({ kabariTitipanTersedia: vi.fn(async () => undefined) }));
vi.mock("./hilang-sumber", () => ({
  catatHilangDariOpname: vi.fn(async () => undefined),
  catatHilangDariPenerimaan: vi.fn(async () => undefined),
}));

const { catatOpname } = await import("./stok-writer");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `OPA-${Math.random().toString(36).slice(2, 9)}`;
const MENIT = 60_000;

d("opname toko: saldo acuan saat dihitung (test bed only)", () => {
  let uomId = "";
  let kemeja = "";
  let tokoId = "";
  let spgId = "";

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kemeja = (
      await prisma.item.create({
        data: { sku: `${tag}-KMJ`, nameId: "Kemeja Acuan", nameEn: "Reference shirt", type: "FINISHED_GOOD", uomId, sellingPrice: 100_000 },
      })
    ).id;
    // KONSI: kekurangan opname di toko inilah yang menjadi barang hilang SPG.
    tokoId = (
      await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "KONSI", markupPercent: 25 } })
    ).id;
    spgId = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: tokoId } })).id;
  });

  afterEach(async () => {
    await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.storeOpname.deleteMany({ where: { storeId: seededId(tokoId) } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: seededId(spgId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.item.deleteMany({ where: { id: seededId(kemeja) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const saldo = async () =>
    (await prisma.storeStockMovement.aggregate({ where: { storeId: tokoId, itemId: kemeja, variantSku: "" }, _sum: { qty: true } }))._sum.qty ?? 0;

  const gerak = (qty: number, kind: "OPNAME" | "JUAL" | "TERIMA", createdAt: Date) =>
    prisma.storeStockMovement.create({ data: { storeId: tokoId, itemId: kemeja, variantSku: "", qty, kind, createdById: spgId, createdAt } });

  const opname = (qtyCounted: number, umurHitungMs: number | undefined, sekarang: Date) =>
    catatOpname({
      storeId: tokoId,
      userId: spgId,
      baris: [{ itemId: kemeja, variantSku: null, qtyCounted, ...(umurHitungMs === undefined ? {} : { umurHitungMs }) }],
      sekarang,
    });

  const barisOpname = (opnameId: string) =>
    prisma.storeOpnameLine.findMany({
      where: { opnameId },
      select: { itemId: true, variantSku: true, productName: true, qtySystem: true, qtyCounted: true, countedAt: true },
    });

  it("saldo 10, rak dihitung 10, lalu 2 terjual sebelum disimpan → selisih 0 dan buku 8, bukan lebih 2", async () => {
    const sekarang = new Date();
    await gerak(10, "OPNAME", new Date(sekarang.getTime() - 60 * MENIT));
    // Dihitung 30 menit lalu; 2 potong terjual 10 menit lalu (sesudah dihitung).
    await gerak(-2, "JUAL", new Date(sekarang.getTime() - 10 * MENIT));

    const h = await opname(10, 30 * MENIT, sekarang);
    if (!h.ok) throw new Error(h.alasan);
    expect(h.selisih).toBe(0);
    expect(await saldo()).toBe(8);

    const [l] = await barisOpname(h.opnameId);
    expect(l).toMatchObject({ qtySystem: 10, qtyCounted: 10 });
    expect(l.countedAt?.getTime()).toBe(sekarang.getTime() - 30 * MENIT);
  });

  it("saldo 10, mulai hitung, 2 terjual selama menghitung, hitungan 8 → selisih 0 (bukan −2)", async () => {
    const sekarang = new Date();
    await gerak(10, "OPNAME", new Date(sekarang.getTime() - 60 * MENIT));
    // Terjual 20 menit lalu, rak dihitung 10 menit lalu: yang tersisa di rak 8.
    await gerak(-2, "JUAL", new Date(sekarang.getTime() - 20 * MENIT));

    const h = await opname(8, 10 * MENIT, sekarang);
    if (!h.ok) throw new Error(h.alasan);
    expect(h.selisih).toBe(0);
    expect(await saldo()).toBe(8);
    const lines = await barisOpname(h.opnameId);
    expect(lines[0]).toMatchObject({ qtySystem: 8, qtyCounted: 8 });
    // Tidak ada kekurangan → tidak ada barang hilang yang dibebankan ke SPG.
    expect(kurangDariOpname(lines)).toEqual([]);
  });

  it("rak dihitung 3, lalu kiriman 5 diterima sebelum disimpan → bukan kurang 5 (barang hilang palsu)", async () => {
    const sekarang = new Date();
    await gerak(3, "OPNAME", new Date(sekarang.getTime() - 120 * MENIT));
    await gerak(5, "TERIMA", new Date(sekarang.getTime() - 15 * MENIT));

    const h = await opname(3, 30 * MENIT, sekarang);
    if (!h.ok) throw new Error(h.alasan);
    expect(h.selisih).toBe(0);
    expect(await saldo()).toBe(8);
    const lines = await barisOpname(h.opnameId);
    expect(kurangDariOpname(lines)).toEqual([]);
  });

  it("kekurangan sungguhan tetap tercatat, bertanggal saat dihitung: 10 di buku, rak 9, lalu 2 terjual", async () => {
    const sekarang = new Date();
    await gerak(10, "OPNAME", new Date(sekarang.getTime() - 60 * MENIT));
    await gerak(-2, "JUAL", new Date(sekarang.getTime() - 5 * MENIT));

    const h = await opname(9, 30 * MENIT, sekarang);
    if (!h.ok) throw new Error(h.alasan);
    expect(h.selisih).toBe(1);
    // 9 dihitung, lalu 2 terjual → rak 7.
    expect(await saldo()).toBe(7);
    const lines = await barisOpname(h.opnameId);
    expect(kurangDariOpname(lines)).toEqual([expect.objectContaining({ itemId: kemeja, qty: 1 })]);
    const opn = await prisma.storeStockMovement.findFirst({ where: { refType: "StoreOpname", refId: h.opnameId }, select: { qty: true, createdAt: true } });
    expect(opn).toEqual({ qty: -1, createdAt: new Date(sekarang.getTime() - 30 * MENIT) });
  });

  it("hitungan yang lebih lama dilewati kalau barang yang sama sudah dihitung opname lain sesudahnya", async () => {
    const sekarang = new Date();
    await gerak(10, "OPNAME", new Date(sekarang.getTime() - 120 * MENIT));
    // SPG lain menghitung 10 menit lalu dan menemukan 9.
    const baru = await opname(9, 10 * MENIT, sekarang);
    if (!baru.ok) throw new Error(baru.alasan);
    expect(await saldo()).toBe(9);

    // Draf yang dihitung 40 menit lalu (sebelum hitungan itu) baru disimpan sekarang.
    const lama = await opname(10, 40 * MENIT, new Date(sekarang.getTime() + 1_000));
    if (!lama.ok) throw new Error(lama.alasan);
    expect(lama).toMatchObject({ selisih: 0, dilewati: 1 });
    expect(await saldo()).toBe(9);
  });

  it("dua opname yang menemukan rak yang sama (9 dari 10) disimpan bersamaan → buku 9, bukan 8", async () => {
    const sekarang = new Date();
    await gerak(10, "OPNAME", new Date(sekarang.getTime() - 120 * MENIT));
    const [a, b] = await Promise.all([opname(9, 20 * MENIT, sekarang), opname(9, 10 * MENIT, sekarang)]);
    if (!a.ok || !b.ok) throw new Error("opname gagal");
    expect(await saldo()).toBe(9);
    const koreksi = await prisma.storeStockMovement.findMany({ where: { storeId: tokoId, kind: "OPNAME", refType: "StoreOpname" }, select: { qty: true } });
    expect(koreksi.reduce((s, g) => s + g.qty, 0)).toBe(-1);
  });

  it("antrean HP dengan umur: dihitung 10 sebelum dua penjualan, ditangkap sesudahnya → buku 7, bukan 9", async () => {
    const sekarang = new Date();
    await gerak(10, "OPNAME", new Date(sekarang.getTime() - 120 * MENIT));
    // Rak dihitung 90 menit lalu (10), opname masuk antrean 60 menit lalu.
    await gerak(-2, "JUAL", new Date(sekarang.getTime() - 70 * MENIT));
    await gerak(-1, "JUAL", new Date(sekarang.getTime() - 30 * MENIT));

    const h = await catatOpname({
      storeId: tokoId,
      userId: spgId,
      baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 10, umurHitungMs: 30 * MENIT }],
      waktuTangkap: new Date(sekarang.getTime() - 60 * MENIT),
      sekarang,
    });
    if (!h.ok) throw new Error(h.alasan);
    expect(h.selisih).toBe(0);
    expect(await saldo()).toBe(7);
    const [l] = await barisOpname(h.opnameId);
    expect(l).toMatchObject({ qtySystem: 10, qtyCounted: 10 });
    expect(l.countedAt?.getTime()).toBe(sekarang.getTime() - 90 * MENIT);
  });

  it("tanpa umur hitungan (klien lama) tetap memakai saldo saat disimpan", async () => {
    const sekarang = new Date();
    await gerak(10, "OPNAME", new Date(sekarang.getTime() - 60 * MENIT));
    await gerak(-2, "JUAL", new Date(sekarang.getTime() - 10 * MENIT));

    const h = await opname(8, undefined, sekarang);
    if (!h.ok) throw new Error(h.alasan);
    expect(h).toEqual({ ok: true, opnameId: h.opnameId, selisih: 0 });
    const [l] = await barisOpname(h.opnameId);
    expect(l).toMatchObject({ qtySystem: 8, countedAt: null });
  });
});
