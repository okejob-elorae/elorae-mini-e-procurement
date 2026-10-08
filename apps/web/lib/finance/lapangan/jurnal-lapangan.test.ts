import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";

/*
 * Jurnal penjualan lapangan & piutang toko terhadap basis data sungguhan, lewat
 * PENULIS MODUL PIUTANG YANG ASLI (BKM, verifikasi, hitungan gudang, beban,
 * pembatalan). Yang ditiru hanya tiga pembaca konfigurasi bersama supaya tes
 * tidak menyentuh pengaturan dev: pemetaan akun (ke akun uji milik tes ini),
 * tanggal mulai buku besar, dan pengaturan PPN. Basis data dipakai bersama:
 * pengguna dan satuan DIPINJAM, setiap penghapusan lewat `seededId()`.
 *
 * Yang dibuktikan: setelah setiap langkah, saldo AR_STORE per toko di buku besar
 * = Σ sisa piutang modul − kredit retur yang belum dipotong (rekonsiliasi = 0).
 */

const h = vi.hoisted(() => ({
  akun: new Map<string, string>(),
  mulai: new Date("2026-01-01T00:00:00+07:00") as Date | null,
  ppn: null as unknown as PengaturanPpn,
}));

vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      const id = h.akun.get(role);
      if (!id) throw new m.UnmappedRoleError(role);
      return id;
    }),
  };
});
vi.mock("@/lib/finance/sales/sweep", async (asli) => ({
  ...(await asli<typeof import("@/lib/finance/sales/sweep")>()),
  readGlCutover: vi.fn(async () => h.mulai),
}));
vi.mock("@/lib/finance/pajak/ppn-pengaturan", () => ({ bacaPengaturanPpn: vi.fn(async () => h.ppn) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn(async () => undefined) }));

import { buatKlaimPembayaran } from "@/lib/receivables/claim-writer";
import { batalkanKlaim, putuskanKlaim } from "@/lib/receivables/writer";
import { catatHitunganGudang, putuskanBeban } from "@/lib/receivables/return-writer";
import { SUMBER_LAPANGAN } from "./aturan";
import { kunciStokPengiriman, postJurnalNota, postJurnalTukar, selaraskanJurnalKlaim, selaraskanJurnalRetur } from "./jurnal";
import { kaitKlaimBerubah, kaitReturBerubah } from "./kait";
import { postingJurnalLapanganAman } from "./tertunda";
import { rekonsiliasiPiutangToko } from "./rekonsiliasi-queries";
import { selaraskanJurnalToko } from "./selaraskan-toko";
import { cariKlaimTanpaJurnal, cariNotaTanpaJurnal, cariReturTanpaJurnal, cariTukarTanpaJurnal } from "./sapuan";

// Kait pasca-commit dimatikan di bawah vitest kecuali dinyalakan (lihat `kait.ts`); tes ini memang menguji kaitnya.
process.env.JURNAL_LAPANGAN_KAIT_UJI = "1";

