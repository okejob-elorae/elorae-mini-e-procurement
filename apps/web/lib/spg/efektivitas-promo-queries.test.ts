import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ENTITAS_PROMO_KONTER, JEJAK_PROMO_KONTER } from "./promo-konter-kantor";
import { daftarEfektivitasPromo, hasilEfektivitasPromo } from "./efektivitas-promo-queries";
import { recordSpgSale } from "./sale-writer";

/**
 * Efektivitas promo konter di basis data sungguhan. Nota dibuat lewat penulis
 * nota (jadi rincian `SpgSalePromo` asli) pada jam yang ditetapkan tes (2003),
 * jauh dari data pengembangan. Promo uji hanya untuk toko uji, prioritas
 * tertinggi; semua baris uji dihapus lewat id yang dicatat.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const wib = (s: string) => new Date(`${s}+07:00`);

d("efektivitas promo konter (test bed only)", () => {
  const tag = `EFP-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let kategoriId = "";
  let kaosId = "";
  let celanaId = "";
  let spgId = "";
  let tokoA = "";
  let tokoB = "";
  let tokoC = "";
  let promoId = "";
  let nomor: string[] = [];
  let nota: Record<string, string> = {};

  const nomorBaru = () => {
    const n = `62813${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    nomor.push(n);
    return n;
  };

  const jual = async (
    kunci: string,
    storeId: string,
    waktu: string,
    lines: { itemId: string; qty: number }[],
    hp?: string,
  ) => {
    const r = await recordSpgSale({
      salesmanId: spgId,
      storeId,
      lines: lines.map((l) => ({ ...l, variantSku: null })),
      pembeli: hp ? { nama: `Pembeli ${tag}`, hp: `0${hp.slice(2)}`, setuju: true } : null,
      idempotencyKey: `${tag}-${kunci}`,
      sekarang: wib(waktu),
    });
    if (!r.ok) throw new Error(`nota ${kunci} gagal: ${r.code}`);
    nota[kunci] = r.spgSaleId;
    return r;
  };

  beforeEach(async () => {
    uomId = "";
    kategoriId = "";
    kaosId = "";
    celanaId = "";
    tokoA = "";
    tokoB = "";
    tokoC = "";
    promoId = "";
    nomor = [];
    nota = {};
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriId = (await prisma.itemCategory.create({ data: { name: `Kaos ${tag}` } })).id;
    kaosId = (
      await prisma.item.create({
        data: { sku: `${tag}-K`, nameId: "Kaos Uji", nameEn: "Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 120_000, categoryId: kategoriId },
      })
    ).id;
    celanaId = (
      await prisma.item.create({ data: { sku: `${tag}-C`, nameId: "Celana Uji", nameEn: "Pants", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 180_000 } })
    ).id;
    spgId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    tokoA = (await prisma.store.create({ data: { code: `${tag}-A`, name: `Toko A ${tag}`, address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
    tokoB = (
      await prisma.store.create({ data: { code: `${tag}-B`, name: `Toko B ${tag}`, address: "Jl. Uji", termsType: "KONSI", marginPercent: 25, isActive: true } })
    ).id;
    tokoC = (await prisma.store.create({ data: { code: `${tag}-C`, name: `Toko C ${tag}`, address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
    promoId = (
      await prisma.counterPromo.create({
        data: {
          name: `Diskon kaos ${tag}`,
          type: "PERSEN",
          value: 10,
          allItems: false,
          allStores: false,
          priority: 1000,
          storeSharePercent: 50,
          startsAt: wib("2003-03-11T00:00:00"),
          endsAt: wib("2003-03-15T23:59:59.999"),
          createdById: spgId,
          createdAt: wib("2003-03-01T00:00:00"),
          targets: {
            create: [
              { kind: "STORE", refId: tokoA },
              { kind: "STORE", refId: tokoB },
              { kind: "CATEGORY", refId: kategoriId },
            ],
          },
        },
      })
    ).id;
  });

  afterEach(async () => {
    const toko = [seededId(tokoA), seededId(tokoB), seededId(tokoC)];
    const notaIds = (await prisma.spgSale.findMany({ where: { storeId: { in: seededIds(toko) } }, select: { id: true } })).map((n) => n.id);
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: seededIds(notaIds) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds(toko) } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(celanaId)] } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(notaIds) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
    await prisma.storeCustomer.deleteMany({ where: { storeId: { in: seededIds(toko) } } });
    await prisma.member.deleteMany({ where: { phone: { in: seededIds(nomor) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: String(ENTITAS_PROMO_KONTER), entityId: seededId(promoId) } });
    await prisma.counterPromoTarget.deleteMany({ where: { promoId: seededId(promoId) } });
    await prisma.counterPromo.deleteMany({ where: { id: seededId(promoId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(kaosId), seededId(celanaId)] } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(kategoriId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(toko) } } });
  });

  /**
   * Pembanding 6–10 Mar, promo 11–15 Mar 2003 (5 hari).
   *   pembanding: A kaos 1 (H1) 120 rb; B kaos 1 @160 rb (konsi, margin 25%).
   *   promo: A kaos 3 (1 kemudian diretur) + celana 1, H1; B kaos 1, H2 (member);
   *          A celana saja tanpa pembeli; C (bukan sasaran) kaos 3;
   *          A kaos 1 yang rinciannya dihapus = "nota lama".
   *   sesudah: H2 belanja lagi di A, 20 Mar.
   */
  async function skenario() {
    const h1 = nomorBaru();
    const h2 = nomorBaru();
    await jual("b1", tokoA, "2003-03-07T10:00:00", [{ itemId: kaosId, qty: 1 }], h1);
    await jual("b2", tokoB, "2003-03-09T10:00:00", [{ itemId: kaosId, qty: 1 }]);
    await jual("w3", tokoA, "2003-03-11T10:00:00", [{ itemId: kaosId, qty: 3 }, { itemId: celanaId, qty: 1 }], h1);
    await prisma.member.create({ data: { phone: h2, name: `Member ${tag}`, consentAt: wib("2003-03-12T09:00:00"), joinedStoreId: tokoB, joinedById: spgId } });
    await jual("w4", tokoB, "2003-03-12T10:00:00", [{ itemId: kaosId, qty: 1 }], h2);
    await jual("w5", tokoA, "2003-03-13T10:00:00", [{ itemId: celanaId, qty: 1 }]);
    await jual("w6", tokoC, "2003-03-12T10:00:00", [{ itemId: kaosId, qty: 3 }]);
    await jual("w8", tokoA, "2003-03-14T10:00:00", [{ itemId: kaosId, qty: 1 }]);
    await jual("s7", tokoA, "2003-03-20T10:00:00", [{ itemId: celanaId, qty: 1 }], h2);
    // Retur pembeli 1 kaos dari nota w3; nota w8 dijadikan nota lama (tanpa rincian).
    await prisma.spgSaleLine.updateMany({ where: { spgSaleId: seededId(nota.w3), itemId: seededId(kaosId) }, data: { returnedQty: 1 } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: seededId(nota.w8) } });
  }

  it("the writer recorded the promo detail rows the report is built on", async () => {
    await skenario();
    const r = await prisma.spgSalePromo.findMany({ where: { spgSaleId: { in: seededIds([nota.w3, nota.w4]) } }, orderBy: { discount: "desc" } });
    // Bagian toko juga dicatat di toko putus (50%), tapi di sana tidak berarti apa-apa —
    // laporan membaginya hanya untuk toko konsinyasi.
    expect(r.map((x) => [x.promoId, x.kind, x.qty, Number(x.discount), Number(x.storeDiscount)])).toEqual([
      [promoId, "BARANG", 3, 36_000, 18_000],
      [promoId, "BARANG", 1, 16_000, 8_000],
    ]);
    expect(await prisma.spgSalePromo.count({ where: { spgSaleId: seededId(nota.b1) } })).toBe(0);
  });

  it("compares target-item sales at target stores during the promo with the equal period before", async () => {
    await skenario();
    const h = await hasilEfektivitasPromo(promoId, { sekarang: wib("2003-05-01T12:00:00") });
    expect(h?.hasil).not.toBeNull();
    const x = h!.hasil!;
    expect(x.hari).toBe(5);
    expect(x.promo).toEqual({ mulai: wib("2003-03-11T00:00:00").toISOString(), akhir: wib("2003-03-16T00:00:00").toISOString() });
    expect(x.pembanding).toEqual({ mulai: wib("2003-03-06T00:00:00").toISOString(), akhir: wib("2003-03-11T00:00:00").toISOString() });
    expect(x.pemakaian).toEqual({ nota: 2, pcs: 4, potongan: 52_000, konsi: { potongan: 16_000, toko: 8_000, elorae: 8_000 }, putus: { potongan: 36_000 } });
    expect(x.notaLama).toBe(1);
    // W: A kaos 2 net (324 rb × 2/3) + A kaos 1 nota lama (108 rb) + B kaos 1 (144 rb). B: 120 rb + 160 rb.
    expect(x.penjualan.pcs).toEqual({ promo: 4, pembanding: 2, selisih: 2, persen: 100 });
    expect(x.penjualan.rupiah).toEqual({ promo: 468_000, pembanding: 280_000, selisih: 188_000, persen: 67.1 });
    expect(x.penjualan.nota).toEqual({ promo: 3, pembanding: 2, selisih: 1, persen: 50 });
    expect(x.biaya).toBe(0.2766);
    expect(x.keranjang).toEqual({
      dengan: { nota: 2, rataRata: 270_000 },
      tanpa: { nota: 1, rataRata: 180_000 },
      selisih: 90_000,
      persen: 50,
      dikecualikan: 1,
    });
    expect(x.pelanggan).toEqual({
      notaPromo: 2,
      notaTercatat: 2,
      cakupan: 100,
      pembeli: 2,
      baru: 1,
      member: 1,
      kembali: { dinilai: true, pembeli: 1, persen: 50, sampai: wib("2003-04-15T00:00:00").toISOString() },
    });
    expect(x.harian.map((t) => [t.tanggalPromo, t.promo, t.tanggalPembanding, t.pembanding])).toEqual([
      ["2003-03-11", 2, "2003-03-06", 0],
      ["2003-03-12", 1, "2003-03-07", 1],
      ["2003-03-13", 0, "2003-03-08", 0],
      ["2003-03-14", 1, "2003-03-09", 1],
      ["2003-03-15", 0, "2003-03-10", 0],
    ]);
    expect(x.perToko.map((t) => [t.storeId, t.termsType, t.pemakaian.potongan, t.penjualan.rupiah.promo, t.penjualan.rupiah.pembanding, t.penjualan.rupiah.persen])).toEqual([
      [tokoA, "PUTUS", 36_000, 324_000, 120_000, 170],
      [tokoB, "KONSI", 16_000, 144_000, 160_000, -10],
    ]);
  });

  it("return purchases are not judged until 30 days after the promo; the list row matches the result page", async () => {
    await skenario();
    const awal = await hasilEfektivitasPromo(promoId, { sekarang: wib("2003-04-01T12:00:00") });
    expect(awal!.hasil!.pelanggan.kembali).toEqual({ dinilai: false, sejak: wib("2003-04-15T00:00:00").toISOString(), masihBerjalan: false });
    const daftar = await daftarEfektivitasPromo(
      { dari: wib("2003-03-01T00:00:00"), sampai: wib("2003-03-31T23:59:59.999") },
      { sekarang: wib("2003-05-01T12:00:00"), promoIds: [promoId] },
    );
    expect(daftar.baris).toHaveLength(1);
    expect(daftar.baris[0]).toMatchObject({ id: promoId, status: "BERAKHIR", hari: 5, notaLama: 1, biaya: 0.2766, dipotongRentang: false });
    expect(daftar.baris[0].pemakaian.potongan).toBe(52_000);
    expect(daftar.baris[0].penjualan.rupiah.persen).toBe(67.1);
  });

  it("a range clips the promo period; the baseline stays right before the promo started", async () => {
    await skenario();
    const daftar = await daftarEfektivitasPromo(
      { dari: wib("2003-03-13T00:00:00"), sampai: wib("2003-03-31T23:59:59.999") },
      { sekarang: wib("2003-05-01T12:00:00"), promoIds: [promoId] },
    );
    const b = daftar.baris[0];
    expect(b).toMatchObject({ hari: 3, dipotongRentang: true, notaLama: 1 });
    expect(b.pemakaian.nota).toBe(0);
    // W 13–15 Mar: kaos nota lama 108 rb. B 8–10 Mar: B kaos 160 rb.
    expect(b.penjualan.rupiah).toEqual({ promo: 108_000, pembanding: 160_000, selisih: -52_000, persen: -32.5 });
    expect(b.biaya).toBeNull();
    // Rentang yang sama sekali di luar promo: tidak terdaftar.
    const luar = await daftarEfektivitasPromo({ dari: wib("2003-04-01T00:00:00"), sampai: wib("2003-04-30T23:59:59.999") }, { sekarang: wib("2003-05-01T12:00:00"), promoIds: [promoId] });
    expect(luar.baris).toHaveLength(0);
  });

  it("a promo switched off early stops at the recorded switch-off time", async () => {
    await skenario();
    await prisma.counterPromo.update({ where: { id: promoId }, data: { isActive: false } });
    await prisma.auditLog.create({
      data: { userId: spgId, action: JEJAK_PROMO_KONTER.DIMATIKAN, entityType: ENTITAS_PROMO_KONTER, entityId: promoId, createdAt: wib("2003-03-13T00:00:00") },
    });
    const h = await hasilEfektivitasPromo(promoId, { sekarang: wib("2003-05-01T12:00:00") });
    expect(h!.promo.status).toBe("NONAKTIF");
    expect(h!.hasil).toMatchObject({ hari: 2, berhentiDimatikan: true, akhirDariPerubahan: false });
    expect(h!.hasil!.pemakaian.nota).toBe(2);
  });

  it("a promo that has not started yet has no result", async () => {
    const h = await hasilEfektivitasPromo(promoId, { sekarang: wib("2003-03-05T12:00:00") });
    expect(h?.hasil).toBeNull();
    expect(await hasilEfektivitasPromo("tidak-ada")).toBeNull();
  });
});
