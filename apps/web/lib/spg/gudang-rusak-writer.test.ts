import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { catatHitunganGudang, catatReturToko, batalkanRetur } from "@/lib/receivables/return-writer";
import { pindahkanReturKeToko } from "@/lib/receivables/koreksi";
import { catatReturPembeli } from "./retur-pembeli";
import { putuskanGudangRusak } from "./gudang-rusak-writer";
import { barisReturPembeliUntukRetur, riwayatGudangRusak, rusakPembeliUntukSpg, saldoGudangRusak } from "./gudang-rusak-queries";
import { JEJAK_GUDANG_RUSAK } from "./gudang-rusak";

/*
 * Gudang barang rusak, terhadap basis data uji: retur pembeli RUSAK di konter →
 * SPG mengirim balik lewat NRT yang barisnya menunjuk retur pembeli (tanpa
 * RETUR_KELUAR) → gudang menghitung NRI, baris RUSAK masuk gudang barang rusak →
 * kantor memutuskan (PERBAIKI / JUAL_OBRAL / MUSNAHKAN) dengan penjaga saldo di
 * bawah balapan.
 *
 * Semua baris milik fixture buatan tes (toko, barang, pengguna berkode acak);
 * teardown hanya lewat id yang diseed (`seededId`/`seededIds`).
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `GRS-${Math.random().toString(36).slice(2, 9)}`;
const hari = (iso: string) => new Date(`${iso}T00:00:00+07:00`);

d("gudang barang rusak (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let tokoA = "";
  let tokoB = "";
  let spgA = "";
  let spgB = "";
  let gudang = "";
  let nota = 0;
  let saleIds: string[] = [];
  let returPembeliIds: string[] = [];
  let nrtIds: string[] = [];
  let nriIds: string[] = [];
  let gerakIds: string[] = [];

  const varian = () => `${tag}-KAOS-M`;
  const tokoIds = () => seededIds([tokoA, tokoB].filter(Boolean));

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: `Kaos ${tag}`,
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          sellingPrice: 50_000,
          variants: [{ sku: varian(), size: "M" }],
        },
      })
    ).id;
    const toko = async (kode: string) =>
      (
        await prisma.store.create({
          data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType: "KONSI", markupPercent: 20, isActive: true },
        })
      ).id;
    tokoA = await toko("A");
    tokoB = await toko("B");
    const pengguna = async (n: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId: storeId } })).id;
    spgA = await pengguna("spg-a", tokoA);
    spgB = await pengguna("spg-b", tokoB);
    gudang = await pengguna("gudang", null);
  });

  beforeEach(async () => {
    saleIds = [];
    returPembeliIds = [];
    nrtIds = [];
    nriIds = [];
    gerakIds = [];
    // Buku toko A sudah dimulai: 10 potong M di rak.
    await prisma.storeStockMovement.create({
      data: { storeId: tokoA, itemId: kaos, variantSku: varian(), qty: 10, kind: "OPNAME", createdById: spgA },
    });
  });

  afterEach(async () => {
    const notaToko = await prisma.storeReturn.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const idNota = [...new Set([...nrtIds, ...notaToko.map((n) => n.id)])];
    const nri = await prisma.warehouseReturn.findMany({ where: { storeReturnId: { in: seededIds(idNota) } }, select: { id: true } });
    const idNri = [...new Set([...nriIds, ...nri.map((n) => n.id)])];
    const gerak = await prisma.damagedStockMovement.findMany({ where: { itemId: seededId(kaos) }, select: { id: true } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: seededIds([...idNota, ...idNri, ...returPembeliIds, ...gerakIds, ...gerak.map((g) => g.id)]) } },
    });
    await prisma.damagedStockMovement.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.returnCharge.deleteMany({ where: { storeReturnId: { in: seededIds(idNota) } } });
    // NRT SPG dari toko uji tanpa pemegang membunyikan lonceng kantor — dicocokkan di JS lewat metadata.
    const lonceng = await prisma.adminNotification.findMany({
      where: { category: "RETUR_SPG_TANPA_PEMEGANG" },
      select: { id: true, metadata: true },
    });
    const loncengUji = lonceng
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.storeReturnId === "string" && idNota.includes(m.storeReturnId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(loncengUji) } } });
    await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(idNri) } } });
    await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(idNota) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: { in: seededIds(saleIds) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(saleIds) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(saleIds) } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgB, gudang].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    if (kaos) await prisma.item.delete({ where: { id: seededId(kaos) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  /** Nota SPG di toko A, lalu pembeli mengembalikan `rusak` potong dalam keadaan RUSAK. */
  async function rusakDariPembeli(rusak: number, toko = tokoA, spg = spgA) {
    nota += 1;
    const sale = await prisma.spgSale.create({
      data: {
        docNo: `${tag}/SPG/${nota}`,
        salesmanId: spg,
        storeId: toko,
        subtotal: 150_000,
        total: 150_000,
        cashReceived: 150_000,
        changeGiven: 0,
        createdById: spg,
        lines: { create: [{ itemId: kaos, variantSku: varian(), productName: `Kaos ${tag} — M`, qty: 3, unitPrice: 50_000, lineTotal: 150_000 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    saleIds.push(sale.id);
    const h = await catatReturPembeli({
      spgSaleId: sale.id,
      storeId: toko,
      userId: spg,
      baris: [{ saleLineId: sale.lines[0].id, qty: rusak, condition: "RUSAK" }],
      alasan: "jahitan lepas",
      idempotencyKey: `${tag}-rp-${nota}`,
    });
    if (!h.ok) throw new Error(`retur pembeli gagal: ${h.alasan}`);
    returPembeliIds.push(h.returnId);
    const line = await prisma.spgSaleReturnLine.findFirstOrThrow({ where: { returnId: seededId(h.returnId) }, select: { id: true } });
    return line.id;
  }

  const kirimBalik = (baris: Parameters<typeof catatReturToko>[0]["barisSpg"], opsi: { kunci?: string; toko?: string; spg?: string } = {}) =>
    catatReturToko({
      noNrt: "",
      storeId: opsi.toko ?? tokoA,
      olehUserId: opsi.spg ?? spgA,
      salesmanId: opsi.spg ?? spgA,
      claimDate: hari("2026-10-02"),
      deliveryMethod: "SALES",
      reportedBySpg: true,
      barisSpg: baris,
      ...(opsi.kunci ? { idempotencyKey: `${tag}-${opsi.kunci}` } : {}),
    }).then((h) => {
      if (h.ok) nrtIds.push(h.id);
      return h;
    });

  const saldoBuku = async () =>
    (await prisma.storeStockMovement.aggregate({ where: { storeId: seededId(tokoA), itemId: seededId(kaos), variantSku: varian() }, _sum: { qty: true } }))._sum
      .qty ?? 0;
  const saldoRusak = async () =>
    (await prisma.damagedStockMovement.aggregate({ where: { itemId: seededId(kaos), variantSku: varian() }, _sum: { qty: true } }))._sum.qty ?? 0;

  /** Retur pembeli 2 RUSAK → NRT → NRI: 2 potong masuk gudang barang rusak. */
  async function isiGudangRusak(): Promise<string> {
    const rp = await rusakDariPembeli(2);
    const nrt = await kirimBalik([{ itemId: kaos, variantSku: varian(), qty: 2, condition: "RUSAK", spgSaleReturnLineId: rp }]);
    if (!nrt.ok) throw new Error(`nrt gagal: ${nrt.alasan}`);
    const nri = await catatHitunganGudang({
      storeReturnId: nrt.id,
      warehouseUserId: gudang,
      receivedAt: hari("2026-10-03"),
      deliveryMethod: "SALES",
      items: [{ itemId: kaos, variantSku: varian(), itemName: `Kaos ${tag} — M`, qty: 2, price: 0, condition: "RUSAK" }],
    });
    if (!nri.ok) throw new Error(`nri gagal: ${nri.alasan}`);
    nriIds.push(nri.id);
    return nri.id;
  }

  it("HP: retur pembeli RUSAK muncul sebagai barang yang harus dikirim balik — toko lain tidak melihatnya", async () => {
    const rp = await rusakDariPembeli(2);
    // Barang rusak tidak kembali ke rak.
    expect(await saldoBuku()).toBe(10);
    const daftar = await rusakPembeliUntukSpg(tokoA);
    expect(daftar.find((r) => r.id === rp)).toMatchObject({ itemId: kaos, variantSku: varian(), kondisi: "RUSAK", qty: 2, sisa: 2, alasan: "jahitan lepas" });
    expect(JSON.stringify(daftar)).not.toMatch(/unitPrice|lineTotal|50000/);
    expect((await rusakPembeliUntukSpg(tokoB)).some((r) => r.id === rp)).toBe(false);
    expect(await barisReturPembeliUntukRetur(tokoB, [rp])).toEqual([]);
    expect(await barisReturPembeliUntukRetur(tokoA, [rp])).toEqual([expect.objectContaining({ id: rp, sisa: 2 })]);
  });

  it("NRT yang menunjuk retur pembeli: tersimpan, tanpa RETUR_KELUAR, dan sisanya berkurang; tidak bisa dikirim dua kali", async () => {
    const rp = await rusakDariPembeli(2);
    const a = await kirimBalik([
      { itemId: kaos, variantSku: varian(), qty: 1, condition: "RUSAK", spgSaleReturnLineId: rp },
      // Baris biasa di nota yang sama tetap keluar dari buku.
      { itemId: kaos, variantSku: varian(), qty: 1, condition: "LAYAK" },
    ]);
    if (!a.ok) throw new Error(`gagal: ${a.alasan}`);
    const baris = await prisma.storeReturnItem.findMany({ where: { storeReturnId: seededId(a.id) } });
    expect(baris.find((b) => b.spgSaleReturnLineId === rp)).toMatchObject({ qty: 1, condition: "RUSAK" });
    expect(await saldoBuku()).toBe(9);

    expect((await rusakPembeliUntukSpg(tokoA)).find((r) => r.id === rp)).toMatchObject({ sisa: 1 });
    expect(await kirimBalik([{ itemId: kaos, variantSku: varian(), qty: 2, condition: "RUSAK", spgSaleReturnLineId: rp }])).toEqual({
      ok: false,
      alasan: "RETUR_PEMBELI_MELEBIHI",
    });
    const b = await kirimBalik([{ itemId: kaos, variantSku: varian(), qty: 1, condition: "RUSAK", spgSaleReturnLineId: rp }]);
    expect(b.ok).toBe(true);
    expect((await rusakPembeliUntukSpg(tokoA)).some((r) => r.id === rp)).toBe(false);

    // Nota yang dibatalkan melepas jatahnya kembali — dan tidak membalik buku untuk baris itu.
    if (!b.ok) return;
    expect((await batalkanRetur({ storeReturnId: b.id, alasan: "salah catat", olehUserId: gudang })).ok).toBe(true);
    expect(await saldoBuku()).toBe(9);
    expect((await rusakPembeliUntukSpg(tokoA)).find((r) => r.id === rp)).toMatchObject({ sisa: 1 });
  });

  it("menolak retur pembeli toko lain dan kondisi LAYAK", async () => {
    const rp = await rusakDariPembeli(1);
    expect(await kirimBalik([{ itemId: kaos, variantSku: varian(), qty: 1, condition: "RUSAK", spgSaleReturnLineId: rp }], { toko: tokoB, spg: spgB })).toEqual({
      ok: false,
      alasan: "RETUR_PEMBELI_TIDAK_SAH",
    });
    expect(await kirimBalik([{ itemId: kaos, variantSku: varian(), qty: 1, condition: "LAYAK", spgSaleReturnLineId: rp }])).toEqual({
      ok: false,
      alasan: "RETUR_PEMBELI_TIDAK_SAH",
    });
  });

  it("dua NRT bersamaan untuk retur pembeli yang sama: hanya satu yang lolos", async () => {
    const rp = await rusakDariPembeli(2);
    const [a, b] = await Promise.all([
      kirimBalik([{ itemId: kaos, variantSku: varian(), qty: 2, condition: "RUSAK", spgSaleReturnLineId: rp }], { kunci: "a" }),
      kirimBalik([{ itemId: kaos, variantSku: varian(), qty: 2, condition: "RUSAK", spgSaleReturnLineId: rp }], { kunci: "b" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((h) => !h.ok)).toEqual({ ok: false, alasan: "RETUR_PEMBELI_MELEBIHI" });
  });

  it("nota yang mengirim balik barang rusak tidak bisa dipindah toko", async () => {
    const rp = await rusakDariPembeli(1);
    const h = await kirimBalik([{ itemId: kaos, variantSku: varian(), qty: 1, condition: "RUSAK", spgSaleReturnLineId: rp }]);
    if (!h.ok) throw new Error(`gagal: ${h.alasan}`);
    expect(await pindahkanReturKeToko({ storeReturnId: h.id, tokoTujuanId: tokoB, alasan: "salah toko", olehUserId: gudang })).toEqual({
      ok: false,
      alasan: "ADA_BARIS_RUSAK",
    });
    const tetap = await prisma.storeReturn.findUniqueOrThrow({ where: { id: h.id }, select: { storeId: true } });
    expect(tetap.storeId).toBe(tokoA);
  });

  it("gudang menghitung NRI: baris RUSAK masuk gudang barang rusak, asalnya terbaca", async () => {
    const nriId = await isiGudangRusak();
    expect(await saldoRusak()).toBe(2);
    const baris = await prisma.warehouseReturnItem.findFirstOrThrow({ where: { warehouseReturnId: seededId(nriId) }, select: { id: true } });
    const gerak = await prisma.damagedStockMovement.findMany({ where: { itemId: seededId(kaos) } });
    expect(gerak).toEqual([expect.objectContaining({ qty: 2, kind: "MASUK_RETUR", refType: "WarehouseReturnItem", refId: baris.id, createdById: gudang })]);
    // Stok jual tidak bertambah.
    expect(await prisma.inventoryValue.count({ where: { itemId: seededId(kaos) } })).toBe(0);

    const saldo = (await saldoGudangRusak()).find((s) => s.itemId === kaos);
    expect(saldo).toMatchObject({ variantSku: varian(), saldo: 2, masuk: 2, keluar: 0 });
    expect(saldo?.asal).toEqual([{ toko: `Toko A ${tag}`, asal: ["RETUR_PEMBELI"], qty: 2 }]);
    const riwayat = (await riwayatGudangRusak()).filter((g) => g.itemId === kaos);
    expect(riwayat[0]).toMatchObject({ jenis: "MASUK_RETUR", qty: 2, masuk: expect.objectContaining({ asal: ["RETUR_PEMBELI"] }) });
  });

  it("PERBAIKI: keluar dari gudang barang rusak, masuk stok jual lewat penyesuaian POSITIVE, dengan jejak", async () => {
    await isiGudangRusak();
    await prisma.inventoryValue.create({ data: { itemId: kaos, variantSku: varian(), qtyOnHand: 5, reservedQty: 0, avgCost: 20_000, totalValue: 100_000 } });

    const h = await putuskanGudangRusak({ itemId: kaos, variantSku: varian(), keputusan: "PERBAIKI", qty: 1, catatan: "dijahit ulang", olehUserId: gudang });
    if (!h.ok) throw new Error(`gagal: ${h.alasan}`);
    gerakIds.push(h.gerakId);
    expect(h.saldoSesudah).toBe(1);
    expect(await saldoRusak()).toBe(1);

    const stok = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(kaos), variantSku: varian() } });
    expect(Number(stok.qtyOnHand)).toBe(6);
    expect(Number(stok.avgCost)).toBe(20_000);
    const adj = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: h.penyesuaianId ?? "" } });
    expect(adj).toMatchObject({ type: "POSITIVE", source: "STORE_RETURN_RECEIVE", createdById: gudang });
    expect(Number(adj.qtyChange)).toBe(1);
    const gerak = await prisma.damagedStockMovement.findUniqueOrThrow({ where: { id: h.gerakId } });
    expect(gerak).toMatchObject({ qty: -1, kind: "PERBAIKI", refType: "StockAdjustment", refId: adj.id, note: "dijahit ulang" });

    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: h.gerakId } });
    expect(jejak).toMatchObject({ action: JEJAK_GUDANG_RUSAK.DIPUTUSKAN, entityType: "DamagedStockMovement", userId: gudang, reason: "dijahit ulang" });
    expect(jejak.changes).toEqual({ before: { saldo: 2 }, after: { saldo: 1 } });
  });

  it("JUAL_OBRAL mencatat nilai tanpa menyentuh stok jual; MUSNAHKAN keluar saja; keluar tidak pernah melebihi saldo", async () => {
    await isiGudangRusak();
    const obral = await putuskanGudangRusak({ itemId: kaos, variantSku: varian(), keputusan: "JUAL_OBRAL", qty: 1, nilai: 15_000, catatan: "obral gudang", olehUserId: gudang });
    if (!obral.ok) throw new Error(`gagal: ${obral.alasan}`);
    gerakIds.push(obral.gerakId);
    const g = await prisma.damagedStockMovement.findUniqueOrThrow({ where: { id: obral.gerakId } });
    expect(Number(g.value)).toBe(15_000);
    expect(obral.penyesuaianId).toBeNull();
    expect(await prisma.inventoryValue.count({ where: { itemId: seededId(kaos) } })).toBe(0);

    expect(await putuskanGudangRusak({ itemId: kaos, variantSku: varian(), keputusan: "MUSNAHKAN", qty: 2, catatan: "x", olehUserId: gudang })).toEqual({
      ok: false,
      alasan: "SALDO_KURANG",
    });
    const musnah = await putuskanGudangRusak({ itemId: kaos, variantSku: varian(), keputusan: "MUSNAHKAN", qty: 1, catatan: "sobek", olehUserId: gudang });
    if (!musnah.ok) throw new Error(`gagal: ${musnah.alasan}`);
    gerakIds.push(musnah.gerakId);
    expect(await saldoRusak()).toBe(0);
    expect((await saldoGudangRusak()).some((s) => s.itemId === kaos)).toBe(false);
  });

  it("balapan: dua keputusan atas seluruh saldo yang sama — hanya satu yang lolos, saldo tidak pernah negatif", async () => {
    await isiGudangRusak();
    const putus = (k: "MUSNAHKAN" | "PERBAIKI") =>
      putuskanGudangRusak({ itemId: kaos, variantSku: varian(), keputusan: k, qty: 2, catatan: `balapan ${k}`, olehUserId: gudang });
    const hasil = await Promise.all([putus("MUSNAHKAN"), putus("PERBAIKI")]);
    for (const h of hasil) if (h.ok) gerakIds.push(h.gerakId);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.find((h) => !h.ok)).toEqual({ ok: false, alasan: "SALDO_KURANG" });
    expect(await saldoRusak()).toBe(0);
    const keluar = await prisma.damagedStockMovement.count({ where: { itemId: seededId(kaos), qty: { lt: 0 } } });
    expect(keluar).toBe(1);
  });

  it("balapan: dua MUSNAHKAN bersamaan (hanya menyisipkan baris) tetap tidak bisa sama-sama lolos", async () => {
    await isiGudangRusak();
    const hasil = await Promise.all(
      [1, 2].map((i) => putuskanGudangRusak({ itemId: kaos, variantSku: varian(), keputusan: "MUSNAHKAN", qty: 2, catatan: `buang ${i}`, olehUserId: gudang })),
    );
    for (const h of hasil) if (h.ok) gerakIds.push(h.gerakId);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(await saldoRusak()).toBe(0);
  });
});