const tag = `UJC1-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);
const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: null };

const PERAN_UJI: Array<[string, "ASET" | "LIABILITAS" | "PENDAPATAN" | "HPP" | "BEBAN"]> = [
  ["AR_STORE", "ASET"],
  ["SALES_REVENUE", "PENDAPATAN"],
  ["PPN_KELUARAN", "LIABILITAS"],
  ["COGS", "HPP"],
  ["INVENTORY_FG", "ASET"],
  ["INVENTORY", "ASET"],
  ["INVENTORY_DAMAGED", "ASET"],
  ["BANK", "ASET"],
  ["CASH", "ASET"],
  ["SALES_DISCOUNT", "PENDAPATAN"],
  ["PPH23_PREPAID", "ASET"],
  ["SALES_RETURN", "PENDAPATAN"],
  ["LOSS_EXPENSE", "BEBAN"],
];

let akunIds: string[] = [];
let salesId = "";
let keuanganId = "";
let gudangId = "";
let uomId = "";

let tokoId = "";
let barangId = "";
let orderIds: string[] = [];
let deliveryIds: string[] = [];
let adjIds: string[] = [];
let nrtIds: string[] = [];
let nriIds: string[] = [];
let tukarIds: string[] = [];
let invIds: string[] = [];
let urut = 0;
let mulaiTes = new Date();

beforeAll(async () => {
  akunIds = [];
  h.akun.clear();
  for (const [role, type] of PERAN_UJI) {
    const a = await prisma.chartAccount.create({ data: { code: `${tag}-${role}`, name: `${tag} ${role}`, type, depth: 1 } });
    akunIds.push(a.id);
    h.akun.set(role, a.id);
  }
  const orang = await prisma.user.findMany({ select: { id: true }, take: 3, orderBy: { createdAt: "asc" } });
  if (orang.length < 3) throw new Error("Basis data uji butuh tiga pengguna");
  [salesId, keuanganId, gudangId] = orang.map((o) => o.id);
  const uom = await prisma.uOM.findFirst({ select: { id: true } });
  if (!uom) throw new Error("Basis data uji butuh satu satuan");
  uomId = uom.id;
});

afterAll(async () => {
  if (akunIds.length) {
    const jurnal = await prisma.journalLine.findMany({ where: { chartAccountId: { in: seededIds(akunIds) } }, select: { journalId: true } });
    if (jurnal.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds([...new Set(jurnal.map((j) => j.journalId))]) } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
  }
});

beforeEach(async () => {
  tokoId = "";
  barangId = "";
  orderIds = [];
  deliveryIds = [];
  adjIds = [];
  nrtIds = [];
  nriIds = [];
  tukarIds = [];
  invIds = [];
  mulaiTes = new Date(Date.now() - 1000);
  h.mulai = wib("2026-01-01");
  h.ppn = NON_PKP;
  urut += 1;
  tokoId = (await prisma.store.create({ data: { code: `${tag}-T${urut}`, name: `${tag} Toko ${urut}`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
  barangId = (
    await prisma.item.create({ data: { sku: `${tag}-SKU-${urut}`, nameId: `${tag} Kaos`, nameEn: `${tag} Tee`, type: "FINISHED_GOOD", uomId } })
  ).id;
});

afterEach(async () => {
  // Jurnal yang memakai akun uji (semua jurnal tes ini).
  if (akunIds.length) {
    const jurnal = await prisma.journalLine.findMany({ where: { chartAccountId: { in: seededIds(akunIds) } }, select: { journalId: true } });
    if (jurnal.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds([...new Set(jurnal.map((j) => j.journalId))]) } } });
  }
  const klaim = tokoId ? await prisma.paymentClaim.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } }) : [];
  const piutang = tokoId ? await prisma.receivable.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } }) : [];
  const nriToko = tokoId ? await prisma.warehouseReturn.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } }) : [];
  const semuaNri = [...new Set([...nriIds, ...nriToko.map((n) => n.id)])];
  const beban = nrtIds.length ? await prisma.returnCharge.findMany({ where: { storeReturnId: { in: seededIds(nrtIds) } }, select: { id: true } }) : [];
  const entitas = [...klaim.map((k) => k.id), ...piutang.map((p) => p.id), ...semuaNri, ...nrtIds, ...beban.map((b) => b.id), ...deliveryIds, ...tukarIds];
  // Notifikasi JOURNAL_PENDING yang ditulis tes ini (dicocokkan di JS, seperti penulisnya).
  const notif = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", createdAt: { gte: mulaiTes } },
    select: { id: true, metadata: true },
  });
  const milik = notif.filter((n) => entitas.includes(String((n.metadata as Record<string, unknown> | null)?.docId ?? "")));
  if (milik.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik.map((n) => n.id)) } } });
  if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
  if (beban.length) await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(beban.map((b) => b.id)) } } });
  if (klaim.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaim.map((k) => k.id)) } } });
  if (piutang.length) {
    await prisma.receivableItem.deleteMany({ where: { receivableId: { in: seededIds(piutang.map((p) => p.id)) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: seededIds(piutang.map((p) => p.id)) } } });
  }
  if (semuaNri.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(semuaNri) } } });
  if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds) } } });
  if (deliveryIds.length) await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
  if (orderIds.length) await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
  if (tukarIds.length) {
    await prisma.storeExchangeLine.deleteMany({ where: { exchangeId: { in: seededIds(tukarIds) } } });
    await prisma.storeExchange.deleteMany({ where: { id: { in: seededIds(tukarIds) } } });
  }
  if (adjIds.length) await prisma.stockAdjustment.deleteMany({ where: { id: { in: seededIds(adjIds) } } });
  if (invIds.length) await prisma.inventoryValue.deleteMany({ where: { id: { in: seededIds(invIds) } } });
  if (barangId) await prisma.item.delete({ where: { id: seededId(barangId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
});

/** Nota tagihan putus langsung di tabel (tanpa penulis pengiriman): pesanan, pengiriman, penyesuaian stok, piutang. */
async function buatNota(o: { total: number; qty: number; harga: number; biaya: number; invoiceDate?: Date; stok?: boolean; piutang?: boolean }) {
  const n = ++urut;
  const orderNo = `${tag}-SO-${n}`;
  const order = await prisma.fieldSalesOrder.create({
    data: {
      orderNo,
      storeId: tokoId,
      salesmanId: salesId,
      status: "APPROVED",
      orderType: "PUTUS",
      subtotal: o.qty * o.harga,
      total: o.total,
      lines: { create: [{ itemId: barangId, productName: `${tag} Kaos`, qty: o.qty, unitPrice: o.harga, lineTotal: o.qty * o.harga }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  orderIds.push(order.id);
  const lineId = order.lines[0].id;
  const tanggal = o.invoiceDate ?? new Date();
  const d = await prisma.fieldSalesDelivery.create({
    data: {
      docNo: `${tag}-DLV-${n}`,
      orderId: order.id,
      deliveredAt: new Date(),
      deliveredById: gudangId,
      invoiceDate: tanggal,
      dueDate: tanggal,
      subtotal: o.qty * o.harga,
      total: o.total,
      lines: { create: [{ orderLineId: lineId, itemId: barangId, productName: `${tag} Kaos`, qty: o.qty, unitPrice: o.harga, lineTotal: o.qty * o.harga }] },
    },
    select: { id: true, docNo: true },
  });
  deliveryIds.push(d.id);
  if (o.stok !== false) await buatPenyesuaianKirim(orderNo, d.id, lineId, o.qty, o.biaya);
  if (o.piutang !== false) {
    await prisma.receivable.create({
      data: { invoiceNo: d.docNo, storeId: tokoId, salesmanId: salesId, invoiceDate: tanggal, dueDate: tanggal, amount: o.total, outstanding: o.total, source: "DELIVERY", deliveryId: d.id },
    });
  }
  return { deliveryId: d.id, orderNo, lineId };
}

async function buatPenyesuaianKirim(orderNo: string, deliveryId: string, lineId: string, qty: number, biaya: number) {
  const a = await prisma.stockAdjustment.create({
    data: {
      docNumber: `${tag}-ADJ-${++urut}`,
      itemId: barangId,
      type: "NEGATIVE",
      qtyChange: -qty,
      reason: "uji",
      prevQty: 100,
      newQty: 100 - qty,
      prevAvgCost: biaya,
      newAvgCost: biaya,
      source: "FIELD_SALES_CONSUME",
      idempotencyKey: kunciStokPengiriman(orderNo, deliveryId, lineId),
    },
  });
  adjIds.push(a.id);
}

/** Baris jurnal per peran (memo) untuk satu jenis sumber + id dokumen (semua generasi), + debit − kredit. */
async function saldoPeran(sourceType: string, id: string): Promise<Record<string, number>> {
  const j = await prisma.journal.findMany({
    where: { sourceType, OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}#` } }] },
    select: { lines: { select: { chartAccountId: true, debit: true, credit: true } } },
  });
  const peranDari = new Map([...h.akun.entries()].map(([r, a]) => [a, r]));
  const hasil: Record<string, number> = {};
  for (const l of j.flatMap((x) => x.lines)) {
    const r = peranDari.get(l.chartAccountId) ?? "?";
    hasil[r] = Math.round(((hasil[r] ?? 0) + Number(l.debit) - Number(l.credit)) * 100) / 100;
  }
  for (const k of Object.keys(hasil)) if (hasil[k] === 0) delete hasil[k];
  return hasil;
}

