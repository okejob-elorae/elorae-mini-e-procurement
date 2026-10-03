import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { promoEloraeSiklus } from "./promo-elorae-queries";
import { bukaKunci, kunciAngka } from "./writer";
import { rincianSiklus } from "./queries";

/**
 * Potongan promo yang ditanggung Elorae: dihitung dari nota SPG toko itu di
 * bulan siklus, dibekukan saat mengunci, dikembalikan ke 0 saat kunci dibuka.
 * Terhadap basis data sungguhan; data uji milik tes ini sendiri.
 *
 * Nota Agustus: A 2 potong (potongan 40.000, penuh Elorae) dan B 1 potong
 * (potongan 10.000, dibagi 50:50 → Elorae 5.000), plus baris tanpa potongan.
 * Pembeli mengembalikan 1 A di Agustus (−20.000) dan 1 A lagi di September.
 * Nota Juli (di luar siklus) berpotongan 20.000.
 */

const tag = `PEL${Math.random().toString(36).slice(2, 8)}`;
const pada = (iso: string) => new Date(iso);

let tokoId = "";
let uomId = "";
let barangA = "";
let barangB = "";
let orangId = "";
let siklusId = "";
let jualIds: string[] = [];
let returIds: string[] = [];

beforeEach(async () => {
  tokoId = "";
  uomId = "";
  barangA = "";
  barangB = "";
  orangId = "";
  siklusId = "";
  jualIds = [];
  returIds = [];

  tokoId = (await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", isActive: true } })).id;
  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  barangA = (await prisma.item.create({ data: { sku: `${tag}-A`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId } })).id;
  barangB = (await prisma.item.create({ data: { sku: `${tag}-B`, nameId: `${tag} Rok`, nameEn: `${tag} Skirt`, type: "FINISHED_GOOD", uomId } })).id;
  orangId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.local`, name: `${tag} SPG`, passwordHash: "x" } })).id;
  siklusId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K`, storeId: tokoId, periodYear: 2026, periodMonth: 8 } })).id;

  await nota("J1", "2026-07-20T03:00:00Z", [{ itemId: barangA, qty: 1, discount: 20_000, storeDiscount: 0 }]);
  const agustus = await nota("A1", "2026-08-10T03:00:00Z", [
    { itemId: barangA, qty: 2, discount: 40_000, storeDiscount: 0 },
    { itemId: barangB, qty: 1, discount: 10_000, storeDiscount: 5_000 },
    { itemId: barangB, qty: 1, discount: 0, storeDiscount: 0 },
  ]);
  const barisA = agustus.lines.find((l) => l.itemId === barangA && l.qty === 2)!;
  await retur("R1", agustus.id, "2026-08-15T03:00:00Z", barisA.id, barangA);
  await retur("R2", agustus.id, "2026-09-03T03:00:00Z", barisA.id, barangA);
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityType: "ConsignmentCycle", entityId: seededId(siklusId) } });
  await prisma.spgSaleReturnLine.deleteMany({ where: { returnId: { in: seededIds(returIds) } } });
  await prisma.spgSaleReturn.deleteMany({ where: { id: { in: seededIds(returIds) } } });
  await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(jualIds) } } });
  await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(jualIds) } } });
  await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: seededId(siklusId) } } });
  await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
  await prisma.item.deleteMany({ where: { id: { in: seededIds([barangA, barangB].filter(Boolean)) } } });
  await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
  await prisma.user.deleteMany({ where: { id: seededId(orangId) } });
});

async function nota(no: string, iso: string, baris: { itemId: string; qty: number; discount: number; storeDiscount: number }[]) {
  const s = await prisma.spgSale.create({
    data: {
      docNo: `${tag}/${no}`,
      salesmanId: orangId,
      storeId: tokoId,
      subtotal: 0,
      total: 0,
      cashReceived: 0,
      changeGiven: 0,
      createdById: orangId,
      createdAt: pada(iso),
      lines: {
        create: baris.map((b) => ({ ...b, productName: "uji", unitPrice: 100_000, lineTotal: 100_000 * b.qty - b.discount })),
      },
    },
    select: { id: true, lines: { select: { id: true, itemId: true, qty: true } } },
  });
  jualIds.push(s.id);
  return s;
}

async function retur(no: string, spgSaleId: string, iso: string, spgSaleLineId: string, itemId: string) {
  const r = await prisma.spgSaleReturn.create({
    data: {
      spgSaleId,
      storeId: tokoId,
      createdById: orangId,
      reason: "uji",
      idempotencyKey: `${tag}-${no}`,
      createdAt: pada(iso),
      lines: { create: [{ spgSaleLineId, itemId, qty: 1, condition: "LAYAK" }] },
    },
  });
  returIds.push(r.id);
}

