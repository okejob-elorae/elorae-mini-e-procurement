import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { muatanOpname } from "@/lib/pwa/offline/luring-muatan";

/*
 * "Sudah terhitung opname" dinilai per BARIS (waktu barang itu dihitung di HP),
 * bukan per opname (waktu opname disimpan) — terhadap basis data uji.
 *
 * Rak dihitung jam 09.00, opname baru disimpan jam 10.00. Penjualan tanpa
 * sinyal jam 09.30 terjadi SESUDAH barang itu dihitung: opname tidak
 * melihatnya, jadi buku tetap harus dipotong. Dulu dilewati karena opname
 * "disimpan" jam 10.00 — buku terlalu tinggi, dan opname berikutnya
 * menunjukkan kekurangan yang dibebankan ke SPG. Sebaliknya penjualan jam 08.30
 * (sebelum dihitung) tetap dilewati: opname sudah melihat rak tanpanya.
 *
 * Kait sesudah transaksi (titip pesan, barang hilang) ditirukan. Teardown
 * hanya lewat id yang diseed.
 */

vi.mock("./titip-tersedia", () => ({ kabariTitipanTersedia: vi.fn(async () => undefined) }));
vi.mock("./hilang-sumber", () => ({
  catatHilangDariOpname: vi.fn(async () => undefined),
  catatHilangDariPenerimaan: vi.fn(async () => undefined),
}));

const { catatOpname } = await import("./stok-writer");
const { recordSpgSale } = await import("./sale-writer");
const { catatReturPembeli } = await import("./retur-pembeli");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `OPB-${Math.random().toString(36).slice(2, 9)}`;
const MENIT = 60_000;