async function jumlahGenerasi(sourceType: string, id: string): Promise<number> {
  return prisma.journal.count({ where: { sourceType, OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}#` } }] } });
}

async function rekon() {
  const r = await rekonsiliasiPiutangToko({ storeIds: [tokoId] });
  const b = r.baris.find((x) => x.storeId === tokoId);
  if (!b) throw new Error("toko tidak ada di rekonsiliasi");
  return b;
}

async function nrt(nilai: number) {
  const n = await prisma.storeReturn.create({
    data: { noNrt: `${tag}-NRT-${++urut}`, storeId: tokoId, salesmanId: salesId, claimDate: new Date(), claimedAmount: nilai },
  });
  nrtIds.push(n.id);
  return n.id;
}

describe("nota tagihan putus", () => {
  it("piutang toko, pendapatan, dan HPP dari biaya yang keluar di kartu stok; idempoten", async () => {
    const { deliveryId } = await buatNota({ total: 1_000_000, qty: 4, harga: 250_000, biaya: 120_000 });
    const r = await postJurnalNota(deliveryId, keuanganId);
    expect(r).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_LAPANGAN.NOTA, deliveryId)).toEqual({
      AR_STORE: 1_000_000,
      SALES_REVENUE: -1_000_000,
      COGS: 480_000,
      INVENTORY_FG: -480_000,
    });
    const baris = await prisma.journalLine.findMany({
      where: { journal: { sourceType: SUMBER_LAPANGAN.NOTA, sourceId: deliveryId } },
      select: { chartAccountId: true, channel: true, storeId: true },
    });
    const ar = baris.find((b) => b.chartAccountId === h.akun.get("AR_STORE"));
    const pendapatan = baris.find((b) => b.chartAccountId === h.akun.get("SALES_REVENUE"));
    expect(ar?.storeId).toBe(tokoId);
    expect(pendapatan).toMatchObject({ channel: "PUTUS", storeId: tokoId });
    expect(await postJurnalNota(deliveryId, keuanganId)).toMatchObject({ ok: true, created: false });
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.NOTA, deliveryId)).toBe(1);
    expect((await rekon()).selisih).toBe(0);
  });

  it("PKP: PPN keluaran dipisah dari total nota", async () => {
    h.ppn = PKP;
    const { deliveryId } = await buatNota({ total: 1_110_000, qty: 1, harga: 1_110_000, biaya: 400_000 });
    await postJurnalNota(deliveryId, keuanganId);
    expect(await saldoPeran(SUMBER_LAPANGAN.NOTA, deliveryId)).toEqual({
      AR_STORE: 1_110_000,
      SALES_REVENUE: -1_000_000,
      PPN_KELUARAN: -110_000,
      COGS: 400_000,
      INVENTORY_FG: -400_000,
    });
  });

  it("sebelum tanggal mulai buku besar tidak dijurnal; tanpa tanggal mulai tidak ada yang dijurnal", async () => {
    const lama = await buatNota({ total: 500_000, qty: 1, harga: 500_000, biaya: 1, invoiceDate: wib("2025-12-15") });
    expect(await postJurnalNota(lama.deliveryId, keuanganId)).toEqual({ ok: false, code: "BELUM_BERLAKU" });
    h.mulai = null;
    const baru = await buatNota({ total: 500_000, qty: 1, harga: 500_000, biaya: 1 });
    expect(await postJurnalNota(baru.deliveryId, keuanganId)).toEqual({ ok: false, code: "GL_CUTOVER_NOT_CONFIGURED" });
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.NOTA, baru.deliveryId)).toBe(0);
  });

  it("biaya stok tidak ditemukan → JOURNAL_PENDING bernomor dokumen; posting ulang menyelesaikannya", async () => {
    const { deliveryId, orderNo, lineId } = await buatNota({ total: 300_000, qty: 2, harga: 150_000, biaya: 50_000, stok: false });
    const gagal = await postingJurnalLapanganAman(SUMBER_LAPANGAN.NOTA, deliveryId, keuanganId);
    expect(gagal).toMatchObject({ ok: false, code: "BIAYA_TIDAK_DIKETAHUI" });
    // Dua kali gagal dengan sebab sama = satu notifikasi.
    await postingJurnalLapanganAman(SUMBER_LAPANGAN.NOTA, deliveryId, keuanganId);
    const tanda = (await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING", createdAt: { gte: mulaiTes } }, select: { id: true, title: true, readAt: true, metadata: true } })).filter(
      (n) => (n.metadata as Record<string, unknown>)?.docId === deliveryId,
    );
    expect(tanda).toHaveLength(1);
    expect(tanda[0].title).toContain(`${tag}-DLV-`);
    expect(tanda[0].metadata).toMatchObject({ kind: "nota_putus", reason: "BIAYA_TIDAK_DIKETAHUI" });

    await buatPenyesuaianKirim(orderNo, deliveryId, lineId, 2, 50_000);
    expect(await postingJurnalLapanganAman(SUMBER_LAPANGAN.NOTA, deliveryId, keuanganId)).toMatchObject({ ok: true, created: true });
    expect((await prisma.adminNotification.findUnique({ where: { id: tanda[0].id }, select: { readAt: true } }))?.readAt).not.toBeNull();
  });
});

