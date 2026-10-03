import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ajukanTukar, batalkanTukar, selesaikanTukar, setujuiTukar, tolakTukar } from "./tukar-writer";

/*
 * Penulis tukar barang terhadap basis data uji. Semua baris milik fixture
 * buatan tes (toko, barang, pengguna berkode acak); teardown hanya lewat id
 * yang diseed, tidak pernah lewat awalan atau rentang tanggal.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `TKR-${Math.random().toString(36).slice(2, 10)}`;

d("tukar barang — penulis (test bed only)", () => {
  let uomId = "";
  let sales = "";
  let salesLain = "";
  let kantor = "";
  let kaos = "";
  let kemeja = "";
  let polos = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let tokoSepi = "";
  let visitId = "";
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  beforeAll(async () => {
    uomId = "";
    sales = "";
    salesLain = "";
    kantor = "";
    kaos = "";
    kemeja = "";
    polos = "";
    tokoPutus = "";
    tokoKonsi = "";
    tokoSepi = "";
    visitId = "";

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const pengguna = async (n: string) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}` } })).id;
    sales = await pengguna("sales");
    salesLain = await pengguna("sales2");
    kantor = await pengguna("kantor");

    const barang = async (kode: string, harga: number | null, variants?: object[]) =>
      (
        await prisma.item.create({
          data: {
            sku: `${tag}-${kode}`,
            nameId: `Barang ${kode}`,
            nameEn: `Item ${kode}`,
            type: "FINISHED_GOOD",
            uomId,
            sellingPrice: harga,
            ...(variants ? { variants } : {}),
          },
        })
      ).id;
    kaos = await barang("KAOS", 85_000, [
      { sku: `${tag}-KAOS-M`, size: "M" },
      { sku: `${tag}-KAOS-L`, size: "L" },
      { sku: `${tag}-KAOS-XL`, size: "XL" },
    ]);
    kemeja = await barang("KEMEJA", 150_000);
    polos = await barang("POLOS", null);

    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (
        await prisma.store.create({
          data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "x", termsType, salesmanId: sales },
        })
      ).id;
    tokoPutus = await toko("PUTUS", "PUTUS");
    tokoKonsi = await toko("KONSI", "KONSI");
    tokoSepi = await toko("SEPI", "PUTUS");

    visitId = (
      await prisma.storeVisit.create({ data: { storeId: tokoPutus, userId: sales, checkinLat: -6.2, checkinLng: 106.8 } })
    ).id;
  });

  const itemIds = () => seededIds([kaos, kemeja, polos].filter(Boolean));
  const tokoIds = () => seededIds([tokoPutus, tokoKonsi, tokoSepi].filter(Boolean));

  beforeEach(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.inventoryValue.createMany({
      data: [
        { itemId: kaos, variantSku: `${tag}-KAOS-M`, qtyOnHand: 10, reservedQty: 0, avgCost: 40_000, totalValue: 400_000 },
        // L: 2 di rak, 1 sudah dipesan orang lain → tersedia 1.
        { itemId: kaos, variantSku: `${tag}-KAOS-L`, qtyOnHand: 2, reservedQty: 1, avgCost: 40_000, totalValue: 80_000 },
        // Bentuk produksi: barang tanpa varian memakai variantSku null.
        { itemId: kemeja, variantSku: null, qtyOnHand: 5, reservedQty: 0, avgCost: 70_000, totalValue: 350_000 },
      ],
    });
  });

  afterEach(async () => {
    const dok = await prisma.storeExchange.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const ids = dok.map((x) => x.id);
    // Catatan kantor yang ditulis penulis (ajuan, disetujui). Dicocokkan di JS lewat
    // `metadata.exchangeId` — penyaringan jalur JSON tidak andal di semua adaptor —
    // lalu dihapus per id, supaya tidak ada baris milik orang lain yang ikut terhapus.
    const catatan = await prisma.adminNotification.findMany({
      where: { category: { in: ["STORE_EXCHANGE_PROPOSED", "STORE_EXCHANGE_TO_COMPLETE"] } },
      select: { id: true, metadata: true },
    });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.exchangeId === "string" && ids.includes(m.exchangeId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "StoreExchange", entityId: { in: seededIds(ids) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.storeExchangeLine.deleteMany({ where: { exchangeId: { in: seededIds(ids) } } });
    await prisma.storeExchange.deleteMany({ where: { id: { in: seededIds(ids) } } });
  });

  afterAll(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds() } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain, kantor].filter(Boolean)) } } });
  });

  const stok = async (itemId: string, variantSku: string | null) => {
    const rows = await prisma.inventoryValue.findMany({ where: { itemId, variantSku } });
    expect(rows).toHaveLength(1);
    return { qty: Number(rows[0].qtyOnHand), avg: Number(rows[0].avgCost), total: Number(rows[0].totalValue) };
  };

  /** Tukar ukuran kaos: toko mengembalikan L, menerima M. */
  const ajukanUkuran = (q = 1, dari = "L", ke = "M") =>
    ajukanTukar({
      salesmanId: sales,
      storeId: tokoPutus,
      idempotencyKey: kunci(),
      catatan: "salah ukuran",
      baris: [
        { direction: "MASUK", itemId: kaos, variantSku: `${tag}-KAOS-${dari}`, qty: q },
        { direction: "KELUAR", itemId: kaos, variantSku: `${tag}-KAOS-${ke}`, qty: q },
      ],
    });

  it("mengajukan: dokumen bernomor TKR, baris dengan nama dari server, jejak, terikat kunjungan", async () => {
    const r = await ajukanUkuran(2);
    expect(r).toMatchObject({ ok: true, ulang: false });
    if (!r.ok) throw new Error("harus ok");
    expect(r.docNo).toMatch(/^TKR\/\d{4}\/\d{4,}$/);

    const dok = await prisma.storeExchange.findUniqueOrThrow({ where: { id: r.id } });
    expect(dok).toMatchObject({ status: "DIAJUKAN", salesmanId: sales, storeId: tokoPutus, visitId, note: "salah ukuran" });
    const baris = await prisma.storeExchangeLine.findMany({ where: { exchangeId: r.id }, orderBy: { direction: "asc" } });
    expect(baris.map((b) => [b.direction, b.variantSku, b.qty])).toEqual([
      ["KELUAR", `${tag}-KAOS-M`, 2],
      ["MASUK", `${tag}-KAOS-L`, 2],
    ]);
    expect(baris[0].productName).toContain("Barang KAOS — ");
    expect(await prisma.auditLog.count({ where: { entityId: r.id, action: "STORE_EXCHANGE_PROPOSED" } })).toBe(1);
    // Mengajukan tidak menggerakkan stok.
    expect((await stok(kaos, `${tag}-KAOS-M`)).qty).toBe(10);
  });

  it("kiriman ulang berkunci sama mengembalikan dokumen yang sama; kunci milik sales lain ditolak", async () => {
    const k = kunci();
    const kirim = (salesmanId: string) =>
      ajukanTukar({
        salesmanId,
        storeId: tokoPutus,
        idempotencyKey: k,
        baris: [
          { direction: "MASUK", itemId: kaos, variantSku: `${tag}-KAOS-L`, qty: 1 },
          { direction: "KELUAR", itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 1 },
        ],
      });
    const a = await kirim(sales);
    const b = await kirim(sales);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("harus ok");
    expect(b).toMatchObject({ id: a.id, docNo: a.docNo, ulang: true });
    expect(await prisma.storeExchange.count({ where: { idempotencyKey: k } })).toBe(1);
    expect(await kirim(salesLain)).toEqual({ ok: false, kode: "KUNCI_DIPAKAI" });
  });

  it("menolak: toko konsinyasi, tanpa kunjungan, selisih nilai, varian asing, harga kosong", async () => {
    const baris = [
      { direction: "MASUK", itemId: kaos, variantSku: `${tag}-KAOS-L`, qty: 1 },
      { direction: "KELUAR", itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 1 },
    ];
    expect(await ajukanTukar({ salesmanId: sales, storeId: tokoKonsi, idempotencyKey: kunci(), baris })).toEqual({
      ok: false,
      kode: "BUKAN_TOKO_PUTUS",
    });
    expect(await ajukanTukar({ salesmanId: sales, storeId: tokoSepi, idempotencyKey: kunci(), baris })).toEqual({
      ok: false,
      kode: "TANPA_KUNJUNGAN",
    });
    // Kaos Rp 85.000 ditukar kemeja Rp 150.000 — bukan tukar barang, itu penjualan.
    expect(
      await ajukanTukar({
        salesmanId: sales,
        storeId: tokoPutus,
        idempotencyKey: kunci(),
        baris: [
          { direction: "MASUK", itemId: kaos, variantSku: `${tag}-KAOS-L`, qty: 1 },
          { direction: "KELUAR", itemId: kemeja, qty: 1 },
        ],
      }),
    ).toEqual({ ok: false, kode: "SELISIH_NILAI", masuk: 85_000, keluar: 150_000, selisih: 65_000 });
    expect(
      await ajukanTukar({
        salesmanId: sales,
        storeId: tokoPutus,
        idempotencyKey: kunci(),
        baris: [
          { direction: "MASUK", itemId: kaos, qty: 1 },
          { direction: "KELUAR", itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 1 },
        ],
      }),
    ).toEqual({ ok: false, kode: "VARIAN_TIDAK_DIKENAL" });
    expect(
      await ajukanTukar({
        salesmanId: sales,
        storeId: tokoPutus,
        idempotencyKey: kunci(),
        baris: [
          { direction: "MASUK", itemId: polos, qty: 1 },
          { direction: "KELUAR", itemId: polos, qty: 1 },
        ],
      }),
    ).toEqual({ ok: false, kode: "HARGA_BELUM_DISET", itemIds: [polos] });
    expect(
      await ajukanTukar({
        salesmanId: sales,
        storeId: tokoPutus,
        idempotencyKey: kunci(),
        baris: [
          { direction: "MASUK", itemId: "tidak-ada", qty: 1 },
          { direction: "KELUAR", itemId: kaos, variantSku: `${tag}-KAOS-M`, qty: 1 },
        ],
      }),
    ).toEqual({ ok: false, kode: "BARANG_TIDAK_DIKENAL" });
    // Barang yang sudah tidak dijual boleh kembali, tapi tidak boleh diberikan.
    await prisma.item.update({ where: { id: seededId(kemeja) }, data: { isActive: false } });
    try {
      expect(
        await ajukanTukar({
          salesmanId: sales,
          storeId: tokoPutus,
          idempotencyKey: kunci(),
          baris: [
            { direction: "MASUK", itemId: kemeja, qty: 1 },
            { direction: "KELUAR", itemId: kemeja, qty: 1 },
          ],
        }),
      ).toEqual({ ok: false, kode: "BARANG_TIDAK_AKTIF" });
    } finally {
      await prisma.item.update({ where: { id: seededId(kemeja) }, data: { isActive: true } });
    }
    expect(await prisma.storeExchange.count({ where: { storeId: { in: tokoIds() } } })).toBe(0);
  });

  it("menyetujui: bukan oleh pengaju, sekali saja; stok KELUAR kurang ditolak semua-atau-tidak", async () => {
    const r = await ajukanUkuran(1);
    if (!r.ok) throw new Error("harus ok");
    expect(await setujuiTukar({ exchangeId: r.id, olehUserId: sales })).toEqual({ ok: false, kode: "MILIK_SENDIRI" });
    expect(await setujuiTukar({ exchangeId: r.id, olehUserId: kantor, catatan: "ok" })).toMatchObject({
      ok: true,
      salesmanId: sales,
      docNo: r.docNo,
    });
    expect(await setujuiTukar({ exchangeId: r.id, olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
    const dok = await prisma.storeExchange.findUniqueOrThrow({ where: { id: r.id } });
    expect(dok).toMatchObject({ status: "DISETUJUI", reviewedById: kantor, reviewNote: "ok" });

    // Toko mengembalikan M ×2, minta L ×2 — L tersedia hanya 1 (2 di rak, 1 dipesan).
    const kurang = await ajukanUkuran(2, "M", "L");
    if (!kurang.ok) throw new Error("harus ok");
    const hasil = await setujuiTukar({ exchangeId: kurang.id, olehUserId: kantor });
    expect(hasil).toMatchObject({
      ok: false,
      kode: "STOK_KURANG",
      kurang: [{ itemId: kaos, variantSku: `${tag}-KAOS-L`, butuh: 2, tersedia: 1 }],
    });
    expect((await prisma.storeExchange.findUniqueOrThrow({ where: { id: kurang.id } })).status).toBe("DIAJUKAN");
  });

  it("menolak butuh alasan; hanya dari DIAJUKAN", async () => {
    const r = await ajukanUkuran(1);
    if (!r.ok) throw new Error("harus ok");
    expect(await tolakTukar({ exchangeId: r.id, olehUserId: kantor, alasan: "  " })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await tolakTukar({ exchangeId: r.id, olehUserId: kantor, alasan: "barang bukan dari kita" })).toMatchObject({ ok: true });
    const dok = await prisma.storeExchange.findUniqueOrThrow({ where: { id: r.id } });
    expect(dok).toMatchObject({ status: "DITOLAK", reviewNote: "barang bukan dari kita" });
    expect(await setujuiTukar({ exchangeId: r.id, olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("menyelesaikan: stok bergerak dua arah dalam satu transaksi, harga rata-rata tetap, ulang tidak memposting dua kali", async () => {
    const r = await ajukanUkuran(1);
    if (!r.ok) throw new Error("harus ok");
    expect(await selesaikanTukar({ exchangeId: r.id, olehUserId: kantor })).toEqual({ ok: false, kode: "BELUM_DISETUJUI" });
    await setujuiTukar({ exchangeId: r.id, olehUserId: kantor });
    expect(await selesaikanTukar({ exchangeId: r.id, olehUserId: sales })).toEqual({ ok: false, kode: "MILIK_SENDIRI" });

    expect(await selesaikanTukar({ exchangeId: r.id, olehUserId: kantor })).toMatchObject({ ok: true, ulang: false });
    expect(await stok(kaos, `${tag}-KAOS-M`)).toEqual({ qty: 9, avg: 40_000, total: 360_000 });
    expect(await stok(kaos, `${tag}-KAOS-L`)).toEqual({ qty: 3, avg: 40_000, total: 120_000 });

    const adj = await prisma.stockAdjustment.findMany({ where: { itemId: kaos }, orderBy: { source: "asc" } });
    expect(adj.map((a) => [a.source, a.type, Number(a.qtyChange), Number(a.prevQty), Number(a.newQty)])).toEqual([
      ["STORE_EXCHANGE_IN", "POSITIVE", 1, 2, 3],
      ["STORE_EXCHANGE_OUT", "NEGATIVE", -1, 10, 9],
    ]);
    expect(adj.every((a) => a.createdById === kantor && a.externalRef === r.docNo && a.idempotencyKey?.startsWith("tukar:"))).toBe(
      true,
    );
    const dok = await prisma.storeExchange.findUniqueOrThrow({ where: { id: r.id } });
    expect(dok.status).toBe("SELESAI");
    expect(dok.completedAt).not.toBeNull();

    // Diulang (dua tab, jaringan putus): berhasil, tanpa gerakan kedua.
    expect(await selesaikanTukar({ exchangeId: r.id, olehUserId: kantor })).toMatchObject({ ok: true, ulang: true });
    expect(await prisma.stockAdjustment.count({ where: { itemId: kaos } })).toBe(2);
    expect((await stok(kaos, `${tag}-KAOS-M`)).qty).toBe(9);
    // Yang sudah bergerak tidak bisa dibatalkan.
    expect(await batalkanTukar({ exchangeId: r.id, olehUserId: sales, sebagai: "SALESMAN" })).toEqual({
      ok: false,
      kode: "SUDAH_SELESAI",
    });
  });

  it("stok terpakai di antara setuju dan selesai → STOK_KURANG, tidak ada yang bergerak", async () => {
    const r = await ajukanUkuran(1, "M", "L");
    if (!r.ok) throw new Error("harus ok");
    await setujuiTukar({ exchangeId: r.id, olehUserId: kantor });
    // Satu-satunya L yang tersedia dipesan orang lain.
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(kaos), variantSku: `${tag}-KAOS-L` }, data: { reservedQty: 2 } });

    expect(await selesaikanTukar({ exchangeId: r.id, olehUserId: kantor })).toMatchObject({ ok: false, kode: "STOK_KURANG" });
    expect((await prisma.storeExchange.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("DISETUJUI");
    expect(await prisma.stockAdjustment.count({ where: { itemId: kaos } })).toBe(0);
    expect((await stok(kaos, `${tag}-KAOS-M`)).qty).toBe(10);
  });

  it("barang tanpa varian (baris stok null) ditukar dengan yang sama: tidak ada baris hantu, stok bersih tetap", async () => {
    const r = await ajukanTukar({
      salesmanId: sales,
      storeId: tokoPutus,
      idempotencyKey: kunci(),
      baris: [
        { direction: "MASUK", itemId: kemeja, qty: 1 },
        { direction: "KELUAR", itemId: kemeja, qty: 1 },
      ],
    });
    if (!r.ok) throw new Error("harus ok");
    await setujuiTukar({ exchangeId: r.id, olehUserId: kantor });
    expect(await selesaikanTukar({ exchangeId: r.id, olehUserId: kantor })).toMatchObject({ ok: true });
    expect(await stok(kemeja, null)).toEqual({ qty: 5, avg: 70_000, total: 350_000 });
    expect(await prisma.inventoryValue.count({ where: { itemId: kemeja } })).toBe(1);
    expect(await prisma.stockAdjustment.count({ where: { itemId: kemeja } })).toBe(2);
  });

  it("MASUK varian tanpa baris stok: baris dibuat dengan harga rata-rata saudaranya", async () => {
    const r = await ajukanUkuran(1, "XL", "M");
    if (!r.ok) throw new Error("harus ok");
    await setujuiTukar({ exchangeId: r.id, olehUserId: kantor });
    expect(await selesaikanTukar({ exchangeId: r.id, olehUserId: kantor })).toMatchObject({ ok: true });
    expect(await stok(kaos, `${tag}-KAOS-XL`)).toEqual({ qty: 1, avg: 40_000, total: 40_000 });
  });

  it("membatalkan: salesman miliknya sendiri tanpa alasan; kantor wajib alasan; sales lain tidak melihatnya", async () => {
    const a = await ajukanUkuran(1);
    const b = await ajukanUkuran(1);
    if (!a.ok || !b.ok) throw new Error("harus ok");

    expect(await batalkanTukar({ exchangeId: a.id, olehUserId: salesLain, sebagai: "SALESMAN" })).toEqual({
      ok: false,
      kode: "TIDAK_DITEMUKAN",
    });
    expect(await batalkanTukar({ exchangeId: a.id, olehUserId: sales, sebagai: "SALESMAN" })).toMatchObject({ ok: true });
    expect((await prisma.storeExchange.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DIBATALKAN");

    await setujuiTukar({ exchangeId: b.id, olehUserId: kantor });
    expect(await batalkanTukar({ exchangeId: b.id, olehUserId: kantor, sebagai: "KANTOR" })).toEqual({
      ok: false,
      kode: "ALASAN_WAJIB",
    });
    expect(await batalkanTukar({ exchangeId: b.id, olehUserId: kantor, sebagai: "KANTOR", alasan: "toko tutup" })).toMatchObject({
      ok: true,
    });
    const dok = await prisma.storeExchange.findUniqueOrThrow({ where: { id: b.id } });
    expect(dok).toMatchObject({ status: "DIBATALKAN", reviewNote: "toko tutup" });
    expect(await prisma.auditLog.count({ where: { entityId: b.id, action: "STORE_EXCHANGE_CANCELLED" } })).toBe(1);
    expect(await selesaikanTukar({ exchangeId: b.id, olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });
});
