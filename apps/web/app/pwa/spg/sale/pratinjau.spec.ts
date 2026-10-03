import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { kunciBaris } from "@/lib/spg/stok";
import { bacaDiskonManual, KUNCI_DISKON_MANUAL } from "@/lib/spg/pengaturan";
import { promoKonterUntukToko } from "@/lib/spg/promo-konter-queries";
import { getSellableCatalogForSpg } from "@/lib/spg/sale-queries";
import { recordSpgSale } from "@/lib/spg/sale-writer";
import { muatanKirimNotaSpg, susunNotaTertahan } from "@/lib/pwa/offline/spg-jual-muatan";
import { pembeliUntukKirim, pratinjauKeranjang, type BarisKeranjang } from "./keranjang";

/**
 * Layar jual ↔ penulis nota, di basis data sungguhan: total yang dilihat SPG di
 * HP (katalog + daftar promo yang ikut halaman + mesin promo yang sama) harus
 * sama dengan total yang dicatat server — untuk promo kategori, promo belanja,
 * dan diskon SPG — juga saat nota dikirim belakangan dari antrean HP.
 *
 * Promo uji HANYA untuk toko uji (`allStores: false`); pengaturan diskon manual
 * (global) dipotret dan dipulihkan PALING DULU.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("pratinjau keranjang SPG = nota tercatat (test bed only)", () => {
  const tag = `JUAL-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let kategoriId = "";
  let kaosId = "";
  let topiId = "";
  let salesmanId = "";
  let storeId = "";
  let promoIds: string[] = [];
  let setelanLama: string | null | undefined = undefined;

  beforeEach(async () => {
    uomId = "";
    kategoriId = "";
    kaosId = "";
    topiId = "";
    storeId = "";
    promoIds = [];
    setelanLama = undefined;
    const s = await prisma.systemSetting.findUnique({ where: { key: KUNCI_DISKON_MANUAL } });
    setelanLama = s ? s.value : null;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriId = (await prisma.itemCategory.create({ data: { name: `Kaos ${tag}` } })).id;
    kaosId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kaos Uji", nameEn: "Test Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 99_900, categoryId: kategoriId },
      })
    ).id;
    topiId = (
      await prisma.item.create({
        data: { sku: `${tag}-T`, nameId: "Topi Uji", nameEn: "Test Cap", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 45_500 },
      })
    ).id;
    salesmanId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    storeId = (await prisma.store.create({ data: { code: tag, name: "Toko Jual Uji", address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
  });

  afterEach(async () => {
    // Pengaturan global dipulihkan PALING DULU — langkah lain boleh gagal, yang ini tidak.
    if (setelanLama === null) {
      await prisma.systemSetting.delete({ where: { key: KUNCI_DISKON_MANUAL } }).catch(() => undefined);
    } else if (setelanLama !== undefined) {
      await prisma.systemSetting.update({ where: { key: KUNCI_DISKON_MANUAL }, data: { value: setelanLama } });
    }
    await prisma.counterPromoTarget.deleteMany({ where: { promoId: { in: promoIds.map((id) => seededId(id)) } } });
    await prisma.counterPromo.deleteMany({ where: { id: { in: promoIds.map((id) => seededId(id)) } } });
    await prisma.storeCustomer.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeStockMovement.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(topiId)] } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(topiId)] } } });
    await prisma.spgSaleLine.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(topiId)] } } });
    await prisma.spgSale.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(kaosId), seededId(topiId)] } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(kategoriId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  async function buatPromo(data: { name: string; type: string; value: number; minSubtotal?: number; kategori?: string }) {
    const p = await prisma.counterPromo.create({
      data: {
        name: data.name,
        type: data.type,
        value: data.value,
        minSubtotal: data.minSubtotal ?? null,
        allItems: !data.kategori,
        allStores: false,
        createdById: salesmanId,
        targets: { create: [{ kind: "STORE", refId: storeId }, ...(data.kategori ? [{ kind: "CATEGORY", refId: data.kategori }] : [])] },
      },
    });
    promoIds.push(p.id);
  }

  /** Persis yang dilakukan halaman jual + layar: katalog toko, promo toko, pengaturan diskon. */
  async function bukaLayarJual(qty: Record<string, number>) {
    const [katalog, promos, setelan] = await Promise.all([
      getSellableCatalogForSpg(storeId),
      promoKonterUntukToko(storeId, new Date()),
      prisma.systemSetting.findUnique({ where: { key: KUNCI_DISKON_MANUAL }, select: { value: true } }),
    ]);
    const baris: BarisKeranjang[] = katalog
      .filter((r) => qty[r.itemId])
      .map((r) => ({ kunci: kunciBaris(r.itemId, r.variantSku), row: r, qty: qty[r.itemId] }));
    expect(baris).toHaveLength(Object.keys(qty).length);
    expect(baris.find((b) => b.row.itemId === kaosId)?.row.categoryId).toBe(kategoriId);
    return { baris, promos, aturan: bacaDiskonManual(setelan?.value) };
  }

  it("records the total the phone showed — category promo plus spend promo, sent later from the offline queue", async () => {
    await buatPromo({ name: "Kaos 15%", type: "PERSEN", value: 15, kategori: kategoriId });
    await buatPromo({ name: "Belanja 200rb", type: "MIN_BELANJA_POTONGAN", value: 12_500, minSubtotal: 200_000 });
    const layar = await bukaLayarJual({ [kaosId]: 3, [topiId]: 1 });
    const waktuJual = new Date(Date.now() - 60 * 60_000);
    const p = pratinjauKeranjang({ baris: layar.baris, promos: layar.promos, storeId, waktu: waktuJual, aturan: layar.aturan, diskon: null });
    expect(p?.galatMesin).toBeNull();
    // Promo global di basis data bersama boleh ikut berlaku (di HP dan di server sama-sama) —
    // yang dipasak hanya bahwa ada promo barang dan promo belanja di hitungan ini.
    expect(p!.hasil.potonganBaris).toBeGreaterThan(0);
    expect(p!.hasil.promoNota).not.toBeNull();

    const nota = susunNotaTertahan({
      idempotencyKey: `kunci-${tag}`,
      storeId,
      storeName: "Toko Jual Uji",
      visitId: null,
      waktuJual,
      baris: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty, productName: "x", unitPrice: b.row.price ?? 0 })),
      pembeli: pembeliUntukKirim({ jenis: "baru", nama: "Ani Uji", hp: "0812 0000 1234", setuju: true }),
      diskonManual: null,
      totalPratinjau: p!.hasil.total,
      potonganPratinjau: p!.hasil.potonganTotal,
    });
    const m = muatanKirimNotaSpg(nota!);
    const kirim = () =>
      recordSpgSale({
        salesmanId,
        storeId,
        lines: m.lines,
        idempotencyKey: m.idempotencyKey,
        pembeli: m.pembeli,
        diskonManual: m.diskonManual,
        luring: m.luring,
        waktuJual: new Date(m.waktuJual!),
        visitId: m.visitId,
      });

    const res = await kirim();
    if (!res.ok) throw new Error(res.code);
    expect(res.total).toBe(p!.hasil.total);
    const tercatat = await prisma.spgSale.findUniqueOrThrow({ where: { id: res.spgSaleId } });
    expect(Number(tercatat.discountTotal)).toBe(p!.hasil.potonganTotal);
    expect(tercatat.capturedOffline).toBe(true);
    expect(tercatat.createdAt.toISOString()).toBe(waktuJual.toISOString());
    expect(tercatat.customerId).not.toBeNull();

    // Jawaban hilang di jalan → antrean mengirim lagi dengan kunci yang sama: nota yang sama, bukan nota kedua.
    const ulang = await kirim();
    if (!ulang.ok) throw new Error(ulang.code);
    expect(ulang.spgSaleId).toBe(res.spgSaleId);
    expect(await prisma.spgSale.count({ where: { storeId } })).toBe(1);
  });

  it("records the SPG discount the phone showed, and the phone refuses the same limit the server does", async () => {
    await prisma.systemSetting.upsert({
      where: { key: KUNCI_DISKON_MANUAL },
      create: { key: KUNCI_DISKON_MANUAL, value: JSON.stringify({ aktif: true, maksPersen: 10, alasanWajib: true }) },
      update: { value: JSON.stringify({ aktif: true, maksPersen: 10, alasanWajib: true }) },
    });
    await buatPromo({ name: "Semua 5%", type: "PERSEN", value: 5 });
    const layar = await bukaLayarJual({ [kaosId]: 1, [topiId]: 2 });
    const waktu = new Date();

    const lewat = pratinjauKeranjang({ ...layar, storeId, waktu, diskon: { jenis: "PERSEN", nilai: "11", alasan: "x" } });
    expect(lewat?.galatMesin).toBe("DISKON_MANUAL_LEWAT_BATAS");
    const tolak = await recordSpgSale({
      salesmanId,
      storeId,
      lines: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty })),
      diskonManual: { jenis: "PERSEN", nilai: 11, alasan: "x" },
    });
    expect(tolak).toEqual({ ok: false, code: "DISKON_MANUAL_LEWAT_BATAS" });

    const p = pratinjauKeranjang({ ...layar, storeId, waktu, diskon: { jenis: "RUPIAH", nilai: "7.500", alasan: "jahitan" } });
    expect(p?.galatMesin).toBeNull();
    expect(p!.hasil.diskonManual).toBe(7_500);
    const res = await recordSpgSale({
      salesmanId,
      storeId,
      lines: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty })),
      diskonManual: { jenis: "RUPIAH", nilai: 7_500, alasan: "jahitan" },
    });
    if (!res.ok) throw new Error(res.code);
    expect(res.total).toBe(p!.hasil.total);
  });
});