describe("pelunasan BKM dan retur toko — buku besar mengikuti modul piutang", () => {
  async function lapor(nilai: number, potongan: { nilai: number; nrtId?: string }[], method = "transfer") {
    const r = await buatKlaimPembayaran({
      storeId: tokoId,
      salesmanId: salesId,
      createdById: salesId,
      claimedTransferAt: new Date(),
      method,
      pelunasan: [{ receivableId: (await prisma.receivable.findFirstOrThrow({ where: { storeId: tokoId, source: "DELIVERY" } })).id, nilai }],
      potongan: potongan.map((p) => ({ nama: p.nrtId ? "Retur" : "Promo", nilai: p.nilai, storeReturnId: p.nrtId ?? null })),
      transferPhotoUrl: "/api/foto/uji",
    });
    if (!r.ok) throw new Error(`BKM gagal: ${r.alasan}`);
    return r.id;
  }

  async function verifikasi(id: string) {
    const r = await putuskanKlaim({ paymentClaimId: id, keputusan: "TERVERIFIKASI", olehUserId: keuanganId });
    if (!r.ok) throw new Error(`verifikasi gagal: ${r.alasan}`);
    await kaitKlaimBerubah([id], keuanganId);
  }

  async function hitung(nrtId: string, fisik: number) {
    const r = await catatHitunganGudang({ storeReturnId: nrtId, warehouseUserId: gudangId, receivedAt: new Date(), deliveryMethod: "SALES", physicalAmount: fisik });
    if (!r.ok) throw new Error(`hitungan gagal: ${r.alasan}`);
    nriIds.push(r.id);
    await kaitReturBerubah({ nriIds: [r.id] }, gudangId);
    return r.id;
  }

  async function beban(nrtId: string, bearer: "TOKO" | "PERUSAHAAN") {
    const c = await prisma.returnCharge.findFirstOrThrow({ where: { storeReturnId: nrtId, status: "TERBUKA" } });
    const r = await putuskanBeban({ chargeId: c.id, bearer, alasan: "uji", olehUserId: keuanganId });
    if (!r.ok) throw new Error(`beban gagal: ${r.alasan}`);
    await kaitReturBerubah({ chargeIds: [c.id] }, keuanganId);
  }

  it("BKM terverifikasi dengan potongan retur; gudang menghitung kurang; beban ke perusahaan; lalu BKM dibatalkan", async () => {
    const { deliveryId } = await buatNota({ total: 1_000_000, qty: 4, harga: 250_000, biaya: 100_000 });
    await postJurnalNota(deliveryId, keuanganId);
    const n = await nrt(300_000);

    // BKM: transfer 650 rb + promo 50 rb + retur 300 rb. Belum diverifikasi = nol.
    const k = await lapor(1_000_000, [{ nilai: 50_000 }, { nilai: 300_000, nrtId: n }]);
    await kaitKlaimBerubah([k], salesId);
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.BKM, k)).toBe(0);

    await verifikasi(k);
    expect(await saldoPeran(SUMBER_LAPANGAN.BKM, k)).toEqual({ BANK: 650_000, SALES_DISCOUNT: 50_000, AR_STORE: -700_000 });
    let b = await rekon();
    expect(b.modul).toBe(300_000); // retur ditahan penuh sampai gudang menghitung
    expect(b.bukuBesar).toBe(300_000);
    expect(b.selisih).toBe(0);

    // Gudang menghitung 100 rb: pendapatan dibalik sebesar fisik.
    const nri = await hitung(n, 100_000);
    expect(await saldoPeran(SUMBER_LAPANGAN.RETUR, nri)).toEqual({ SALES_RETURN: 100_000, AR_STORE: -100_000 });
    b = await rekon();
    expect(b.modul).toBe(200_000);
    expect(b).toMatchObject({ bukuBesar: 200_000, kreditRetur: 0, selisih: 0 });

    // Selisih 200 rb ditanggung perusahaan: potongan dilepas, rugi.
    await beban(n, "PERUSAHAAN");
    expect(await saldoPeran(SUMBER_LAPANGAN.RETUR, nri)).toEqual({ SALES_RETURN: 100_000, LOSS_EXPENSE: 200_000, AR_STORE: -300_000 });
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.RETUR, nri)).toBe(2);
    b = await rekon();
    expect(b).toMatchObject({ modul: 0, bukuBesar: 0, selisih: 0 });

    // BKM dibatalkan sesudah terverifikasi: jurnalnya dibalik (generasi baru), rugi dibalik, kredit retur 100 rb belum dipakai.
    const batal = await batalkanKlaim({ paymentClaimId: k, alasan: "salah catat", olehUserId: keuanganId });
    expect(batal.ok).toBe(true);
    await kaitKlaimBerubah([k], keuanganId);
    expect(await saldoPeran(SUMBER_LAPANGAN.BKM, k)).toEqual({});
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.BKM, k)).toBe(2);
    expect(await saldoPeran(SUMBER_LAPANGAN.RETUR, nri)).toEqual({ SALES_RETURN: 100_000, AR_STORE: -100_000 });
    b = await rekon();
    expect(b).toMatchObject({ modul: 1_000_000, kreditRetur: 100_000, bukuBesar: 900_000, selisih: 0 });

    // Menyelaraskan ulang tanpa perubahan keadaan tidak menulis apa pun.
    expect(await selaraskanJurnalKlaim(k, keuanganId)).toMatchObject({ ok: true, created: false });
    expect(await selaraskanJurnalRetur(nri, keuanganId)).toMatchObject({ ok: true, created: false });
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.BKM, k)).toBe(2);
  });

  it("beban selisih ke TOKO: faktur bebannya tidak dijurnal lagi — buku besar = modul", async () => {
    const { deliveryId } = await buatNota({ total: 1_000_000, qty: 4, harga: 250_000, biaya: 100_000 });
    await postJurnalNota(deliveryId, keuanganId);
    const n = await nrt(300_000);
    const k = await lapor(1_000_000, [{ nilai: 300_000, nrtId: n }], "tunai");
    await verifikasi(k);
    expect(await saldoPeran(SUMBER_LAPANGAN.BKM, k)).toEqual({ CASH: 700_000, AR_STORE: -700_000 });
    const nri = await hitung(n, 100_000);
    await beban(n, "TOKO");
    // Faktur beban 200 rb lahir di modul; buku besar tetap mengkredit 100 rb (fisik).
    expect(await saldoPeran(SUMBER_LAPANGAN.RETUR, nri)).toEqual({ SALES_RETURN: 100_000, AR_STORE: -100_000 });
    const b = await rekon();
    expect(b).toMatchObject({ modul: 200_000, bukuBesar: 200_000, kreditRetur: 0, selisih: 0 });
  });

  it("retur dihitung sebelum dipotong: kredit retur belum dipakai menjelaskan selisihnya", async () => {
    const { deliveryId } = await buatNota({ total: 1_000_000, qty: 4, harga: 250_000, biaya: 100_000 });
    await postJurnalNota(deliveryId, keuanganId);
    const n = await nrt(300_000);
    await hitung(n, 300_000);
    const b = await rekon();
    expect(b).toMatchObject({ modul: 1_000_000, bukuBesar: 700_000, kreditRetur: 300_000, selisih: 0 });
  });

  it("dua penyelaras yang berpacu atas BKM yang sama hanya menulis satu generasi", async () => {
    const { deliveryId } = await buatNota({ total: 400_000, qty: 1, harga: 400_000, biaya: 100_000 });
    await postJurnalNota(deliveryId, keuanganId);
    const k = await lapor(400_000, []);
    const v = await putuskanKlaim({ paymentClaimId: k, keputusan: "TERVERIFIKASI", olehUserId: keuanganId });
    expect(v.ok).toBe(true);
    await Promise.all([selaraskanJurnalKlaim(k, keuanganId), selaraskanJurnalKlaim(k, keuanganId), selaraskanJurnalKlaim(k, gudangId)]);
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.BKM, k)).toBe(1);
    expect(await saldoPeran(SUMBER_LAPANGAN.BKM, k)).toEqual({ BANK: 400_000, AR_STORE: -400_000 });
  });

  it("peran belum dipetakan: BKM tetap terverifikasi, jurnalnya tertunda, lalu posting ulang berhasil", async () => {
    const { deliveryId } = await buatNota({ total: 400_000, qty: 1, harga: 400_000, biaya: 100_000 });
    await postJurnalNota(deliveryId, keuanganId);
    const k = await lapor(400_000, []);
    const bank = h.akun.get("BANK")!;
    h.akun.delete("BANK");
    try {
      await verifikasi(k);
      expect((await prisma.paymentClaim.findUnique({ where: { id: k }, select: { status: true } }))?.status).toBe("TERVERIFIKASI");
      expect(await jumlahGenerasi(SUMBER_LAPANGAN.BKM, k)).toBe(0);
    } finally {
      h.akun.set("BANK", bank);
    }
    const tanda = (await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING", createdAt: { gte: mulaiTes } }, select: { id: true, metadata: true } })).filter(
      (x) => (x.metadata as Record<string, unknown>)?.docId === k,
    );
    expect(tanda.map((x) => x.metadata)).toEqual([expect.objectContaining({ kind: "bkm_lapangan", reason: "UNMAPPED_ROLE", role: "BANK" })]);
    expect(await postingJurnalLapanganAman(SUMBER_LAPANGAN.BKM, k, keuanganId)).toMatchObject({ ok: true, created: true });
    expect((await prisma.adminNotification.findUnique({ where: { id: tanda[0].id }, select: { readAt: true } }))?.readAt).not.toBeNull();
  });
});

