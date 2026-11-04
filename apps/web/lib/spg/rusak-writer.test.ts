import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Barang rusak di kiriman ke toko SPG, terhadap basis data uji: dicatat saat
 * diterima (tiba tetap, buku hanya yang baik), diputuskan gudang (CAS di
 * transaksi serializable + balapan), dan dikirim balik lewat NRT SPG yang
 * barisnya menunjuk baris tanda terima (tanpa RETUR_KELUAR).
 *
 * Semua baris milik fixture buatan tes (toko, barang, pengguna berkode acak);
 * teardown hanya lewat id yang diseed (`seededId`/`seededIds`).
 */

const kabar = vi.hoisted(() => ({ kirim: [] as { userId: string; jenis: string; judul: string; data: Record<string, string> }[] }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; judul: string; data: Record<string, string> }) => {
    kabar.kirim.push({ userId, jenis: k.jenis, judul: k.judul, data: k.data });
  }),
}));
const titip = vi.hoisted(() => ({ toko: [] as string[] }));
vi.mock("./titip-tersedia", () => ({
  kabariTitipanTersedia: vi.fn(async (storeId: string) => {
    titip.toko.push(storeId);
  }),
}));

const { terimaKiriman } = await import("./stok-writer");
const { putuskanBarangRusak } = await import("./rusak-writer");
const { barisRusakUntukRetur, daftarRusakKantor, rusakUntukSpg } = await import("./rusak-queries");
const { batalkanRetur, catatReturToko } = await import("@/lib/receivables/return-writer");
const { JEJAK_RUSAK, KATEGORI_NOTIF_RUSAK } = await import("./rusak");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `RSK-${Math.random().toString(36).slice(2, 9)}`;

