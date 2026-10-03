import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { KUNCI_DISKON_MANUAL } from "./pengaturan";
import { recordSpgSale } from "./sale-writer";

/**
 * Penulis nota SPG tahap 2: promo konter, diskon manual, pelanggan, penjualan
 * tanpa sinyal, dan titip pesan yang selesai sendiri. Basis data sungguhan.
 *
 * Setiap promo di sini HANYA untuk toko uji (`allStores: false`) — promo global
 * di basis data bersama tidak boleh tersentuh, dan promo uji tidak boleh bocor
 * ke toko lain. Pengaturan diskon manual (global) dipotret dan dipulihkan.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("recordSpgSale tahap 2 (test bed only)", () => {
  const tag = `SPG2-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let item2Id = "";
  let salesmanId = "";
  let storeId = "";
  let storeLainId = "";
  let promoIds: string[] = [];
  let setelanLama: string | null | undefined = undefined;

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    item2Id = "";
    storeId = "";
    storeLainId = "";
    promoIds = [];
    const uom = await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    itemId = (
      await prisma.item.create({ data: { sku: tag, nameId: "Kemeja", nameEn: "Shirt", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 100_000 } })
    ).id;
    item2Id = (
      await prisma.item.create({ data: { sku: `${tag}-2`, nameId: "Celana", nameEn: "Pants", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 50_000 } })
    ).id;
    salesmanId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    storeId = (await prisma.store.create({ data: { code: tag, name: "Toko SPG 2", address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
    storeLainId = (
      await prisma.store.create({ data: { code: `${tag}-L`, name: "Toko Lain", address: "Jl. Uji", termsType: "PUTUS", isActive: true } })
    ).id;
    const s = await prisma.systemSetting.findUnique({ where: { key: KUNCI_DISKON_MANUAL } });
    setelanLama = s ? s.value : null;
  });

  afterEach(async () => {
    // Pengaturan global DIPULIHKAN PALING DULU — langkah lain boleh gagal, yang ini tidak.
    // `delete` (bukan deleteMany) menolak kunci yang tidak ada alih-alih melebar.
    if (setelanLama === null) {
      await prisma.systemSetting.delete({ where: { key: "spg.diskonManual" } }).catch(() => undefined);
    } else if (setelanLama !== undefined) {
      await prisma.systemSetting.update({ where: { key: KUNCI_DISKON_MANUAL }, data: { value: setelanLama } });
    }
    await prisma.counterPromoTarget.deleteMany({ where: { promoId: { in: promoIds.map((id) => seededId(id)) } } });
    await prisma.counterPromo.deleteMany({ where: { id: { in: promoIds.map((id) => seededId(id)) } } });
    // Penutupan otomatis titip pesan meninggalkan jejak — dibersihkan per permintaan milik tes ini.
    const permintaan = await prisma.customerRequest.findMany({
      where: { storeId: { in: [seededId(storeId), seededId(storeLainId)] } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({ where: { entityType: "CustomerRequest", entityId: { in: seededIds(permintaan.map((p) => p.id)) } } });
    await prisma.customerRequest.deleteMany({ where: { storeId: { in: [seededId(storeId), seededId(storeLainId)] } } });
    await prisma.storeCustomer.deleteMany({ where: { storeId: { in: [seededId(storeId), seededId(storeLainId)] } } });
    await prisma.storeOpname.deleteMany({ where: { storeId: { in: [seededId(storeId), seededId(storeLainId)] } } });
    await prisma.storeStockMovement.deleteMany({ where: { itemId: { in: [seededId(itemId), seededId(item2Id)] } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: [seededId(itemId), seededId(item2Id)] } } });
    await prisma.spgSaleLine.deleteMany({ where: { itemId: { in: [seededId(itemId), seededId(item2Id)] } } });
    await prisma.spgSale.deleteMany({ where: { storeId: { in: [seededId(storeId), seededId(storeLainId)] } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemId), seededId(item2Id)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(storeId), seededId(storeLainId)] } } });
  });

  async function buatPromo(data: { name: string; type: string; value?: number; buyQty?: number; freeQty?: number; minSubtotal?: number; itemIds?: string[] }) {
    const p = await prisma.counterPromo.create({
      data: {
        name: data.name,
        type: data.type,
        value: data.value ?? null,
        buyQty: data.buyQty ?? null,
        freeQty: data.freeQty ?? null,
        minSubtotal: data.minSubtotal ?? null,
        allItems: !data.itemIds,
        allStores: false,
        createdById: salesmanId,
        targets: {
          create: [{ kind: "STORE", refId: storeId }, ...(data.itemIds ?? []).map((refId) => ({ kind: "ITEM", refId }))],
        },
      },
    });
    promoIds.push(p.id);
    return p;
  }

  async function aturManual(nilai: object) {
    await prisma.systemSetting.upsert({
      where: { key: KUNCI_DISKON_MANUAL },
      create: { key: KUNCI_DISKON_MANUAL, value: JSON.stringify(nilai) },
      update: { value: JSON.stringify(nilai) },
    });
  }

  it("applies a counter promo server-side: list price kept, lines and total net", async () => {
    await buatPromo({ name: "Diskon kemeja", type: "PERSEN", value: 20, itemIds: [itemId] });
    const res = await recordSpgSale({
      salesmanId,
      storeId,
      lines: [
        { itemId, variantSku: null, qty: 2 },
        { itemId: item2Id, variantSku: null, qty: 1 },
      ],
    });
    if (!res.ok) throw new Error(res.code);
    expect(res.total).toBe(210_000);
    const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: res.spgSaleId }, include: { lines: true } });
    expect(Number(nota.subtotal)).toBe(250_000);
    expect(Number(nota.discountTotal)).toBe(40_000);
    const kemeja = nota.lines.find((l) => l.itemId === itemId)!;
    expect(Number(kemeja.unitPrice)).toBe(100_000);
    expect(Number(kemeja.lineTotal)).toBe(160_000);
    expect(Number(kemeja.discount)).toBe(40_000);
    expect(kemeja.promoName).toBe("Diskon kemeja");
    expect(nota.lines.reduce((s, l) => s + Number(l.lineTotal), 0)).toBe(Number(nota.total));
    const riwayat = await prisma.salesHistory.findFirstOrThrow({ where: { itemId, orderId: res.docNo } });
    expect(Number(riwayat.lineTotal)).toBe(160_000);
    expect(Number(riwayat.unitPriceAfterDiscount)).toBe(80_000);
  });

  it("freezes the store-borne part of a shared promo on the line", async () => {
    const p = await buatPromo({ name: "Bagi dua", type: "PERSEN", value: 20 });
    await prisma.counterPromo.update({ where: { id: p.id }, data: { storeSharePercent: 50 } });
    const res = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }] });
    if (!res.ok) throw new Error(res.code);
    const baris = await prisma.spgSaleLine.findFirstOrThrow({ where: { spgSaleId: res.spgSaleId } });
    expect(Number(baris.discount)).toBe(20_000);
    expect(Number(baris.storeDiscount)).toBe(10_000);
  });

  it("does not apply a promo scoped to another store", async () => {
    const p = await prisma.counterPromo.create({
      data: { name: "Toko lain", type: "PERSEN", value: 50, allItems: true, allStores: false, createdById: salesmanId, targets: { create: [{ kind: "STORE", refId: storeLainId }] } },
    });
    promoIds.push(p.id);
    const res = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }] });
    expect(res.ok && res.total).toBe(100_000);
  });

  it("refuses a manual discount while it is switched off, and enforces the limit and reason when on", async () => {
    await aturManual({ aktif: false });
    const mati = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], diskonManual: { jenis: "PERSEN", nilai: 5, alasan: "Cacat kecil" } });
    expect(mati).toEqual({ ok: false, code: "DISKON_MANUAL_NONAKTIF" });

    await aturManual({ aktif: true, maksPersen: 10, alasanWajib: true });
    const tanpaAlasan = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], diskonManual: { jenis: "PERSEN", nilai: 5 } });
    expect(tanpaAlasan).toEqual({ ok: false, code: "ALASAN_DISKON_WAJIB" });
    const lewat = await recordSpgSale({
      salesmanId,
      storeId,
      lines: [{ itemId, variantSku: null, qty: 1 }],
      diskonManual: { jenis: "RUPIAH", nilai: 15_000, alasan: "Pelanggan tetap" },
    });
    expect(lewat).toEqual({ ok: false, code: "DISKON_MANUAL_LEWAT_BATAS" });

    const ok = await recordSpgSale({
      salesmanId,
      storeId,
      lines: [{ itemId, variantSku: null, qty: 1 }],
      diskonManual: { jenis: "RUPIAH", nilai: 10_000, alasan: "Pelanggan tetap" },
    });
    if (!ok.ok) throw new Error(ok.code);
    const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: ok.spgSaleId } });
    expect(Number(nota.manualDiscount)).toBe(10_000);
    expect(nota.manualDiscountReason).toBe("Pelanggan tetap");
    expect(Number(nota.total)).toBe(90_000);
  });

  it("records a new shopper once per phone number, only with consent, and only for this store", async () => {
    const tanpaSetuju = await recordSpgSale({
      salesmanId,
      storeId,
      lines: [{ itemId, variantSku: null, qty: 1 }],
      pembeli: { nama: "Bu Ani", hp: "0812-3456-7890", setuju: false },
    });
    expect(tanpaSetuju).toEqual({ ok: false, code: "PELANGGAN_TIDAK_VALID" });

    const a = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], pembeli: { nama: "Bu Ani", hp: "0812-3456-7890", setuju: true } });
    const b = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], pembeli: { nama: "Ani", hp: "+62 812 3456 7890", setuju: true } });
    if (!a.ok || !b.ok) throw new Error("gagal");
    const pelanggan = await prisma.storeCustomer.findMany({ where: { storeId: seededId(storeId) } });
    expect(pelanggan).toHaveLength(1);
    expect(pelanggan[0]).toMatchObject({ name: "Bu Ani", phone: "6281234567890" });
    const nota = await prisma.spgSale.findMany({ where: { id: { in: [a.spgSaleId, b.spgSaleId] } }, select: { customerId: true } });
    expect(nota.every((n) => n.customerId === pelanggan[0].id)).toBe(true);

    const lain = await prisma.storeCustomer.create({
      data: { storeId: storeLainId, name: "Orang lain", phone: "6281111111111", consentAt: new Date(), createdById: salesmanId },
    });
    const curang = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], pembeli: { id: lain.id } });
    expect(curang).toEqual({ ok: false, code: "PELANGGAN_TIDAK_VALID" });
  });

  it("dates an offline sale at its sale time, and refuses one older than 14 days", async () => {
    const sekarang = new Date("2026-10-03T08:00:00Z");
    const waktuJual = new Date("2026-10-02T13:30:00Z");
    const res = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], luring: true, waktuJual, sekarang });
    if (!res.ok) throw new Error(res.code);
    const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: res.spgSaleId } });
    expect(nota.createdAt.toISOString()).toBe(waktuJual.toISOString());
    expect(nota.capturedOffline).toBe(true);
    expect(nota.syncedAt?.toISOString()).toBe(sekarang.toISOString());
    const gerak = await prisma.storeStockMovement.findFirstOrThrow({ where: { refId: res.spgSaleId } });
    expect(gerak.createdAt.toISOString()).toBe(waktuJual.toISOString());

    const tua = await recordSpgSale({
      salesmanId,
      storeId,
      lines: [{ itemId, variantSku: null, qty: 1 }],
      luring: true,
      waktuJual: new Date("2026-09-01T00:00:00Z"),
      sekarang,
    });
    expect(tua).toEqual({ ok: false, code: "WAKTU_TIDAK_VALID" });

    // Tanpa tanda luring, waktu dari HP diabaikan.
    const biasa = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], waktuJual, sekarang });
    if (!biasa.ok) throw new Error(biasa.code);
    const notaBiasa = await prisma.spgSale.findUniqueOrThrow({ where: { id: biasa.spgSaleId } });
    expect(notaBiasa.createdAt.toISOString()).toBe(sekarang.toISOString());
  });

  it("skips the stock book only for items counted in a later store count", async () => {
    // Opname jam 10.00 menghitung kemeja saja; nota tanpa sinyal jam 09.00 menjual kemeja dan celana.
    await prisma.storeOpname.create({
      data: {
        storeId,
        countedById: salesmanId,
        countedAt: new Date("2026-10-03T03:00:00Z"),
        lines: { create: [{ itemId, variantSku: "", productName: "Kemeja", qtySystem: 5, qtyCounted: 4 }] },
      },
    });
    const res = await recordSpgSale({
      salesmanId,
      storeId,
      lines: [
        { itemId, variantSku: null, qty: 1 },
        { itemId: item2Id, variantSku: null, qty: 1 },
      ],
      luring: true,
      waktuJual: new Date("2026-10-03T02:00:00Z"),
      sekarang: new Date("2026-10-03T05:00:00Z"),
    });
    if (!res.ok) throw new Error(res.code);
    const gerak = await prisma.storeStockMovement.findMany({ where: { refId: res.spgSaleId } });
    expect(gerak.map((g) => g.itemId)).toEqual([item2Id]);
    // Notanya sendiri tetap tercatat utuh.
    expect(await prisma.salesHistory.count({ where: { orderId: res.docNo } })).toBe(2);
  });

  it("closes the shopper's open request when the requested item is sold to them", async () => {
    const pelanggan = await prisma.storeCustomer.create({
      data: { storeId, name: "Bu Rina", phone: "6281299999999", consentAt: new Date(), createdById: salesmanId },
    });
    const titip = await prisma.customerRequest.create({
      data: { storeId, customerId: pelanggan.id, itemId, variantSku: "", description: "Kemeja", status: "DIKABARI", createdById: salesmanId },
    });
    const lainnya = await prisma.customerRequest.create({
      data: { storeId, customerId: pelanggan.id, itemId: item2Id, variantSku: "", description: "Celana", createdById: salesmanId },
    });
    const res = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], pembeli: { id: pelanggan.id } });
    if (!res.ok) throw new Error(res.code);
    expect(await prisma.customerRequest.findUniqueOrThrow({ where: { id: titip.id } })).toMatchObject({ status: "SELESAI", spgSaleId: res.spgSaleId });
    expect((await prisma.customerRequest.findUniqueOrThrow({ where: { id: lainnya.id } })).status).toBe("MENUNGGU");
  });

  it("also closes an any-size request and leaves an audit row", async () => {
    const pelanggan = await prisma.storeCustomer.create({
      data: { storeId, name: "Bu Sari", phone: "6281288888888", consentAt: new Date(), createdById: salesmanId },
    });
    const titip = await prisma.customerRequest.create({
      data: { storeId, customerId: pelanggan.id, itemId, variantSku: "", description: "Kemeja ukuran apa saja", createdById: salesmanId },
    });
    const res = await recordSpgSale({ salesmanId, storeId, lines: [{ itemId, variantSku: null, qty: 1 }], pembeli: { id: pelanggan.id } });
    if (!res.ok) throw new Error(res.code);
    expect((await prisma.customerRequest.findUniqueOrThrow({ where: { id: titip.id } })).status).toBe("SELESAI");
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "CustomerRequest", entityId: titip.id } });
    expect(jejak.map((j) => j.action)).toEqual(["CUSTOMER_REQUEST_CLOSED"]);
  });
});