describe("retur toko — persediaan kembali", () => {
  it("barang layak ke persediaan barang jadi (biaya penyesuaian stok), rusak ke persediaan rusak (dibekukan)", async () => {
    const n = await nrt(200_000);
    const inv = await prisma.inventoryValue.create({ data: { itemId: barangId, variantSku: "", qtyOnHand: 10, avgCost: 30_000, totalValue: 300_000 } });
    invIds.push(inv.id);
    const nri = await prisma.warehouseReturn.create({
      data: {
        noNri: `${tag}-NRI-${++urut}`,
        storeId: tokoId,
        storeReturnId: n,
        warehouseUserId: gudangId,
        receivedAt: new Date(),
        physicalAmount: 200_000,
        claimedAmount: 200_000,
        status: "FINAL",
        finalisedAt: new Date(),
        items: {
          create: [
            { itemId: barangId, itemName: "Kaos", qty: 2, price: 50_000, amount: 100_000, condition: "LAYAK" },
            { itemId: barangId, itemName: "Kaos", qty: 2, price: 50_000, amount: 100_000, condition: "RUSAK" },
          ],
        },
      },
      select: { id: true, noNri: true },
    });
    nriIds.push(nri.id);
    const a = await prisma.stockAdjustment.create({
      data: {
        docNumber: `${tag}-ADJ-${++urut}`,
        itemId: barangId,
        type: "POSITIVE",
        qtyChange: 2,
        reason: `Retur toko ${nri.noNri} — Kaos`,
        prevQty: 8,
        newQty: 10,
        prevAvgCost: 30_000,
        newAvgCost: 30_000,
        source: "STORE_RETURN_RECEIVE",
      },
    });
    adjIds.push(a.id);

    expect(await selaraskanJurnalRetur(nri.id, gudangId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_LAPANGAN.RETUR, nri.id)).toEqual({
      INVENTORY_FG: 60_000,
      INVENTORY_DAMAGED: 60_000,
      COGS: -120_000,
      SALES_RETURN: 200_000,
      AR_STORE: -200_000,
    });

    // Harga rata-rata berubah sesudahnya: nilai barang rusak tidak ikut bergeser.
    await prisma.inventoryValue.update({ where: { id: inv.id }, data: { avgCost: 45_000 } });
    expect(await selaraskanJurnalRetur(nri.id, gudangId)).toMatchObject({ ok: true, created: false });

    // Dipindah ke toko konsinyasi: jurnal lapangan dibalik seluruhnya (urusan jurnal konsinyasi).
    await prisma.store.update({ where: { id: tokoId }, data: { termsType: "KONSI" } });
    expect(await selaraskanJurnalRetur(nri.id, gudangId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_LAPANGAN.RETUR, nri.id)).toEqual({});
  });
});