d("barang rusak di kiriman — penulis (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let tokoA = "";
  let tokoB = "";
  let tokoSepi = "";
  let spgA = "";
  let spgB = "";
  let gudang = "";
  let kirimKe = 0;
  const kiriman: string[] = [];
  const mutasi: string[] = [];

  const tokoIds = () => seededIds([tokoA, tokoB, tokoSepi].filter(Boolean));

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: "Kaos Uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          sellingPrice: 50_000,
          variants: [
            { sku: `${tag}-KAOS-M`, size: "M" },
            { sku: `${tag}-KAOS-L`, size: "L" },
          ],
        },
      })
    ).id;
    kemeja = (
      await prisma.item.create({
        data: { sku: `${tag}-KMJ`, nameId: "Kemeja Uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId, sellingPrice: 80_000 },
      })
    ).id;
    const toko = async (kode: string) =>
      (
        await prisma.store.create({
          data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType: "KONSI", markupPercent: 20 },
        })
      ).id;
    tokoA = await toko("A");
    tokoB = await toko("B");
    tokoSepi = await toko("SEPI");
    const pengguna = async (n: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId: storeId } })).id;
    spgA = await pengguna("spg-a", tokoA);
    spgB = await pengguna("spg-b", tokoB);
    gudang = await pengguna("gudang", null);
  });

  beforeEach(async () => {
    kabar.kirim = [];
    titip.toko = [];
    kiriman.length = 0;
    mutasi.length = 0;
    // Buku toko A dan B sudah dimulai; toko sepi belum.
    await prisma.storeStockMovement.createMany({
      data: [
        { storeId: tokoA, itemId: kemeja, variantSku: "", qty: 1, kind: "OPNAME", createdById: spgA },
        { storeId: tokoB, itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 10, kind: "OPNAME", createdById: spgB },
      ],
    });
  });

  afterEach(async () => {
    const receipts = await prisma.storeReceipt.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true, lines: { select: { id: true } } } });
    const receiptIds = receipts.map((r) => r.id);
    const lineIds = receipts.flatMap((r) => r.lines.map((l) => l.id));
    const nota = await prisma.storeReturn.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const notaIds = nota.map((n) => n.id);

    // Catatan kantor dicocokkan di JS lewat metadata — penyaringan jalur JSON
    // tidak andal di semua adaptor — lalu dihapus per id.
    const catatan = await prisma.adminNotification.findMany({
      where: {
        OR: [{ category: KATEGORI_NOTIF_RUSAK }, { category: { startsWith: "STORE_TRANSFER_" } }, { category: "RETUR_SPG_TANPA_PEMEGANG" }],
      },
      select: { id: true, metadata: true },
    });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return (
          (typeof m?.receiptId === "string" && receiptIds.includes(m.receiptId)) ||
          (typeof m?.transferId === "string" && mutasi.includes(m.transferId)) ||
          // NRT SPG dari toko uji tanpa pemegang membunyikan lonceng kantor.
          (typeof m?.storeReturnId === "string" && notaIds.includes(m.storeReturnId))
        );
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...lineIds, ...notaIds, ...mutasi]) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
    await prisma.storeTransfer.deleteMany({ where: { id: { in: seededIds([...mutasi]) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds([...kiriman]) } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgB, gudang].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, kemeja].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const saldo = async (storeId: string, itemId: string, variantSku: string) =>
    (await prisma.storeStockMovement.aggregate({ where: { storeId, itemId, variantSku }, _sum: { qty: true } }))._sum.qty ?? 0;

  /** Kiriman konsinyasi ke toko: kemeja `qty` potong + satu baris yang hanya diketik namanya. */
  async function kirimKonsi(storeId: string, qty = 5) {
    const k = await prisma.consignmentShipment.create({
      data: {
        noKirim: `${tag}-KRM-${kirimKe++}`,
        storeId,
        shippedAt: new Date(Date.now() - 86_400_000),
        items: {
          create: [
            { itemId: kemeja, itemName: "Kemeja Uji", qty, price: 0, amount: 0 },
            { itemId: null, itemName: `Hanger ${tag}`, qty: 3, price: 0, amount: 0 },
          ],
        },
      },
      select: { id: true, items: { orderBy: { itemName: "asc" }, select: { id: true, itemId: true } } },
    });
    kiriman.push(k.id);
    return { id: k.id, kemeja: k.items.find((i) => i.itemId === kemeja)!.id, hanger: k.items.find((i) => i.itemId === null)!.id };
  }

  /** Mutasi B → A yang sudah dikirim: kaos M 4 potong. */
  async function mutasiDikirim() {
    const m = await prisma.storeTransfer.create({
      data: {
        docNo: `${tag}-MTS-${kirimKe++}`,
        fromStoreId: tokoB,
        toStoreId: tokoA,
        status: "DIKIRIM",
        reason: "uji",
        createdById: spgB,
        shippedById: spgB,
        shippedAt: new Date(Date.now() - 3_600_000),
        idempotencyKey: `${tag}-k${kirimKe++}`,
        lines: { create: [{ itemId: kaos, variantSku: `${tag}-KAOS-M`, productName: "Kaos Uji — M", qty: 4 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    mutasi.push(m.id);
    return { id: m.id, line: m.lines[0].id };
  }

  const barisTerima = (sourceId: string) =>
    prisma.storeReceiptLine.findMany({
      where: { receipt: { sourceId } },
      orderBy: { productName: "asc" },
      select: { id: true, itemId: true, qtySent: true, qtyReceived: true, qtyDamaged: true, damageNote: true, damagePhotoUrl: true, damageStatus: true },
    });

  /** Terima kiriman konsi ke toko A: kemeja 5 tiba, `rusak` di antaranya rusak. */
  async function terimaRusak(rusak = 2, storeId = tokoA, userId = spgA) {
    const k = await kirimKonsi(storeId);
    const r = await terimaKiriman({
      storeId,
      userId,
      sourceType: "KONSI_SHIPMENT",
      sourceId: k.id,
      diterima: [
        { lineId: k.kemeja, qtyReceived: 5, qtyDamaged: rusak, damageNote: "Sobek di jahitan", damagePhotoUrl: "/api/foto/uji123" },
        { lineId: k.hanger, qtyReceived: 3 },
      ],
    });
    if (!r.ok) throw new Error(`terima gagal: ${r.alasan}`);
    const baris = await barisTerima(k.id);
    return { receiptId: r.receiptId, kemeja: baris.find((b) => b.itemId === kemeja)!, hanger: baris.find((b) => b.itemId === null)! };
  }

  // ─── Mencatat saat diterima ────────────────────────────────────────────────

  it("records damage on receipt: arrived stays, the book gets only the good part, the warehouse is told", async () => {
    const t = await terimaRusak(2);
    expect(t.kemeja).toMatchObject({ qtySent: 5, qtyReceived: 5, qtyDamaged: 2, damageNote: "Sobek di jahitan", damagePhotoUrl: "/api/foto/uji123", damageStatus: "TERBUKA" });
    expect(t.hanger).toMatchObject({ qtyReceived: 3, qtyDamaged: 0, damageStatus: null, damageNote: null });
    // Opname 1 + diterima baik 3.
    expect(await saldo(tokoA, kemeja, "")).toBe(4);

    const catatan = (await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_RUSAK }, select: { metadata: true, title: true } })).filter(
      (c) => (c.metadata as Record<string, unknown> | null)?.receiptId === t.receiptId,
    );
    expect(catatan).toHaveLength(1);
    expect(catatan[0].metadata).toMatchObject({ storeId: tokoA, pcs: 2 });
  });

  it("writes no warehouse note and the whole received count when nothing is damaged", async () => {
    const k = await kirimKonsi(tokoA);
    const r = await terimaKiriman({
      storeId: tokoA,
      userId: spgA,
      sourceType: "KONSI_SHIPMENT",
      sourceId: k.id,
      diterima: [
        { lineId: k.kemeja, qtyReceived: 5 },
        { lineId: k.hanger, qtyReceived: 3 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(await saldo(tokoA, kemeja, "")).toBe(6);
    const catatan = (await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_RUSAK }, select: { metadata: true } })).filter(
      (c) => r.ok && (c.metadata as Record<string, unknown> | null)?.receiptId === r.receiptId,
    );
    expect(catatan).toHaveLength(0);
  });

  it("refuses invalid damage and writes nothing", async () => {
    const k = await kirimKonsi(tokoA);
    const coba = (baris: Parameters<typeof terimaKiriman>[0]["diterima"][number]) =>
      terimaKiriman({ storeId: tokoA, userId: spgA, sourceType: "KONSI_SHIPMENT", sourceId: k.id, diterima: [baris, { lineId: k.hanger, qtyReceived: 3 }] });
    expect(await coba({ lineId: k.kemeja, qtyReceived: 4, qtyDamaged: 5, damageNote: "x" })).toEqual({ ok: false, alasan: "RUSAK_TIDAK_VALID" });
    expect(await coba({ lineId: k.kemeja, qtyReceived: 4, qtyDamaged: 1 })).toEqual({ ok: false, alasan: "KETERANGAN_RUSAK_WAJIB" });
    expect(await coba({ lineId: k.kemeja, qtyReceived: 4, qtyDamaged: 1, damageNote: "x", damagePhotoUrl: "https://contoh.com/a.jpg" })).toEqual({
      ok: false,
      alasan: "RUSAK_TIDAK_VALID",
    });
    expect(await prisma.storeReceipt.count({ where: { sourceId: k.id } })).toBe(0);
    expect(await saldo(tokoA, kemeja, "")).toBe(1);
  });

  it("a damaged transfer line still counts as arrived — no shortfall — and books MUTASI_MASUK for the good part", async () => {
    const m = await mutasiDikirim();
    const r = await terimaKiriman({
      storeId: tokoA,
      userId: spgA,
      sourceType: "MUTASI",
      sourceId: m.id,
      diterima: [{ lineId: m.line, qtyReceived: 4, qtyDamaged: 1, damageNote: "Noda" }],
    });
    expect(r.ok).toBe(true);
    const tr = await prisma.storeTransfer.findUnique({ where: { id: m.id }, select: { status: true, selisihStatus: true } });
    expect(tr).toEqual({ status: "DITERIMA", selisihStatus: null });
    const gerak = await prisma.storeStockMovement.findMany({ where: { storeId: tokoA, itemId: kaos }, select: { qty: true, kind: true } });
    expect(gerak).toEqual([{ qty: 3, kind: "MUTASI_MASUK" }]);
  });

  // ─── Keputusan gudang ──────────────────────────────────────────────────────

  it("LAYAK_JUAL books the damaged pieces as TERIMA, audits before/after, and tells the receiver", async () => {
    const t = await terimaRusak(2);
    titip.toko = []; // penerimaannya sendiri juga memicu kait titip pesan
    const h = await putuskanBarangRusak({ lineId: t.kemeja.id, keputusan: "LAYAK_JUAL", catatan: "Bisa disetrika", olehUserId: gudang });
    expect(h).toEqual({ ok: true, receiptId: t.receiptId, bukuDitulis: true });

    const gerak = await prisma.storeStockMovement.findMany({ where: { refType: "StoreReceiptLine", refId: t.kemeja.id }, select: { qty: true, kind: true, storeId: true } });
    expect(gerak).toEqual([{ qty: 2, kind: "TERIMA", storeId: tokoA }]);
    expect(await saldo(tokoA, kemeja, "")).toBe(6);

    const baris = await prisma.storeReceiptLine.findUnique({ where: { id: t.kemeja.id }, select: { damageStatus: true, damageDecidedById: true, damageDecisionNote: true } });
    expect(baris).toEqual({ damageStatus: "LAYAK_JUAL", damageDecidedById: gudang, damageDecisionNote: "Bisa disetrika" });

    const jejak = await prisma.auditLog.findMany({ where: { entityType: "StoreReceiptLine", entityId: t.kemeja.id }, select: { action: true, changes: true, reason: true } });
    expect(jejak).toEqual([
      { action: JEJAK_RUSAK.DIPUTUSKAN, changes: { before: { damageStatus: "TERBUKA" }, after: { damageStatus: "LAYAK_JUAL" } }, reason: "Bisa disetrika" },
    ]);
    expect(kabar.kirim).toEqual([expect.objectContaining({ userId: spgA, jenis: "KIRIMAN_RUSAK_DIPUTUSKAN", data: { receiptId: t.receiptId } })]);
    expect(titip.toko).toEqual([tokoA]);

    // Keputusan bersifat akhir.
    expect(await putuskanBarangRusak({ lineId: t.kemeja.id, keputusan: "DIHAPUSKAN", catatan: "lagi", olehUserId: gudang })).toEqual({
      ok: false,
      alasan: "SUDAH_DIPUTUSKAN",
    });
  });

  it("LAYAK_JUAL on a transfer line books MUTASI_MASUK", async () => {
    const m = await mutasiDikirim();
    await terimaKiriman({ storeId: tokoA, userId: spgA, sourceType: "MUTASI", sourceId: m.id, diterima: [{ lineId: m.line, qtyReceived: 4, qtyDamaged: 1, damageNote: "Noda" }] });
    const [baris] = await barisTerima(m.id);
    expect((await putuskanBarangRusak({ lineId: baris.id, keputusan: "LAYAK_JUAL", catatan: "Noda hilang dicuci", olehUserId: gudang })).ok).toBe(true);
    expect(await saldo(tokoA, kaos, `${tag}-KAOS-M`)).toBe(4);
    const gerak = await prisma.storeStockMovement.findMany({ where: { refType: "StoreReceiptLine", refId: baris.id }, select: { kind: true } });
    expect(gerak).toEqual([{ kind: "MUTASI_MASUK" }]);
  });

  it("LAYAK_JUAL at a store whose book has not started writes no movement", async () => {
    // Toko sepi: seluruh kemeja rusak, jadi penerimaan tidak menulis satu gerakan pun.
    const k = await kirimKonsi(tokoSepi);
    const r = await terimaKiriman({
      storeId: tokoSepi,
      userId: spgA,
      sourceType: "KONSI_SHIPMENT",
      sourceId: k.id,
      diterima: [
        { lineId: k.kemeja, qtyReceived: 5, qtyDamaged: 5, damageNote: "Basah semua" },
        { lineId: k.hanger, qtyReceived: 3 },
      ],
    });
    expect(r.ok).toBe(true);
    const baris = (await barisTerima(k.id)).find((b) => b.itemId === kemeja)!;
    titip.toko = [];
    expect(await putuskanBarangRusak({ lineId: baris.id, keputusan: "LAYAK_JUAL", catatan: "Sudah kering", olehUserId: gudang })).toEqual({
      ok: true,
      receiptId: r.ok ? r.receiptId : "",
      bukuDitulis: false,
    });
    expect(await prisma.storeStockMovement.count({ where: { storeId: tokoSepi } })).toBe(0);
    expect(titip.toko).toEqual([]);
  });

  it("refuses an unknown decision, an empty note, and a line without damage", async () => {
    const t = await terimaRusak(2);
    expect(await putuskanBarangRusak({ lineId: t.kemeja.id, keputusan: "TERBUKA", catatan: "x", olehUserId: gudang })).toEqual({ ok: false, alasan: "KEPUTUSAN_TIDAK_SAH" });
    expect(await putuskanBarangRusak({ lineId: t.kemeja.id, keputusan: "DIHAPUSKAN", catatan: "  ", olehUserId: gudang })).toEqual({ ok: false, alasan: "CATATAN_WAJIB" });
    expect(await putuskanBarangRusak({ lineId: t.hanger.id, keputusan: "DIHAPUSKAN", catatan: "x", olehUserId: gudang })).toEqual({ ok: false, alasan: "TIDAK_DITEMUKAN" });
  });

  it("two warehouse staff deciding at once: exactly one wins, one movement, one audit row", async () => {
    const t = await terimaRusak(2);
    const hasil = await Promise.all([
      putuskanBarangRusak({ lineId: t.kemeja.id, keputusan: "LAYAK_JUAL", catatan: "A", olehUserId: gudang }),
      putuskanBarangRusak({ lineId: t.kemeja.id, keputusan: "DIHAPUSKAN", catatan: "B", olehUserId: gudang }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, alasan: "SUDAH_DIPUTUSKAN" }]);
    expect(await prisma.auditLog.count({ where: { entityType: "StoreReceiptLine", entityId: t.kemeja.id } })).toBe(1);
    const status = (await prisma.storeReceiptLine.findUnique({ where: { id: t.kemeja.id }, select: { damageStatus: true } }))?.damageStatus;
    const gerak = await prisma.storeStockMovement.count({ where: { refType: "StoreReceiptLine", refId: t.kemeja.id } });
    expect(gerak).toBe(status === "LAYAK_JUAL" ? 1 : 0);
  });

  // ─── Kirim balik lewat nota retur ──────────────────────────────────────────

  const lapor = (barisSpg: Parameters<typeof catatReturToko>[0]["barisSpg"], storeId = tokoA, userId = spgA) =>
    catatReturToko({
      noNrt: "",
      storeId,
      olehUserId: userId,
      salesmanId: userId,
      claimDate: new Date(),
      deliveryMethod: "SALES",
      reportedBySpg: true,
      barisSpg,
    });

  async function kembaliGudang(rusak = 2) {
    const t = await terimaRusak(rusak);
    const h = await putuskanBarangRusak({ lineId: t.kemeja.id, keputusan: "KEMBALI_GUDANG", catatan: "Klaim ke pabrik", olehUserId: gudang });
    if (!h.ok) throw new Error(h.alasan);
    return t;
  }

  it("a return line pointing at the damaged receipt line writes no RETUR_KELUAR; a normal line in the same note does", async () => {
    const t = await kembaliGudang(2);
    const saldoAwal = await saldo(tokoA, kemeja, "");
    const r = await lapor([
      { itemId: kemeja, qty: 2, condition: "RUSAK", storeReceiptLineId: t.kemeja.id },
      { itemId: kemeja, qty: 1, condition: "LAYAK" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const items = await prisma.storeReturnItem.findMany({ where: { storeReturnId: r.id }, orderBy: { qty: "asc" }, select: { qty: true, condition: true, storeReceiptLineId: true } });
    expect(items).toEqual([
      { qty: 1, condition: "LAYAK", storeReceiptLineId: null },
      { qty: 2, condition: "RUSAK", storeReceiptLineId: t.kemeja.id },
    ]);
    const keluar = await prisma.storeStockMovement.findMany({ where: { refType: "StoreReturn", refId: r.id }, select: { qty: true, kind: true } });
    expect(keluar).toEqual([{ qty: -1, kind: "RETUR_KELUAR" }]);
    expect(await saldo(tokoA, kemeja, "")).toBe(saldoAwal - 1);

    // Sudah habis dikirim balik: nota berikutnya untuk baris itu ditolak.
    expect(await lapor([{ itemId: kemeja, qty: 1, condition: "RUSAK", storeReceiptLineId: t.kemeja.id }])).toEqual({ ok: false, alasan: "RUSAK_MELEBIHI" });
    expect(await barisRusakUntukRetur(tokoA, [t.kemeja.id])).toEqual([]);

    // Dibatalkan: pembaliknya hanya untuk baris biasa, dan sisanya terbuka lagi.
    expect((await batalkanRetur({ storeReturnId: r.id, alasan: "Salah catat", olehUserId: gudang })).ok).toBe(true);
    const sesudahBatal = await prisma.storeStockMovement.findMany({ where: { refType: "StoreReturn", refId: r.id }, orderBy: { qty: "asc" }, select: { qty: true } });
    expect(sesudahBatal).toEqual([{ qty: -1 }, { qty: 1 }]);
    expect(await barisRusakUntukRetur(tokoA, [t.kemeja.id])).toEqual([
      expect.objectContaining({ receiptLineId: t.kemeja.id, itemId: kemeja, sisa: 2 }),
    ]);
    const lagi = await lapor([{ itemId: kemeja, qty: 2, condition: "RUSAK", storeReceiptLineId: t.kemeja.id }]);
    expect(lagi.ok).toBe(true);
  });

  it("refuses a return line pointing at a damaged line that is not this store's, not KEMBALI_GUDANG, another item, or LAYAK", async () => {
    const terbuka = await terimaRusak(2);
    expect(await lapor([{ itemId: kemeja, qty: 1, condition: "RUSAK", storeReceiptLineId: terbuka.kemeja.id }])).toEqual({ ok: false, alasan: "RUSAK_TIDAK_SAH" });

    const t = await kembaliGudang(2);
    expect(await lapor([{ itemId: kemeja, qty: 1, condition: "LAYAK", storeReceiptLineId: t.kemeja.id }])).toEqual({ ok: false, alasan: "RUSAK_TIDAK_SAH" });
    expect(await lapor([{ itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 1, condition: "RUSAK", storeReceiptLineId: t.kemeja.id }])).toEqual({
      ok: false,
      alasan: "RUSAK_TIDAK_SAH",
    });
    // SPG toko B tidak bisa mengirim balik barang rusak toko A.
    expect(await lapor([{ itemId: kemeja, qty: 1, condition: "RUSAK", storeReceiptLineId: t.kemeja.id }], tokoB, spgB)).toEqual({ ok: false, alasan: "RUSAK_TIDAK_SAH" });
    expect(await prisma.storeReturn.count({ where: { storeId: { in: tokoIds() } } })).toBe(0);
  });

  it("two notes sending back the same damaged pieces at once: only one gets through", async () => {
    const t = await kembaliGudang(2);
    const hasil = await Promise.all([
      lapor([{ itemId: kemeja, qty: 2, condition: "RUSAK", storeReceiptLineId: t.kemeja.id }]),
      lapor([{ itemId: kemeja, qty: 2, condition: "RUSAK", storeReceiptLineId: t.kemeja.id }]),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, alasan: "RUSAK_MELEBIHI" }]);
    const total = await prisma.storeReturnItem.aggregate({ where: { storeReceiptLineId: t.kemeja.id }, _sum: { qty: true } });
    expect(total._sum.qty).toBe(2);
  });

  // ─── Bacaan ────────────────────────────────────────────────────────────────

  it("lists open lines for the office and the phone, and the remaining send-back after a return", async () => {
    const t = await kembaliGudang(2);
    const terbuka = await terimaRusak(1);

    const kantor = await daftarRusakKantor();
    expect(kantor.terbuka.map((b) => b.id)).toContain(terbuka.kemeja.id);
    expect(kantor.riwayat.find((b) => b.id === t.kemeja.id)).toMatchObject({ status: "KEMBALI_GUDANG", dikembalikan: 0, penerima: `spg-a ${tag}` });

    const r = await lapor([{ itemId: kemeja, qty: 1, condition: "RUSAK", storeReceiptLineId: t.kemeja.id }]);
    expect(r.ok).toBe(true);
    const hp = await rusakUntukSpg(tokoA);
    expect(hp.find((b) => b.id === t.kemeja.id)).toMatchObject({ status: "KEMBALI_GUDANG", sisa: 1 });
    expect(hp.find((b) => b.id === terbuka.kemeja.id)).toMatchObject({ status: "TERBUKA", sisa: 0 });
    // HP tidak pernah membawa rupiah (barang konsinyasi) — payloadnya tanpa harga.
    const teks = JSON.stringify([hp, await barisRusakUntukRetur(tokoA, [t.kemeja.id])]);
    expect(teks).not.toMatch(/price|amount|harga|nilai|Rp/i);
    // Toko lain tidak melihat baris toko A.
    expect((await rusakUntukSpg(tokoB)).map((b) => b.id)).not.toContain(t.kemeja.id);
    // Formulir retur hanya menerima baris toko sendiri.
    expect(await barisRusakUntukRetur(tokoB, [t.kemeja.id])).toEqual([]);
  });
});
