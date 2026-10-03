import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Terima kiriman dan opname dari antrean HP (dicatat tanpa sinyal), terhadap
 * basis data uji: kunci kiriman diperiksa PALING DULU (kiriman ulang tidak
 * pernah menggandakan buku stok, termasuk saat bersamaan), pekerjaan bertanggal
 * waktu tangkap, dan saldo sistem opname dinilai server per WAKTU HITUNG —
 * penjualan sesudah hitungan yang terkirim lebih dulu tidak dikembalikan ke buku.
 *
 * Kait sesudah transaksi (titip pesan, barang hilang) ditirukan: yang dites di
 * sini hanya buku stok. Semua baris milik fixture bertag acak; teardown hanya
 * lewat id yang diseed (`seededId`/`seededIds`).
 */

vi.mock("./titip-tersedia", () => ({ kabariTitipanTersedia: vi.fn(async () => undefined) }));
vi.mock("./hilang-sumber", () => ({
  catatHilangDariOpname: vi.fn(async () => undefined),
  catatHilangDariPenerimaan: vi.fn(async () => undefined),
}));

const { catatOpname, terimaKiriman } = await import("./stok-writer");
const { catatReturPembeli } = await import("./retur-pembeli");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `LRG-${Math.random().toString(36).slice(2, 9)}`;