describe("tukar barang", () => {
  it("persediaan masuk/keluar pada biaya kartu stok, selisih ke HPP", async () => {
    const d = await prisma.storeExchange.create({
      data: { docNo: `${tag}-TKR-${++urut}`, storeId: tokoId, salesmanId: salesId, status: "SELESAI", completedAt: new Date() },
    });
    tukarIds.push(d.id);
    const masuk = await prisma.storeExchangeLine.create({ data: { exchangeId: d.id, direction: "MASUK", itemId: barangId, productName: "S", qty: 2 } });
    const keluar = await prisma.storeExchangeLine.create({ data: { exchangeId: d.id, direction: "KELUAR", itemId: barangId, productName: "M", qty: 2 } });
    for (const [l, qty, biaya] of [
      [masuk, 2, 40_000],
      [keluar, -2, 55_000],
    ] as const) {
      const a = await prisma.stockAdjustment.create({
        data: {
          docNumber: `${tag}-ADJ-${++urut}`,
          itemId: barangId,
          type: qty > 0 ? "POSITIVE" : "NEGATIVE",
          qtyChange: qty,
          reason: "uji tukar",
          prevQty: 10,
          newQty: 10 + qty,
          prevAvgCost: biaya,
          newAvgCost: biaya,
          source: qty > 0 ? "STORE_EXCHANGE_IN" : "STORE_EXCHANGE_OUT",
          idempotencyKey: `tukar:${l.id}`,
        },
      });
      adjIds.push(a.id);
    }
    expect(await postJurnalTukar(d.id, gudangId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_LAPANGAN.TUKAR, d.id)).toEqual({ INVENTORY_FG: -30_000, COGS: 30_000 });
  });
});