async function keduaLaporan() {
  for (const source of ["SPG", "TOKO"] as const) {
    await prisma.consignmentReport.create({
      data: { cycleId: siklusId, source, reportedAt: new Date(), items: { create: [{ itemId: barangA, itemName: `${tag} Blus`, qty: 1 }] } },
    });
  }
}

const kunci = () =>
  kunciAngka({ cycleId: siklusId, olehUserId: orangId, baris: [{ itemId: barangA, itemName: `${tag} Blus`, qty: 3, price: 70_000 }] });

describe("promoEloraeSiklus (basis data)", () => {
  it("Σ bagian Elorae nota bulan itu, dikurangi potong yang dikembalikan bulan itu", async () => {
    const r = await promoEloraeSiklus(prisma, { storeId: tokoId, periodYear: 2026, periodMonth: 8 });
    expect(r).toEqual({ dariJual: 45_000, dikembalikan: 20_000, total: 25_000 });
  });

  it("retur bulan berikutnya jatuh di bulan returnya, dihitung kumulatif", async () => {
    const r = await promoEloraeSiklus(prisma, { storeId: tokoId, periodYear: 2026, periodMonth: 9 });
    expect(r).toEqual({ dariJual: 0, dikembalikan: 20_000, total: -20_000 });
  });
});

describe("kunciAngka / bukaKunci membekukan potongan promo Elorae", () => {
  it("mengunci membekukan potongan di siklus dan jejaknya; rincian menagih bersih", async () => {
    await keduaLaporan();
    expect(await kunci()).toMatchObject({ ok: true });

    const c = await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } });
    expect(Number(c.promoBorneByElorae)).toBe(25_000);
    expect(Number(c.lossChargedToStore)).toBe(0);

    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ConsignmentCycle", entityId: siklusId, action: "CONSIGNMENT_LOCKED" },
    });
    expect((jejak.changes as { after: { promoBorneByElorae: number } }).after.promoBorneByElorae).toBe(25_000);

    const r = (await rincianSiklus(siklusId))!;
    expect(r.tagihan).toEqual({
      beku: true,
      lakuResmi: 210_000,
      promoElorae: 25_000,
      promoEloraeSekarang: 25_000,
      bebanHilang: 0,
      total: 185_000,
    });
  });

  it("nota yang menyusul sesudah dikunci tidak mengubah angka beku — hanya pembandingnya", async () => {
    await keduaLaporan();
    await kunci();
    await nota("A2", "2026-08-30T03:00:00Z", [{ itemId: barangB, qty: 1, discount: 10_000, storeDiscount: 0 }]);
    const r = (await rincianSiklus(siklusId))!;
    expect(r.tagihan.promoElorae).toBe(25_000);
    expect(r.tagihan.promoEloraeSekarang).toBe(35_000);
  });

  it("membuka kunci mengembalikan potongan ke 0 dan mencatat nilai sebelumnya", async () => {
    await keduaLaporan();
    await kunci();
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: orangId })).toEqual({ ok: true });
    const c = await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } });
    expect(Number(c.promoBorneByElorae)).toBe(0);
    expect(c.lockedAt).toBeNull();
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ConsignmentCycle", entityId: siklusId, action: "CONSIGNMENT_UNLOCKED" },
    });
    expect(jejak.changes).toMatchObject({ before: { promoBorneByElorae: 25_000 }, after: { promoBorneByElorae: 0 } });

    // Belum dikunci: rincian menampilkan potongan yang dihitung langsung, tanpa total tagihan.
    const r = (await rincianSiklus(siklusId))!;
    expect(r.tagihan).toMatchObject({ beku: false, lakuResmi: null, promoElorae: 25_000, total: null });
  });

  it("aturan lama tetap: kunci butuh kedua laporan, buka kunci ditolak setelah gaji dibayar", async () => {
    expect(await kunci()).toEqual({ ok: false, alasan: "LAPORAN_BELUM_LENGKAP" });
    expect(Number((await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } })).promoBorneByElorae)).toBe(0);

    await keduaLaporan();
    await kunci();
    await prisma.consignmentCommission.create({
      data: { cycleId: siklusId, spgUserId: orangId, baseSalary: 0, commission: 0, total: 0, paidAt: new Date() },
    });
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: orangId })).toEqual({ ok: false, alasan: "ADA_GAJI_SUDAH_DIBAYAR" });
    expect(Number((await prisma.consignmentCycle.findUniqueOrThrow({ where: { id: siklusId } })).promoBorneByElorae)).toBe(25_000);
  });
});