d("stok toko dari antrean HP (test bed only)", () => {
  let uomId = "";
  let kemeja = "";
  let tokoId = "";
  let spgId = "";
  let kirimKe = 0;
  const kiriman: string[] = [];
  const nota: string[] = [];

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kemeja = (
      await prisma.item.create({
        data: { sku: `${tag}-KMJ`, nameId: "Kemeja Luring", nameEn: "Offline shirt", type: "FINISHED_GOOD", uomId, sellingPrice: 80_000 },
      })
    ).id;
    // Toko PUTUS: opname yang kurang di sini tidak membuka barang hilang.
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    spgId = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: tokoId } })).id;
  });

  beforeEach(() => {
    kiriman.length = 0;
    nota.length = 0;
  });

  afterEach(async () => {
    const retur = (await prisma.spgSaleReturn.findMany({ where: { spgSaleId: { in: seededIds([...nota]) } }, select: { id: true } })).map((r) => r.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "SpgSaleReturn", entityId: { in: seededIds(retur) } } });
    await prisma.spgSaleReturnLine.deleteMany({ where: { returnId: { in: seededIds(retur) } } });
    await prisma.spgSaleReturn.deleteMany({ where: { id: { in: seededIds(retur) } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds([...nota]) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds([...nota]) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.storeOpname.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.storeReceipt.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds([...kiriman]) } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: seededId(spgId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.item.deleteMany({ where: { id: seededId(kemeja) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const saldo = async () =>
    (await prisma.storeStockMovement.aggregate({ where: { storeId: tokoId, itemId: kemeja, variantSku: "" }, _sum: { qty: true } }))._sum.qty ?? 0;

  /** Kiriman konsinyasi ke toko uji: kemeja `qty` potong. */
  async function kirim(qty = 5) {
    const k = await prisma.consignmentShipment.create({
      data: {
        noKirim: `${tag}-KRM-${kirimKe++}`,
        storeId: tokoId,
        shippedAt: new Date(Date.now() - 2 * 86_400_000),
        items: { create: [{ itemId: kemeja, itemName: "Kemeja Luring", qty, price: 0, amount: 0 }] },
      },
      select: { id: true, items: { select: { id: true } } },
    });
    kiriman.push(k.id);
    return { id: k.id, baris: k.items[0].id };
  }

  const terima = (k: { id: string; baris: string }, qty: number, lain: { idempotencyKey?: string; waktuTangkap?: Date } = {}) =>
    terimaKiriman({
      storeId: tokoId,
      userId: spgId,
      sourceType: "KONSI_SHIPMENT",
      sourceId: k.id,
      diterima: [{ lineId: k.baris, qtyReceived: qty }],
      ...lain,
    });

  /** Buku dimulai (opname pembuka) pada waktu tertentu. */
  const bukaBuku = (qty: number, createdAt: Date) =>
    prisma.storeStockMovement.create({ data: { storeId: tokoId, itemId: kemeja, variantSku: "", qty, kind: "OPNAME", createdById: spgId, createdAt } });

  it("a resend with the same key returns the same receipt and moves the book once — even while it reads 'already received'", async () => {
    const k = await kirim(5);
    const waktu = new Date(Date.now() - 3 * 3_600_000);
    const pertama = await terima(k, 5, { idempotencyKey: `${tag}-k1`, waktuTangkap: waktu });
    if (!pertama.ok) throw new Error(pertama.alasan);
    const kedua = await terima(k, 5, { idempotencyKey: `${tag}-k1`, waktuTangkap: waktu });
    expect(kedua).toEqual({ ok: true, receiptId: pertama.receiptId });
    expect(await saldo()).toBe(5);

    // Dicatat pada waktu dihitung di HP, bukan saat terkirim.
    const r = await prisma.storeReceipt.findUniqueOrThrow({ where: { id: pertama.receiptId }, select: { receivedAt: true, idempotencyKey: true } });
    expect(r).toEqual({ receivedAt: waktu, idempotencyKey: `${tag}-k1` });
    const gerak = await prisma.storeStockMovement.findMany({ where: { storeId: tokoId }, select: { createdAt: true, kind: true } });
    expect(gerak).toEqual([{ createdAt: waktu, kind: "TERIMA" }]);

    // HP lain (kunci lain) untuk kiriman yang sama tetap ditolak.
    expect(await terima(k, 5, { idempotencyKey: `${tag}-k2` })).toEqual({ ok: false, alasan: "SUDAH_DITERIMA" });
    expect(await saldo()).toBe(5);
  });

  it("two sends with the same key at the same moment record one receipt, and both are told so", async () => {
    const k = await kirim(4);
    const hasil = await Promise.all([terima(k, 4, { idempotencyKey: `${tag}-balap` }), terima(k, 4, { idempotencyKey: `${tag}-balap` })]);
    expect(hasil.every((h) => h.ok)).toBe(true);
    const ids = new Set(hasil.map((h) => (h.ok ? h.receiptId : "")));
    expect(ids.size).toBe(1);
    expect(await prisma.storeReceipt.count({ where: { storeId: tokoId } })).toBe(1);
    expect(await saldo()).toBe(4);
  });

  it("two opnames with the same key at the same moment adjust the book once", async () => {
    await bukaBuku(5, new Date(Date.now() - 86_400_000));
    const isi = { storeId: tokoId, userId: spgId, baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 2 }], idempotencyKey: `${tag}-op-balap` };
    const hasil = await Promise.all([catatOpname(isi), catatOpname(isi)]);
    expect(hasil.every((h) => h.ok)).toBe(true);
    expect(new Set(hasil.map((h) => (h.ok ? h.opnameId : ""))).size).toBe(1);
    expect(await prisma.storeOpname.count({ where: { storeId: tokoId } })).toBe(1);
    expect(await saldo()).toBe(2);
  });

  it("refuses a count captured longer ago than the offline window", async () => {
    const k = await kirim(2);
    expect(await terima(k, 2, { idempotencyKey: `${tag}-tua`, waktuTangkap: new Date(Date.now() - 15 * 86_400_000) })).toEqual({
      ok: false,
      alasan: "WAKTU_TIDAK_VALID",
    });
    expect(await prisma.storeReceipt.count({ where: { storeId: tokoId } })).toBe(0);
  });

  it("an opname resent with the same key adjusts the book once", async () => {
    await bukaBuku(5, new Date(Date.now() - 86_400_000));
    const isi = { storeId: tokoId, userId: spgId, baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 3 }], idempotencyKey: `${tag}-op` };
    const pertama = await catatOpname(isi);
    if (!pertama.ok) throw new Error(pertama.alasan);
    const kedua = await catatOpname(isi);
    expect(kedua).toEqual({ ok: true, opnameId: pertama.opnameId, selisih: 1 });
    expect(await prisma.storeOpname.count({ where: { storeId: tokoId } })).toBe(1);
    expect(await saldo()).toBe(3);
  });

  it("an offline opname is judged against the book AS OF its count — a sale after the count that arrived first stays sold", async () => {
    const hitung = new Date(Date.now() - 4 * 3_600_000);
    await bukaBuku(5, new Date(hitung.getTime() - 3_600_000));
    // Nota tanpa sinyal, terjual SESUDAH menghitung, terkirim lebih dulu (urutan antrean: nota → stok).
    await prisma.storeStockMovement.create({
      data: { storeId: tokoId, itemId: kemeja, variantSku: "", qty: -2, kind: "JUAL", refType: "SpgSale", refId: `${tag}-nota`, createdById: spgId, createdAt: new Date(hitung.getTime() + 3_600_000) },
    });
    const h = await catatOpname({
      storeId: tokoId,
      userId: spgId,
      baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 4 }],
      idempotencyKey: `${tag}-op-luring`,
      waktuTangkap: hitung,
    });
    expect(h).toMatchObject({ ok: true, selisih: 1, dilewati: 0 });
    // Rak saat dihitung: 4. Sesudahnya terjual 2. Buku harus 2 — bukan 4.
    expect(await saldo()).toBe(2);
    const op = await prisma.storeOpname.findFirstOrThrow({ where: { storeId: tokoId }, select: { countedAt: true, lines: { select: { qtySystem: true, qtyCounted: true } } } });
    expect(op.countedAt).toEqual(hitung);
    expect(op.lines).toEqual([{ qtySystem: 5, qtyCounted: 4 }]);
  });

  it("an offline opname that arrives after a NEWER count of the same goods is recorded but does not touch the book", async () => {
    await bukaBuku(5, new Date(Date.now() - 86_400_000));
    const baru = await catatOpname({ storeId: tokoId, userId: spgId, baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 6 }] });
    if (!baru.ok) throw new Error(baru.alasan);
    expect(await saldo()).toBe(6);
    const lama = await catatOpname({
      storeId: tokoId,
      userId: spgId,
      baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 2 }],
      idempotencyKey: `${tag}-op-lama`,
      waktuTangkap: new Date(Date.now() - 2 * 3_600_000),
    });
    expect(lama).toMatchObject({ ok: true, selisih: 0, dilewati: 1 });
    expect(await saldo()).toBe(6);
  });

  it("an offline receipt counted before a newer opname adds nothing more to the book — the opname already saw it on the shelf", async () => {
    await bukaBuku(1, new Date(Date.now() - 86_400_000));
    const k = await kirim(3);
    const dihitung = new Date(Date.now() - 2 * 3_600_000);
    // Opname dengan sinyal SESUDAH kiriman dihitung: rak berisi 1 + 3.
    const op = await catatOpname({ storeId: tokoId, userId: spgId, baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 4 }] });
    if (!op.ok) throw new Error(op.alasan);
    expect(await saldo()).toBe(4);
    const r = await terima(k, 3, { idempotencyKey: `${tag}-terima-lama`, waktuTangkap: dihitung });
    expect(r.ok).toBe(true);
    expect(await saldo()).toBe(4);
    // Tanda terimanya tetap mencatat yang tiba (dasar titipan dan selisih kirim).
    const baris = await prisma.storeReceiptLine.findMany({ where: { receipt: { sourceId: k.id } }, select: { qtyReceived: true } });
    expect(baris).toEqual([{ qtyReceived: 3 }]);
  });

  /** Nota SPG kemeja `qty` potong kemarin (tanpa baris buku — buku dibuka terpisah). */
  async function jualKemarin(qty: number) {
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
        lines: { create: [{ itemId: kemeja, productName: "Kemeja Luring", qty, unitPrice: 80_000, lineTotal: 80_000 * qty }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    nota.push(s.id);
    return { id: s.id, baris: s.lines[0].id };
  }

  const kembalikan = (n: { id: string; baris: string }, kunci: string, waktuTangkap?: Date) =>
    catatReturPembeli({
      spgSaleId: n.id,
      storeId: tokoId,
      userId: spgId,
      baris: [{ saleLineId: n.baris, qty: 1, condition: "LAYAK" }],
      alasan: "ukuran",
      idempotencyKey: kunci,
      waktuTangkap,
    });

  it("an offline shopper return is dated when it happened, so an offline opname counted after it does not count it twice", async () => {
    await bukaBuku(3, new Date(Date.now() - 2 * 86_400_000));
    const n = await jualKemarin(2);
    const dikembalikan = new Date(Date.now() - 3 * 3_600_000);
    const r = await kembalikan(n, `${tag}-rp-1`, dikembalikan);
    if (!r.ok) throw new Error(r.alasan);
    expect(await saldo()).toBe(4);
    const dok = await prisma.spgSaleReturn.findUniqueOrThrow({ where: { id: r.returnId }, select: { createdAt: true } });
    expect(dok.createdAt).toEqual(dikembalikan);
    // Opname tanpa sinyal SESUDAH retur itu: rak 4 (termasuk barang yang dikembalikan).
    const op = await catatOpname({
      storeId: tokoId,
      userId: spgId,
      baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 4 }],
      idempotencyKey: `${tag}-op-sesudah-retur`,
      waktuTangkap: new Date(Date.now() - 2 * 3_600_000),
    });
    expect(op).toMatchObject({ ok: true, selisih: 0 });
    expect(await saldo()).toBe(4);
  });

  it("an offline shopper return that arrives after a newer opname adds nothing to the book — the opname already saw it on the shelf", async () => {
    await bukaBuku(3, new Date(Date.now() - 2 * 86_400_000));
    const n = await jualKemarin(2);
    const op = await catatOpname({ storeId: tokoId, userId: spgId, baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 4 }] });
    if (!op.ok) throw new Error(op.alasan);
    expect(await saldo()).toBe(4);
    const r = await kembalikan(n, `${tag}-rp-2`, new Date(Date.now() - 3 * 3_600_000));
    expect(r.ok).toBe(true);
    expect(await saldo()).toBe(4);
    // Notanya tetap tahu barangnya kembali (komisi, laporan, target memakai angka bersih).
    const baris = await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: n.baris }, select: { returnedQty: true } });
    expect(baris.returnedQty).toBe(1);
  });

  it("a counter return (no capture time) still puts the piece back on the book now", async () => {
    await bukaBuku(3, new Date(Date.now() - 2 * 86_400_000));
    const n = await jualKemarin(2);
    const r = await kembalikan(n, `${tag}-rp-3`);
    expect(r.ok).toBe(true);
    expect(await saldo()).toBe(4);
  });

  it("an online receipt and opname (no capture time) behave exactly as before", async () => {
    const k = await kirim(2);
    const r = await terima(k, 2);
    expect(r.ok).toBe(true);
    const op = await catatOpname({ storeId: tokoId, userId: spgId, baris: [{ itemId: kemeja, variantSku: null, qtyCounted: 2 }] });
    expect(op).toEqual({ ok: true, opnameId: expect.any(String), selisih: 0 });
    expect(await saldo()).toBe(2);
  });
});