describe("saldo awal piutang toko (jurnal OPENING agen saldo awal)", () => {
  it("rekonsiliasi membandingkan SELURUH saldo AR_STORE (termasuk saldo awal) dengan sisa SEMUA faktur toko", async () => {
    // Faktur sebelum tanggal mulai (impor) + saldo awalnya di buku besar, seperti yang diposting A2.
    await prisma.receivable.create({
      data: { invoiceNo: `${tag}-IMP-${++urut}`, storeId: tokoId, invoiceDate: wib("2025-12-01"), dueDate: wib("2025-12-31"), amount: 500_000, outstanding: 500_000, source: "IMPORT" },
    });
    await postJournal(prisma, {
      source: { type: "OPENING", id: `${tag}-OPENING-${urut}` },
      date: wib("2026-01-01"),
      description: `${tag} saldo awal piutang toko`,
      postedById: keuanganId,
      lines: [
        { chartAccountId: h.akun.get("AR_STORE")!, debit: 500_000, credit: 0, storeId: tokoId },
        { chartAccountId: h.akun.get("INVENTORY")!, debit: 0, credit: 500_000 },
      ],
    });
    // Ditambah satu nota sesudah tanggal mulai yang dijurnal lapangan.
    const { deliveryId } = await buatNota({ total: 300_000, qty: 1, harga: 300_000, biaya: 100_000 });
    await postJurnalNota(deliveryId, keuanganId);
    const b = await rekon();
    expect(b).toMatchObject({ bukuBesar: 800_000, modul: 800_000, kreditRetur: 0, selisih: 0, cocok: true });
    // Faktur impor tidak lahir dari jurnal nota — tampil sebagai penjelas, tidak mengubah rumus.
    expect(b.diLuarJurnal).toBe(500_000);
  });
});