d("opname toko: sudah terhitung per baris (test bed only)", () => {
  let uomId = "";
  let kemeja = "";
  let tokoId = "";
  let spgId = "";
  const nota: string[] = [];

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kemeja = (
      await prisma.item.create({
        data: { sku: `${tag}-KMJ`, nameId: "Kemeja Per Baris", nameEn: "Per-line shirt", type: "FINISHED_GOOD", uomId, sellingPrice: 100_000 },
      })
    ).id;
    // Toko PUTUS: kekurangan opname di sini tidak membuka barang hilang (yang tetap ditirukan).
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    spgId = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: tokoId } })).id;
  });

  beforeEach(() => {
    nota.length = 0;
  });

  afterEach(async () => {
    const semuaNota = (await prisma.spgSale.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } })).map((n) => n.id);
    const retur = (await prisma.spgSaleReturn.findMany({ where: { spgSaleId: { in: seededIds(semuaNota) } }, select: { id: true } })).map((r) => r.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "SpgSaleReturn", entityId: { in: seededIds(retur) } } });
    await prisma.spgSaleReturnLine.deleteMany({ where: { returnId: { in: seededIds(retur) } } });
    await prisma.spgSaleReturn.deleteMany({ where: { id: { in: seededIds(retur) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(kemeja) } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(semuaNota) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(semuaNota) } } });
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

  const bukaBuku = (qty: number, createdAt: Date) =>
    prisma.storeStockMovement.create({ data: { storeId: tokoId, itemId: kemeja, variantSku: "", qty, kind: "OPNAME", createdById: spgId, createdAt } });

  /** Opname disimpan `sekarang`, barangnya dihitung `umur` sebelumnya. */
  async function opname(qtyCounted: number, umur: number, sekarang: Date) {
    const h = await catatOpname({
      storeId: tokoId,
      userId: spgId,
      baris: [{ itemId: kemeja, variantSku: null, qtyCounted, umurHitungMs: umur }],
      sekarang,
    });
    if (!h.ok) throw new Error(h.alasan);
    return h;
  }

  /** Penjualan dari antrean HP: terjadi `waktuJual`, sampai di server `sekarang`. */
  async function jualLuring(waktuJual: Date, sekarang: Date) {
    const r = await recordSpgSale({
      salesmanId: spgId,
      storeId: tokoId,
      lines: [{ itemId: kemeja, variantSku: null, qty: 1 }],
      luring: true,
      waktuJual,
      sekarang,
      idempotencyKey: `${tag}-jual-${nota.length}-${waktuJual.getTime()}`,
    });
    if (!r.ok) throw new Error(r.code);
    nota.push(r.spgSaleId);
    return r;
  }

  /** Nota kemarin (2 potong) yang barangnya sudah keluar dari buku sebelum opname. */
  async function notaKemarin() {
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-SPG-${nota.length}`,
        salesmanId: spgId,
        storeId: tokoId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: spgId,
        createdAt: new Date(Date.now() - 86_400_000),
        lines: { create: [{ itemId: kemeja, productName: "Kemeja Per Baris", qty: 2, unitPrice: 100_000, lineTotal: 200_000 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    nota.push(s.id);
    return { id: s.id, baris: s.lines[0].id };
  }

  const kembalikan = (n: { id: string; baris: string }, waktuTangkap: Date) =>
    catatReturPembeli({
      spgSaleId: n.id,
      storeId: tokoId,
      userId: spgId,
      baris: [{ saleLineId: n.baris, qty: 1, condition: "LAYAK" }],
      alasan: "ukuran",
      idempotencyKey: `${tag}-rp-${waktuTangkap.getTime()}`,
      waktuTangkap,
    });

  it("jual tanpa sinyal SESUDAH rak dihitung tapi sebelum opname disimpan tetap memotong buku: 10 → 9, bukan tetap 10", async () => {
    const sekarang = new Date();
    await bukaBuku(10, new Date(sekarang.getTime() - 120 * MENIT));
    // Rak dihitung 60 menit lalu (10), opname disimpan sekarang.
    await opname(10, 60 * MENIT, sekarang);
    expect(await saldo()).toBe(10);

    // Terjual 30 menit lalu — sesudah dihitung — notanya baru sampai sekarang.
    const r = await jualLuring(new Date(sekarang.getTime() - 30 * MENIT), new Date(sekarang.getTime() + 1_000));
    expect(await saldo()).toBe(9);
    const jual = await prisma.storeStockMovement.findMany({ where: { refType: "SpgSale", refId: r.spgSaleId }, select: { qty: true, kind: true, createdAt: true } });
    expect(jual).toEqual([{ qty: -1, kind: "JUAL", createdAt: new Date(sekarang.getTime() - 30 * MENIT) }]);
  });

  it("jual tanpa sinyal SEBELUM rak dihitung tetap dilewati — opname sudah melihat raknya tanpa barang itu: buku 9, bukan 8", async () => {
    const sekarang = new Date();
    await bukaBuku(10, new Date(sekarang.getTime() - 120 * MENIT));
    // Terjual 90 menit lalu (belum sampai), rak dihitung 60 menit lalu: 9.
    const h = await opname(9, 60 * MENIT, sekarang);
    expect(h.selisih).toBe(1);
    expect(await saldo()).toBe(9);

    const r = await jualLuring(new Date(sekarang.getTime() - 90 * MENIT), new Date(sekarang.getTime() + 1_000));
    expect(await saldo()).toBe(9);
    expect(await prisma.storeStockMovement.count({ where: { refType: "SpgSale", refId: r.spgSaleId } })).toBe(0);
    // Notanya sendiri tetap tercatat utuh.
    expect(await prisma.salesHistory.count({ where: { orderId: r.docNo } })).toBe(1);
  });

  it("opname lama tanpa waktu hitung per baris tetap memakai waktu opnamenya", async () => {
    const sekarang = new Date();
    await bukaBuku(10, new Date(sekarang.getTime() - 120 * MENIT));
    // Opname dari klien lama: baris tanpa waktu hitung, opname tercatat 60 menit lalu.
    await prisma.storeOpname.create({
      data: {
        storeId: tokoId,
        countedById: spgId,
        countedAt: new Date(sekarang.getTime() - 60 * MENIT),
        lines: { create: [{ itemId: kemeja, variantSku: "", productName: "Kemeja Per Baris", qtySystem: 10, qtyCounted: 10 }] },
      },
    });
    await jualLuring(new Date(sekarang.getTime() - 90 * MENIT), sekarang);
    expect(await saldo()).toBe(10);
    await jualLuring(new Date(sekarang.getTime() - 30 * MENIT), sekarang);
    expect(await saldo()).toBe(9);
  });

  it("retur pembeli tanpa sinyal SESUDAH rak dihitung kembali ke buku: 3 → 4, bukan tetap 3", async () => {
    const sekarang = new Date();
    await bukaBuku(3, new Date(sekarang.getTime() - 2 * 86_400_000));
    const n = await notaKemarin();
    await opname(3, 60 * MENIT, sekarang);
    expect(await saldo()).toBe(3);

    const r = await kembalikan(n, new Date(sekarang.getTime() - 30 * MENIT));
    if (!r.ok) throw new Error(r.alasan);
    expect(await saldo()).toBe(4);
  });

  it("retur pembeli tanpa sinyal SEBELUM rak dihitung tidak dihitung dua kali: buku 4, bukan 5", async () => {
    const sekarang = new Date();
    await bukaBuku(3, new Date(sekarang.getTime() - 2 * 86_400_000));
    const n = await notaKemarin();
    // Dikembalikan 90 menit lalu (belum sampai), rak dihitung 60 menit lalu: 4.
    const h = await opname(4, 60 * MENIT, sekarang);
    expect(h.selisih).toBe(1);
    expect(await saldo()).toBe(4);

    const r = await kembalikan(n, new Date(sekarang.getTime() - 90 * MENIT));
    if (!r.ok) throw new Error(r.alasan);
    expect(await saldo()).toBe(4);
    // Notanya tetap tahu barangnya kembali.
    expect((await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: n.baris }, select: { returnedQty: true } })).returnedQty).toBe(1);
  });

  it("opname dari antrean HP membawa umur hitungan: dihitung 10 sebelum 2 terjual, ditangkap sesudahnya → buku 8, bukan 10", async () => {
    const sekarang = new Date();
    await bukaBuku(10, new Date(sekarang.getTime() - 180 * MENIT));
    // Rak dihitung 90 menit lalu; 2 terjual (dengan sinyal) 70 menit lalu; opname masuk antrean 60 menit lalu.
    await prisma.storeStockMovement.create({
      data: { storeId: tokoId, itemId: kemeja, variantSku: "", qty: -2, kind: "JUAL", createdById: spgId, createdAt: new Date(sekarang.getTime() - 70 * MENIT) },
    });
    const m = muatanOpname({
      localId: `${tag}-antre`,
      storeId: tokoId,
      waktu: sekarang.getTime() - 60 * MENIT,
      visitId: null,
      visitClientId: null,
      baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 10, productName: "Kemeja Per Baris", umurHitungMs: 30 * MENIT }],
      note: null,
    });
    // Sama dengan yang diteruskan `catatOpnameAction` ke penulis.
    const h = await catatOpname({
      storeId: tokoId,
      userId: spgId,
      baris: m.baris,
      idempotencyKey: m.idempotencyKey,
      waktuTangkap: new Date(m.waktuTangkap),
      sekarang,
    });
    if (!h.ok) throw new Error(h.alasan);
    expect(h.selisih).toBe(0);
    expect(await saldo()).toBe(8);
    const baris = await prisma.storeOpnameLine.findFirstOrThrow({ where: { opnameId: h.opnameId }, select: { qtySystem: true, countedAt: true } });
    expect(baris).toEqual({ qtySystem: 10, countedAt: new Date(sekarang.getTime() - 90 * MENIT) });
  });
});
