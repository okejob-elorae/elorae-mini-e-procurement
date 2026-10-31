import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bayarKomisi, bukaKunci, kunciAngka } from "@/lib/konsinyasi/writer";
import { rincianSiklus } from "@/lib/konsinyasi/queries";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { payloadGajiHp } from "./komisi-hp";
import { daftarKomisiKantor } from "./komisi-queries";
import { kalimatKomisi, tandaiKomisiDibayar, tetapkanKomisiToko } from "./komisi-writer";
import { KUNCI_BARANG_HILANG, KUNCI_KOMISI_PUTUS } from "./pengaturan";
import { gajiKomisiSpg, tokoSpg } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Beban barang hilang yang ditetapkan ke SPG dipotong dari komisinya — di toko
 * putus saat komisi DITETAPKAN, di toko konsinyasi saat siklus DIKUNCI — paling
 * banyak `maksPotongPersen` dari pembayaran itu. Menetapkan ulang / membuka
 * kunci melepas potongan lalu memotong lagi, jadi angkanya stabil dan sisa
 * beban tidak pernah terpotong dua kali. Basis data sungguhan; semua baris
 * diseed di sini dan dihapus lewat `seededId(s)`.
 */
d("potongan barang hilang dari komisi SPG (test bed only)", () => {
  const tag = `KPH${Math.random().toString(36).slice(2, 8)}`;
  const PERIODE = "2026-08";
  let uomId = "";
  let kaos = "";
  let putus = "";
  let konsi = "";
  let spgA = "";
  let spgB = "";
  let spgK = "";
  let kantor = "";
  let siklusId = "";
  const nota: string[] = [];
  const beban: string[] = [];
  const setelanAwal = new Map<string, string | null>();
  let nomor = 0;

  const tokoIds = () => seededIds([putus, konsi].filter(Boolean));

  async function setel(key: string, nilai: Record<string, unknown>) {
    const v = JSON.stringify(nilai);
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  beforeAll(async () => {
    for (const key of [KUNCI_KOMISI_PUTUS, KUNCI_BARANG_HILANG]) {
      const ada = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
      setelanAwal.set(key, ada?.value ?? null);
    }
    await setel(KUNCI_KOMISI_PUTUS, { aktif: true, dasar: "PER_SPG" });
    await setel(KUNCI_BARANG_HILANG, { dasarNilai: "HARGA_ELORAE", maksPotongPersen: 50, dariOpname: false });

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, sellingPrice: 50_000, commissionPerPcs: 2_000 },
      })
    ).id;
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType } })).id;
    putus = await toko("PUTUS", "PUTUS");
    konsi = await toko("KONSI", "KONSI");
    const orang = async (nama: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`.toLowerCase(), name: `${nama} ${tag}`, assignedStoreId: storeId } })).id;
    spgA = await orang("Ani", putus);
    spgB = await orang("Budi", putus);
    spgK = await orang("Kirana", konsi);
    kantor = await orang("Kantor", null);
  });

  afterEach(async () => {
    // Jejak komisi SPG (termasuk baris yang sudah dihapus saat ditetapkan ulang) dikenali dari tokonya.
    const audit = await prisma.auditLog.findMany({ where: { entityType: "SpgCommission" }, select: { id: true, metadata: true } });
    const milikUji = audit
      .filter((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return typeof m?.storeId === "string" && tokoIds().includes(m.storeId);
      })
      .map((a) => a.id);
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.spgCommission.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(nota) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    nota.length = 0;

    if (siklusId) {
      const gaji = await prisma.consignmentCommission.findMany({ where: { cycleId: seededId(siklusId) }, select: { id: true } });
      await prisma.auditLog.deleteMany({ where: { entityType: "ConsignmentCommission", entityId: { in: seededIds(gaji.map((g) => g.id)) } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "ConsignmentCycle", entityId: seededId(siklusId) } });
      await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: seededId(siklusId) } } });
      await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklusId) } });
      await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
      await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklusId) } });
      await prisma.consignmentCycle.delete({ where: { id: seededId(siklusId) } });
      siklusId = "";
    }

    if (beban.length) {
      const bagian = await prisma.stockLossShare.findMany({ where: { lossId: { in: seededIds(beban) } }, select: { id: true } });
      await prisma.stockLossDeduction.deleteMany({ where: { shareId: { in: seededIds(bagian.map((b) => b.id)) } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "StockLoss", entityId: { in: seededIds(beban) } } });
      await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(beban) } } });
      beban.length = 0;
    }
    await prisma.user.update({ where: { id: seededId(spgB) }, data: { assignedStoreId: putus } });
  });

  afterAll(async () => {
    for (const [key, nilai] of setelanAwal) {
      if (nilai === null) await prisma.systemSetting.deleteMany({ where: { key: seededId(key) } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: nilai } });
    }
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgB, spgK, kantor].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    if (kaos) await prisma.item.delete({ where: { id: seededId(kaos) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  async function jual(salesmanId: string, storeId: string, qty: number) {
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-${nomor++}`,
        salesmanId,
        storeId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: salesmanId,
        createdAt: new Date("2026-08-12T10:00:00+07:00"),
        lines: { create: [{ itemId: kaos, productName: "uji", qty, unitPrice: 50_000, lineTotal: 50_000 * qty }] },
      },
      select: { id: true },
    });
    nota.push(s.id);
    return s.id;
  }

  /** Beban yang sudah diputuskan kantor: seluruhnya bagian satu SPG. */
  async function bebankan(userId: string, amount: number) {
    const l = await prisma.stockLoss.create({
      data: {
        storeId: putus,
        source: "MANUAL",
        totalQty: 1,
        totalAmount: amount,
        valueBasis: "HARGA_ELORAE",
        status: "DITETAPKAN",
        decidedById: kantor,
        decidedAt: new Date("2026-07-20T10:00:00+07:00"),
        createdById: kantor,
        shares: { create: [{ bearer: "SPG", bearerUserId: userId, amount }] },
      },
      select: { id: true },
    });
    beban.push(l.id);
    return l.id;
  }

  const bagianDari = async (lossId: string) => {
    const b = await prisma.stockLossShare.findFirstOrThrow({ where: { lossId }, select: { settledAmount: true, settledAt: true } });
    return { dipotong: Number(b.settledAmount), lunas: b.settledAt !== null };
  };
  const potonganRef = (refType: string, refId: string) => prisma.stockLossDeduction.findMany({ where: { refType, refId }, select: { amount: true } });
  const sekarang = new Date("2026-09-05T10:00:00+07:00");

  it("toko putus: dipotong saat ditetapkan (batas 50%), stabil saat ditetapkan ulang, tampil di kantor dan HP, dibayar bersih", async () => {
    await jual(spgA, putus, 4); // komisi 8.000
    const loss = await bebankan(spgA, 5_000);

    const r1 = await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor, sekarang });
    expect(r1.ok).toBe(true);
    const baris = await prisma.spgCommission.findUniqueOrThrow({
      where: { userId_storeId_period: { userId: spgA, storeId: putus, period: PERIODE } },
      select: { id: true, commission: true, deduction: true },
    });
    expect([Number(baris.commission), Number(baris.deduction)]).toEqual([8_000, 4_000]);
    expect(await bagianDari(loss)).toEqual({ dipotong: 4_000, lunas: false });

    // Ditetapkan ulang: potongan lama dilepas lalu dipotong lagi — satu catatan, angka sama.
    const r2 = await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor, sekarang });
    expect(r2.ok).toBe(true);
    expect((await potonganRef(REF_KOMISI_SPG_PUTUS, baris.id)).map((p) => Number(p.amount))).toEqual([4_000]);
    expect(await bagianDari(loss)).toEqual({ dipotong: 4_000, lunas: false });

    const kantorList = await daftarKomisiKantor(PERIODE, sekarang);
    const tokoUji = kantorList.toko.find((t) => t.storeId === putus)!;
    const ani = tokoUji.baris.find((b) => b.userId === spgA)!;
    expect(ani.resmi?.commission).toBe(8_000);
    expect(ani.resmi?.deduction).toBe(4_000);
    expect(ani.bebanHilangSisa).toBe(1_000);
    // Komisi kotor yang dibandingkan, jadi potongan tidak membuat hitungan tampak berbeda.
    expect(tokoUji.berbeda).toBe(false);

    const toko = await tokoSpg(spgA);
    const hp = payloadGajiHp(await gajiKomisiSpg(spgA, toko, sekarang), false, { bulan: (p) => p, tanggal: (i) => i });
    const resmiHp = hp.resmi.find((r) => r.jenis === "PUTUS")!;
    expect([resmiHp.total, resmiHp.potonganHilang, resmiHp.diterima]).toEqual([8_000, 4_000, 4_000]);

    const bayar = await tandaiKomisiDibayar({ commissionId: baris.id, olehUserId: kantor });
    expect(bayar.ok).toBe(true);
    const jejakBayar = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "SpgCommission", entityId: baris.id, action: "SPG_COMMISSION_PAID" },
      select: { metadata: true },
    });
    expect((jejakBayar.metadata as Record<string, unknown>).deduction).toBe(4_000);
    // Sudah dibayar: tidak bisa ditetapkan ulang, jadi potongannya tidak pernah dilepas lagi.
    expect(await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor, sekarang })).toEqual({ ok: false, code: "SUDAH_DIBAYAR" });
    expect(await bagianDari(loss)).toEqual({ dipotong: 4_000, lunas: false });
  });

  it("toko putus: baris yang dihapus saat ditetapkan ulang mengembalikan potongannya ke sisa beban", async () => {
    await jual(spgA, putus, 2);
    const notaB = await jual(spgB, putus, 3); // komisi 6.000
    const lossB = await bebankan(spgB, 2_000);

    expect((await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor, sekarang })).ok).toBe(true);
    const barisB = await prisma.spgCommission.findUniqueOrThrow({
      where: { userId_storeId_period: { userId: spgB, storeId: putus, period: PERIODE } },
      select: { id: true, deduction: true },
    });
    expect(Number(barisB.deduction)).toBe(2_000);
    expect(await bagianDari(lossB)).toEqual({ dipotong: 2_000, lunas: true });

    // Budi dilepas dari toko dan notanya tidak dihitung lagi → barisnya dihapus.
    await prisma.user.update({ where: { id: spgB }, data: { assignedStoreId: null } });
    await prisma.spgSale.delete({ where: { id: notaB } });
    nota.splice(nota.indexOf(notaB), 1);
    const r = await tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor, sekarang });
    expect(r).toMatchObject({ ok: true, dihapus: 1 });
    expect(await prisma.spgCommission.findUnique({ where: { id: barisB.id } })).toBeNull();
    expect(await potonganRef(REF_KOMISI_SPG_PUTUS, barisB.id)).toEqual([]);
    expect(await bagianDari(lossB)).toEqual({ dipotong: 0, lunas: false });
  });

  it("konsinyasi: dipotong dari gaji + komisi saat dikunci, dilepas saat kunci dibuka, dipotong lagi saat dikunci ulang", async () => {
    siklusId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K`, storeId: konsi, periodYear: 2026, periodMonth: 8 } })).id;
    for (const source of ["SPG", "TOKO"] as const) {
      await prisma.consignmentReport.create({
        data: { cycleId: siklusId, source, reportedAt: new Date(), items: { create: [{ itemId: kaos, itemName: `Kaos ${tag}`, qty: 10 }] } },
      });
    }
    const loss = await bebankan(spgK, 10_000);
    const kunci = () =>
      kunciAngka({ cycleId: siklusId, olehUserId: kantor, gajiPokokPerSpg: 30_000, baris: [{ itemId: kaos, itemName: `Kaos ${tag}`, qty: 10, price: 50_000 }] });

    expect(await kunci()).toMatchObject({ ok: true, totalKomisi: 20_000 });
    const gaji = await prisma.consignmentCommission.findUniqueOrThrow({
      where: { cycleId_spgUserId: { cycleId: siklusId, spgUserId: spgK } },
      select: { id: true, total: true, deduction: true },
    });
    // Gaji 30.000 + komisi 20.000 = 50.000; batas 25.000, beban 10.000 → terpotong penuh.
    expect([Number(gaji.total), Number(gaji.deduction)]).toEqual([50_000, 10_000]);
    expect(await bagianDari(loss)).toEqual({ dipotong: 10_000, lunas: true });
    expect((await prisma.stockLoss.findUniqueOrThrow({ where: { id: loss }, select: { status: true } })).status).toBe("SELESAI");

    const rincian = await rincianSiklus(siklusId);
    expect(rincian?.komisi.find((k) => k.id === gaji.id)?.potonganHilang).toBe(10_000);

    expect((await bukaKunci({ cycleId: siklusId, olehUserId: kantor })).ok).toBe(true);
    expect(Number((await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: gaji.id }, select: { deduction: true } })).deduction)).toBe(0);
    expect(await potonganRef(REF_KOMISI_KONSI, gaji.id)).toEqual([]);
    expect(await bagianDari(loss)).toEqual({ dipotong: 0, lunas: false });
    expect((await prisma.stockLoss.findUniqueOrThrow({ where: { id: loss }, select: { status: true } })).status).toBe("DITETAPKAN");

    expect((await kunci()).ok).toBe(true);
    expect(Number((await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: gaji.id }, select: { deduction: true } })).deduction)).toBe(10_000);
    expect((await potonganRef(REF_KOMISI_KONSI, gaji.id)).map((p) => Number(p.amount))).toEqual([10_000]);

    expect((await bayarKomisi({ commissionId: gaji.id, olehUserId: kantor })).ok).toBe(true);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "ConsignmentCommission", entityId: gaji.id }, select: { metadata: true } });
    expect(jejak.metadata).toMatchObject({ total: 50_000, potonganHilang: 10_000, dibayar: 40_000 });
    // Sudah ada gaji dibayar: kunci tidak bisa dibuka, potongan tidak pernah dilepas.
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: kantor })).toMatchObject({ ok: false, alasan: "ADA_GAJI_SUDAH_DIBAYAR" });
  });

  it("kalimat kabar menyebut potongan dan yang diterima", () => {
    const rata = (x: string) => x.replace(/\s/g, " ");
    expect(rata(kalimatKomisi(8_000, 0))).toBe("komisi Anda Rp 8.000.");
    expect(rata(kalimatKomisi(8_000, 4_000))).toContain("dipotong beban barang hilang Rp 4.000 — diterima Rp 4.000");
  });
});
