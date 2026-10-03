import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { JEJAK_PROMO_KONTER, type IsianPromoKonter } from "./promo-konter-kantor";
import { laporanDiskonManual, laporanPemakaianPromo, pemakaianPromoKonter, promoKonterHp, promoKonterUntukUbah } from "./promo-konter-kantor-queries";
import { aturAktifPromoKonter, hapusPromoKonter, simpanPromoKonter } from "./promo-konter-writer";
import { recordSpgSale } from "./sale-writer";

/**
 * Penulis & kueri promo konter (kantor), basis data sungguhan.
 *
 * Setiap promo uji HANYA untuk toko uji (`allStores: false`) — promo global di
 * basis data bersama tidak boleh tersentuh, dan promo uji tidak boleh bocor ke
 * nota toko lain. Teardown lewat `seededId()`: id kosong tidak pernah melebar
 * menjadi "hapus semua".
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("promo konter kantor (test bed only)", () => {
  const tag = `PK-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let kategoriId = "";
  let itemId = "";
  let item2Id = "";
  let userId = "";
  let storeId = "";
  let storeLainId = "";
  let promoIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    kategoriId = "";
    itemId = "";
    item2Id = "";
    storeId = "";
    storeLainId = "";
    promoIds = [];
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriId = (await prisma.itemCategory.create({ data: { name: `Kemeja ${tag}` } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: `Kemeja Uji ${tag}`, nameEn: "Shirt", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 100_000, categoryId: kategoriId },
      })
    ).id;
    item2Id = (
      await prisma.item.create({ data: { sku: `${tag}-2`, nameId: `Celana Uji ${tag}`, nameEn: "Pants", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 50_000 } })
    ).id;
    userId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    storeId = (await prisma.store.create({ data: { code: tag, name: `Toko Promo ${tag}`, address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
    storeLainId = (
      await prisma.store.create({ data: { code: `${tag}-L`, name: `Toko Lain ${tag}`, address: "Jl. Uji", termsType: "PUTUS", isActive: true } })
    ).id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "CounterPromo", entityId: { in: seededIds(promoIds) } } });
    await prisma.counterPromoTarget.deleteMany({ where: { promoId: { in: seededIds(promoIds) } } });
    await prisma.counterPromo.deleteMany({ where: { id: { in: seededIds(promoIds) } } });
    await prisma.storeStockMovement.deleteMany({ where: { itemId: { in: [seededId(itemId), seededId(item2Id)] } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: [seededId(itemId), seededId(item2Id)] } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSale: { storeId: { in: [seededId(storeId), seededId(storeLainId)] } } } });
    await prisma.spgSale.deleteMany({ where: { storeId: { in: [seededId(storeId), seededId(storeLainId)] } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemId), seededId(item2Id)] } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(kategoriId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(storeLainId)] } } });
  });

  const isian = (i: Partial<IsianPromoKonter> = {}): IsianPromoKonter => ({
    name: `Diskon ${tag}`,
    type: "PERSEN",
    value: 20,
    buyQty: null,
    freeQty: null,
    minSubtotal: null,
    allItems: false,
    itemIds: [itemId],
    categoryIds: [],
    allStores: false,
    storeIds: [storeId],
    dari: "",
    sampai: "",
    priority: 0,
    note: "",
    storeSharePercent: 0,
    ...i,
  });

  async function buat(i: Partial<IsianPromoKonter> = {}, aktif = true): Promise<string> {
    const r = await simpanPromoKonter({ isian: isian(i), aktif, userId });
    if (!r.ok) throw new Error(`${r.code} ${"masalah" in r ? r.masalah.join(",") : ""}`);
    promoIds.push(r.id);
    return r.id;
  }

  const jejak = (id: string) => prisma.auditLog.findMany({ where: { entityType: "CounterPromo", entityId: seededId(id) }, orderBy: { createdAt: "asc" } });

  it("membuat promo dengan sasaran dan rentang WIB, dan mencatat jejaknya", async () => {
    const id = await buat({ dari: "2026-10-03", sampai: "2026-10-05", categoryIds: [kategoriId], note: "  Ulang tahun toko  " });
    const p = await prisma.counterPromo.findUniqueOrThrow({ where: { id }, include: { targets: true } });
    expect(p.startsAt?.toISOString()).toBe("2026-10-02T17:00:00.000Z");
    expect(p.endsAt?.toISOString()).toBe("2026-10-05T16:59:59.999Z");
    expect(p.note).toBe("Ulang tahun toko");
    expect(p.allStores).toBe(false);
    expect(p.targets.map((t) => `${t.kind}:${t.refId}`).sort()).toEqual([`CATEGORY:${kategoriId}`, `ITEM:${itemId}`, `STORE:${storeId}`].sort());
    const j = await jejak(id);
    expect(j.map((x) => x.action)).toEqual([JEJAK_PROMO_KONTER.DIBUAT]);
    expect(j[0].changes).toMatchObject({ before: null, after: { name: `Diskon ${tag}`, value: 20, storeIds: [storeId] } });

    const ubah = await promoKonterUntukUbah(id);
    expect(ubah?.isian).toMatchObject({ dari: "2026-10-03", sampai: "2026-10-05", itemIds: [itemId], categoryIds: [kategoriId], storeIds: [storeId] });
  });

  it("promo baru tanpa tanggal mulai berlaku sejak disimpan, bukan sejak dulu", async () => {
    const sebelum = Date.now();
    const id = await buat();
    const p = await prisma.counterPromo.findUniqueOrThrow({ where: { id } });
    expect(p.startsAt).not.toBeNull();
    expect(p.startsAt!.getTime()).toBeGreaterThanOrEqual(sebelum - 1000);
    expect(p.endsAt).toBeNull();
    // Nota antrean HP bertanggal kemarin tidak ikut kena promo yang baru dibuat hari ini.
    const kemarin = await recordSpgSale({
      salesmanId: userId,
      storeId,
      lines: [{ itemId, variantSku: null, qty: 1 }],
      luring: true,
      waktuJual: new Date(sebelum - 86_400_000),
    });
    expect(kemarin.ok && kemarin.total).toBe(100_000);
  });

  it("menolak isian tidak sah dan rujukan yang tidak ada, tanpa menulis apa pun", async () => {
    const r1 = await simpanPromoKonter({ isian: isian({ dari: "2026-10-09", sampai: "2026-10-01" }), userId });
    expect(r1).toMatchObject({ ok: false, code: "TIDAK_VALID", masalah: ["TANGGAL_TERBALIK"] });
    const r2 = await simpanPromoKonter({ isian: isian({ storeIds: [storeId, `${tag}-tidak-ada`] }), userId });
    expect(r2).toMatchObject({ ok: false, code: "TIDAK_VALID", masalah: ["TOKO_TIDAK_DIKENAL"] });
    const r3 = await simpanPromoKonter({ isian: isian({ type: "BELI_GRATIS", buyQty: 0, freeQty: 1 }), userId });
    expect(r3).toMatchObject({ ok: false, code: "TIDAK_VALID", masalah: ["BELI_GRATIS_TIDAK_VALID"] });
    expect(await prisma.counterPromo.count({ where: { name: `Diskon ${tag}` } })).toBe(0);
  });

  it("mengubah promo: sasaran diganti utuh, jejak membawa sebelum/sesudah", async () => {
    const id = await buat();
    const r = await simpanPromoKonter({ id, isian: isian({ value: 30, itemIds: [item2Id], storeIds: [storeId, storeLainId], storeSharePercent: 50 }), userId });
    expect(r).toEqual({ ok: true, id });
    const p = await prisma.counterPromo.findUniqueOrThrow({ where: { id }, include: { targets: true } });
    expect(Number(p.value)).toBe(30);
    expect(Number(p.storeSharePercent)).toBe(50);
    expect(p.targets.filter((t) => t.kind === "ITEM").map((t) => t.refId)).toEqual([item2Id]);
    expect(p.targets.filter((t) => t.kind === "STORE")).toHaveLength(2);
    const j = await jejak(id);
    expect(j.map((x) => x.action)).toEqual([JEJAK_PROMO_KONTER.DIBUAT, JEJAK_PROMO_KONTER.DIUBAH]);
    expect(j[1].changes).toMatchObject({
      before: { value: 20, itemIds: [itemId], storeSharePercent: 0 },
      after: { value: 30, itemIds: [item2Id], storeSharePercent: 50 },
    });

    expect(await simpanPromoKonter({ id: `${tag}-tidak-ada`, isian: isian(), userId })).toEqual({ ok: false, code: "TIDAK_ADA" });
  });

  it("menyalakan/mematikan: menyetel ke keadaan yang sama tidak menulis jejak", async () => {
    const id = await buat();
    expect(await aturAktifPromoKonter({ id, aktif: false, userId })).toEqual({ ok: true, berubah: true });
    expect(await aturAktifPromoKonter({ id, aktif: false, userId })).toEqual({ ok: true, berubah: false });
    expect(await aturAktifPromoKonter({ id, aktif: true, userId })).toEqual({ ok: true, berubah: true });
    expect((await jejak(id)).map((x) => x.action)).toEqual([JEJAK_PROMO_KONTER.DIBUAT, JEJAK_PROMO_KONTER.DIMATIKAN, JEJAK_PROMO_KONTER.DINYALAKAN]);
    expect(await aturAktifPromoKonter({ id: "", aktif: true, userId })).toEqual({ ok: false, code: "TIDAK_ADA" });
  });

  it("balapan mematikan: dua permintaan bersamaan, satu jejak", async () => {
    const id = await buat();
    const hasil = await Promise.all([aturAktifPromoKonter({ id, aktif: false, userId }), aturAktifPromoKonter({ id, aktif: false, userId })]);
    expect(hasil.filter((h) => h.ok && h.berubah)).toHaveLength(1);
    expect((await jejak(id)).filter((x) => x.action === JEJAK_PROMO_KONTER.DIMATIKAN)).toHaveLength(1);
  });

  it("menghapus promo yang belum dipakai, dengan jejak", async () => {
    const id = await buat({ categoryIds: [kategoriId] });
    expect(await hapusPromoKonter({ id, userId })).toEqual({ ok: true });
    expect(await prisma.counterPromo.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.counterPromoTarget.count({ where: { promoId: id } })).toBe(0);
    const j = await jejak(id);
    expect(j.map((x) => x.action)).toEqual([JEJAK_PROMO_KONTER.DIBUAT, JEJAK_PROMO_KONTER.DIHAPUS]);
    expect(j[1].changes).toMatchObject({ before: { name: `Diskon ${tag}` }, after: null });
    expect(await hapusPromoKonter({ id, userId })).toEqual({ ok: false, code: "TIDAK_ADA" });
  });

  it("balapan menghapus: satu berhasil, satu TIDAK_ADA, satu jejak", async () => {
    const id = await buat();
    const hasil = await Promise.all([hapusPromoKonter({ id, userId }), hapusPromoKonter({ id, userId })]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok && h.code === "TIDAK_ADA")).toHaveLength(1);
    expect((await jejak(id)).filter((x) => x.action === JEJAK_PROMO_KONTER.DIHAPUS)).toHaveLength(1);
  });

  it("promo yang sudah dipakai di nota tidak bisa dihapus; pemakaiannya terhitung", async () => {
    const id = await buat();
    const belanja = await buat({ name: `Belanja ${tag}`, type: "MIN_BELANJA_POTONGAN", value: 10_000, minSubtotal: 100_000, allItems: true, itemIds: [] });
    const nota = await recordSpgSale({
      salesmanId: userId,
      storeId,
      lines: [
        { itemId, variantSku: null, qty: 2 },
        { itemId: item2Id, variantSku: null, qty: 1 },
      ],
    });
    if (!nota.ok) throw new Error(nota.code);
    // Toko lain: promo uji tidak berlaku di sana.
    const notaLain = await recordSpgSale({ salesmanId: userId, storeId: storeLainId, lines: [{ itemId, variantSku: null, qty: 1 }] });
    expect(notaLain.ok && notaLain.total).toBe(100_000);

    expect(await hapusPromoKonter({ id, userId })).toEqual({ ok: false, code: "SUDAH_DIPAKAI", nota: 1 });
    expect(await hapusPromoKonter({ id: belanja, userId })).toEqual({ ok: false, code: "SUDAH_DIPAKAI", nota: 1 });
    expect(await prisma.counterPromo.count({ where: { id: { in: [id, belanja] } } })).toBe(2);

    const pakai = await pemakaianPromoKonter({ dari: null, sampai: null, promoIds: [id, belanja] });
    // Kemeja 2 × 100.000 diskon 20% = 40.000; belanja 210.000 ≥ 100.000 → potongan 10.000.
    expect(pakai.get(id)).toEqual({ nota: 1, potongan: 40_000 });
    expect(pakai.get(belanja)).toEqual({ nota: 1, potongan: 10_000 });

    const sekarang = new Date();
    const lapor = await laporanPemakaianPromo({ dari: new Date(sekarang.getTime() - 60_000), sampai: new Date(sekarang.getTime() + 60_000) });
    expect(lapor.baris.find((b) => b.id === id)).toMatchObject({ name: `Diskon ${tag}`, nota: 1, potongan: 40_000, belanja: false });
    expect(lapor.baris.find((b) => b.id === belanja)).toMatchObject({ nota: 1, potongan: 10_000, belanja: true });
    // Rentang yang tidak memuat notanya: tidak terhitung.
    const kemarin = await laporanPemakaianPromo({ dari: new Date("2020-01-01T00:00:00+07:00"), sampai: new Date("2020-01-31T23:59:59.999+07:00") });
    expect(kemarin.baris.find((b) => b.id === id)).toBeUndefined();

    expect((await promoKonterUntukUbah(id))?.nota).toBe(1);
  });

  it("tanggungan potongan: toko konsinyasi dibagi menurut bagian yang dibekukan di nota, toko putus hanya dicatat", async () => {
    await prisma.store.update({ where: { id: storeLainId }, data: { termsType: "KONSI" } });
    await buat({ name: `Bagi ${tag}`, storeIds: [storeLainId], storeSharePercent: 50 });
    await buat({ name: `Putus ${tag}`, storeIds: [storeId], storeSharePercent: 50 });
    const a = await recordSpgSale({ salesmanId: userId, storeId: storeLainId, lines: [{ itemId, variantSku: null, qty: 2 }] });
    const b = await recordSpgSale({ salesmanId: userId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }] });
    if (!a.ok || !b.ok) throw new Error("nota gagal");
    const sekarang = Date.now();
    const lapor = await laporanPemakaianPromo({
      dari: new Date(sekarang - 60_000),
      sampai: new Date(sekarang + 60_000),
      storeIds: [storeId, storeLainId],
    });
    // Konsi: 2 × 100.000 diskon 20% = 40.000, separuhnya toko.
    expect(lapor.tanggungan.konsi).toEqual({ potongan: 40_000, toko: 20_000, elorae: 20_000 });
    expect(lapor.tanggungan.putus).toEqual({ potongan: 20_000 });
    expect(lapor.baris.find((x) => x.name === `Bagi ${tag}`)).toMatchObject({ potongan: 40_000, bagianToko: 50 });
  });

  it("laporan diskon manual: hanya nota dengan diskon manual, dalam rentang, dengan alasan", async () => {
    const dasar = { salesmanId: userId, createdById: userId, storeId, subtotal: 200_000, cashReceived: 0, changeGiven: 0 };
    await prisma.spgSale.create({
      data: { ...dasar, docNo: `${tag}-M1`, total: 180_000, discountTotal: 20_000, manualDiscount: 20_000, manualDiscountReason: "Pelanggan tetap", createdAt: new Date("2026-10-02T10:00:00+07:00") },
    });
    await prisma.spgSale.create({ data: { ...dasar, docNo: `${tag}-M2`, total: 200_000, createdAt: new Date("2026-10-02T11:00:00+07:00") } });
    await prisma.spgSale.create({
      data: { ...dasar, docNo: `${tag}-M3`, total: 190_000, discountTotal: 10_000, manualDiscount: 10_000, manualDiscountReason: "Cacat kecil", createdAt: new Date("2026-09-30T10:00:00+07:00") },
    });
    const r = await laporanDiskonManual({ dari: new Date("2026-10-01T00:00:00+07:00"), sampai: new Date("2026-10-02T23:59:59.999+07:00") });
    const milikUji = r.baris.filter((b) => b.docNo.startsWith(tag));
    expect(milikUji).toHaveLength(1);
    expect(milikUji[0]).toMatchObject({ docNo: `${tag}-M1`, nilai: 20_000, total: 180_000, persen: 10, alasan: "Pelanggan tetap", toko: `Toko Promo ${tag}` });
  });

  it("HP: promo berlaku dan terjadwal di toko ini, sasaran sebagai nama — tanpa id barang/toko", async () => {
    const hariIni = new Date();
    const hari = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(hariIni.getTime() + n * 86_400_000));
    const berlaku = await buat({ categoryIds: [kategoriId] });
    const nanti = await buat({ name: `Nanti ${tag}`, dari: hari(3), sampai: hari(10) });
    const lewat = await buat({ name: `Lewat ${tag}`, dari: hari(-10), sampai: hari(-3) });
    const mati = await buat({ name: `Mati ${tag}` }, false);
    const lain = await buat({ name: `Lain ${tag}`, storeIds: [storeLainId] });

    const hp = await promoKonterHp(storeId);
    const milikUji = hp.filter((p) => [berlaku, nanti, lewat, mati, lain].includes(p.id));
    expect(milikUji.map((p) => p.id)).toEqual([berlaku, nanti]);
    expect(milikUji[0]).toMatchObject({ status: "BERLAKU", ringkasan: "Diskon 20%", barang: [`Kemeja Uji ${tag}`], kategori: [`Kemeja ${tag}`], semuaBarang: false });
    expect(milikUji[1]).toMatchObject({ status: "TERJADWAL" });
    const teks = JSON.stringify(milikUji);
    expect(teks).not.toContain(itemId);
    expect(teks).not.toContain(kategoriId);
    expect(teks).not.toContain(storeId);
  });
});