describe("selaraskan satu toko", () => {
  it("memposting nota dan BKM toko itu yang belum berjurnal; diulang tidak menulis apa pun", async () => {
    const { deliveryId } = await buatNota({ total: 400_000, qty: 1, harga: 400_000, biaya: 100_000 });
    const k = await buatKlaimPembayaran({
      storeId: tokoId,
      salesmanId: salesId,
      createdById: salesId,
      claimedTransferAt: new Date(),
      method: "transfer",
      pelunasan: [{ receivableId: (await prisma.receivable.findFirstOrThrow({ where: { storeId: tokoId } })).id, nilai: 150_000 }],
      transferPhotoUrl: "/api/foto/uji",
    });
    if (!k.ok) throw new Error(k.alasan);
    await putuskanKlaim({ paymentClaimId: k.id, keputusan: "TERVERIFIKASI", olehUserId: keuanganId });

    const pertama = await selaraskanJurnalToko(tokoId, keuanganId);
    expect(pertama).toMatchObject({ diperiksa: 2, berubah: 2, gagal: [] });
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.NOTA, deliveryId)).toBe(1);
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.BKM, k.id)).toBe(1);
    expect((await rekon()).bukuBesar).toBe(250_000);
    expect(await selaraskanJurnalToko(tokoId, keuanganId)).toMatchObject({ diperiksa: 2, berubah: 0, gagal: [] });
  });
});

describe("sapuan dokumen tanpa jurnal", () => {
  it("menemukan dokumen sesudah tanggal mulai yang belum berjurnal, lalu tidak lagi sesudah diposting", async () => {
    const { deliveryId } = await buatNota({ total: 400_000, qty: 1, harga: 400_000, biaya: 100_000 });
    const k = await buatKlaimPembayaran({
      storeId: tokoId,
      salesmanId: salesId,
      createdById: salesId,
      claimedTransferAt: new Date(),
      method: "transfer",
      pelunasan: [{ receivableId: (await prisma.receivable.findFirstOrThrow({ where: { storeId: tokoId } })).id, nilai: 400_000 }],
      transferPhotoUrl: "/api/foto/uji",
    });
    if (!k.ok) throw new Error(k.alasan);
    await putuskanKlaim({ paymentClaimId: k.id, keputusan: "TERVERIFIKASI", olehUserId: keuanganId });
    const opsi = { sejak: new Date(Date.now() - 3_600_000), sampai: new Date(Date.now() + 3_600_000), batas: 1000 };

    expect((await cariNotaTanpaJurnal(opsi)).map((d) => d.id)).toContain(deliveryId);
    expect((await cariKlaimTanpaJurnal(opsi)).map((d) => d.id)).toContain(k.id);
    await postJurnalNota(deliveryId, keuanganId);
    await selaraskanJurnalKlaim(k.id, keuanganId);
    expect((await cariNotaTanpaJurnal(opsi)).map((d) => d.id)).not.toContain(deliveryId);
    expect((await cariKlaimTanpaJurnal(opsi)).map((d) => d.id)).not.toContain(k.id);

    // Rentang sebelum tanggal mulai: kosong. Batas dihormati.
    h.mulai = new Date(Date.now() + 86_400_000);
    expect(await cariNotaTanpaJurnal(opsi)).toEqual([]);
    expect(await cariReturTanpaJurnal(opsi)).toEqual([]);
    expect(await cariTukarTanpaJurnal(opsi)).toEqual([]);
  });
});
