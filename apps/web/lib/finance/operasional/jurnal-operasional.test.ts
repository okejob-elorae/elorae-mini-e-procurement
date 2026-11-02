import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";

/*
 * Jurnal operasional terhadap basis data sungguhan, lewat PENULIS DOKUMEN YANG
 * ASLI bila ada (kiriman titipan, kunci/buka kunci siklus, pembayaran toko,
 * gaji SPG, hitungan gudang, gudang rusak, barang hilang). Yang ditiru hanya
 * pembaca konfigurasi bersama: pemetaan akun (ke akun uji milik tes ini),
 * tanggal mulai buku besar, dan pengaturan PPN. Basis data dipakai bersama:
 * semua data milik tes ini, setiap penghapusan lewat `seededId()`.
 */

const h = vi.hoisted(() => {
  // Kait operasional mati di bawah vitest kecuali dinyalakan (lihat `kait.ts`); tes ini memakainya.
  const kaitLama = process.env.JURNAL_OPERASIONAL_KAIT_UJI;
  process.env.JURNAL_OPERASIONAL_KAIT_UJI = "1";
  return {
    kaitLama,
    akun: new Map<string, string>(),
    mulai: new Date("2004-01-01T00:00:00+07:00") as Date | null,
    ppn: null as unknown as PengaturanPpn,
  };
});

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

import { hitungJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { kaitReturBerubah } from "@/lib/finance/lapangan/kait";
import { SUMBER_LAPANGAN } from "@/lib/finance/lapangan/aturan";
import { sumberSapuanTerdaftar } from "@/lib/finance/sapuan/semua";
import { batalkanPembayaranToko, bayarKomisi, bukaKunci, catatPembayaranToko, kirimTitipan, kunciAngka } from "@/lib/konsinyasi/writer";
import { catatHitunganGudang } from "@/lib/receivables/return-writer";
import { putuskanGudangRusak } from "@/lib/spg/gudang-rusak-writer";
import { batalkanBarangHilang, buatBarangHilang, putuskanBarangHilang } from "@/lib/spg/hilang-writer";
import { idKomisiSpg, SEMUA_SUMBER_OPERASIONAL, SUMBER_OPERASIONAL } from "./aturan";
import {
  postJurnalBayarBiayaPerjalanan,
  postJurnalBayarGajiKonsi,
  postJurnalBayarKomisiSpg,
  postJurnalBiayaPerjalanan,
  postJurnalGudangRusak,
  postJurnalKirimKonsi,
  postJurnalPesananKonsi,
  postJurnalPindahKonsi,
  postJurnalPotongSales,
  postJurnalReturLapanganKonsi,
  postJurnalReturPemasok,
  postJurnalStokManual,
  selaraskanJurnalBarangHilang,
  selaraskanJurnalBayarTokoKonsi,
  selaraskanJurnalKomisiKonsi,
  selaraskanJurnalKomisiSpg,
  selaraskanJurnalReturKonsi,
  selaraskanJurnalSiklusKonsi,
} from "./jurnal";
import { kaitKirimTitipan, kaitPindahKonsiPengiriman, kaitPindahKonsiTransfer, kaitReturLapanganKonsi, kaitSiklusKonsi } from "./kait";
import { putarBarangRusak } from "./nilai-rusak-queries";
import { rekonsiliasiPersediaan } from "./rekonsiliasi-persediaan-queries";
import {
  cariKirimKonsiTanpaJurnal,
  cariPesananKonsiTanpaJurnal,
  cariPindahKonsiTanpaJurnal,
  cariReturLapanganKonsiTanpaJurnal,
  cariStokManualTanpaJurnal,
  PENCARI_OPERASIONAL,
} from "./sapuan";
import { postingJurnalOperasionalAman } from "./tertunda";

const tag = `UJC2-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);
const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };

const PERAN_UJI: Array<[string, "ASET" | "LIABILITAS" | "PENDAPATAN" | "HPP" | "BEBAN"]> = [
  ["INVENTORY", "ASET"],
  ["INVENTORY_FG", "ASET"],
  ["INVENTORY_CONSIGNMENT", "ASET"],
  ["INVENTORY_DAMAGED", "ASET"],
  ["INVENTORY_VARIANCE", "BEBAN"],
  ["AR_CONSIGNMENT", "ASET"],
  ["SALES_REVENUE", "PENDAPATAN"],
  ["SALES_DISCOUNT", "PENDAPATAN"],
  ["PPN_KELUARAN", "LIABILITAS"],
  ["PPN_MASUKAN", "ASET"],
  ["COGS", "HPP"],
  ["LOSS_EXPENSE", "BEBAN"],
  ["LOSS_RECOVERY", "PENDAPATAN"],
  ["SPG_COMMISSION_EXPENSE", "BEBAN"],
  ["SALES_COMMISSION_EXPENSE", "BEBAN"],
  ["COMMISSION_PAYABLE", "LIABILITAS"],
  ["BANK", "ASET"],
  ["CASH", "ASET"],
  ["AP", "LIABILITAS"],
  ["TRAVEL_EXPENSE", "BEBAN"],
  ["REIMBURSE_PAYABLE", "LIABILITAS"],
];

let akunIds: string[] = [];
let rekeningLainId = "";
let adminId = "";
let gudangId = "";
let jenisPemasokId = "";
let uomId = "";

let tokoId = "";
let tokoPutusId = "";
let spgId = "";
let barangId = "";
let kainId = "";
let pemasokId = "";
let siklusId = "";
let invIds: string[] = [];
let lossIds: string[] = [];
let mulaiTes = new Date();
let urut = 0;

beforeAll(async () => {
  akunIds = [];
  h.akun.clear();
  for (const [role, type] of PERAN_UJI) {
    const a = await prisma.chartAccount.create({ data: { code: `${tag}-${role}`, name: `${tag} ${role}`, type, depth: 1 } });
    akunIds.push(a.id);
    h.akun.set(role, a.id);
  }
  rekeningLainId = (await prisma.chartAccount.create({ data: { code: `${tag}-BANK2`, name: `${tag} Bank lain`, type: "ASET", depth: 1 } })).id;
  akunIds.push(rekeningLainId);
  adminId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-adm@uji.local`, name: `${tag} Admin`, passwordHash: "x" } })).id;
  gudangId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-gdg@uji.local`, name: `${tag} Gudang`, passwordHash: "x" } })).id;
  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  const jenis = await prisma.supplierType.findFirst({ select: { id: true } });
  if (!jenis) throw new Error("Basis data uji butuh satu jenis pemasok");
  jenisPemasokId = jenis.id;
});

afterAll(async () => {
  if (h.kaitLama === undefined) delete process.env.JURNAL_OPERASIONAL_KAIT_UJI;
  else process.env.JURNAL_OPERASIONAL_KAIT_UJI = h.kaitLama;
  if (akunIds.length) {
    const jurnal = await prisma.journalLine.findMany({ where: { chartAccountId: { in: seededIds(akunIds) } }, select: { journalId: true } });
    if (jurnal.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds([...new Set(jurnal.map((j) => j.journalId))]) } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
  }
  await prisma.auditLog.deleteMany({ where: { userId: { in: seededIds([adminId, gudangId].filter(Boolean)) } } });
  if (uomId) await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  await prisma.user.deleteMany({ where: { id: { in: seededIds([adminId, gudangId].filter(Boolean)) } } });
});

beforeEach(async () => {
  tokoId = "";
  tokoPutusId = "";
  spgId = "";
  barangId = "";
  kainId = "";
  pemasokId = "";
  siklusId = "";
  invIds = [];
  lossIds = [];
  mulaiTes = new Date(Date.now() - 1000);
  h.mulai = wib("2004-01-01");
  h.ppn = NON_PKP;
  urut += 1;
  tokoId = (await prisma.store.create({ data: { code: `${tag}-K${urut}`, name: `${tag} Konsi ${urut}`, address: "uji", termsType: "KONSI", isActive: true } })).id;
  tokoPutusId = (await prisma.store.create({ data: { code: `${tag}-P${urut}`, name: `${tag} Putus ${urut}`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
  spgId = (
    await prisma.user.create({ data: { email: `${tag.toLowerCase()}-spg${urut}@uji.local`, name: `${tag} SPG ${urut}`, passwordHash: "x", assignedStoreId: tokoId } })
  ).id;
  barangId = (
    await prisma.item.create({ data: { sku: `${tag}-FG-${urut}`, nameId: `${tag} Kaos`, nameEn: `${tag} Tee`, type: "FINISHED_GOOD", uomId, commissionPerPcs: 2_000 } })
  ).id;
  kainId = (await prisma.item.create({ data: { sku: `${tag}-KN-${urut}`, nameId: `${tag} Kain`, nameEn: `${tag} Fabric`, type: "FABRIC", uomId } })).id;
  invIds.push(
    (await prisma.inventoryValue.create({ data: { itemId: barangId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 50_000, totalValue: 5_000_000 } })).id,
  );
  pemasokId = (await prisma.supplier.create({ data: { code: `${tag}-S${urut}`, name: `${tag} Pemasok`, typeId: jenisPemasokId } })).id;
});

afterEach(async () => {
  if (akunIds.length) {
    const jurnal = await prisma.journalLine.findMany({ where: { chartAccountId: { in: seededIds(akunIds) } }, select: { journalId: true } });
    if (jurnal.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds([...new Set(jurnal.map((j) => j.journalId))]) } } });
  }
  const tokoIds = [tokoId, tokoPutusId].filter(Boolean);
  const barangIds = [barangId, kainId].filter(Boolean);
  const siklus = tokoId ? await prisma.consignmentCycle.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } }) : [];
  const siklusIds = siklus.map((s) => s.id);
  const kiriman = tokoId ? await prisma.consignmentShipment.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } }) : [];
  const nri = tokoIds.length ? await prisma.warehouseReturn.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true } }) : [];
  const komisi = siklusIds.length ? await prisma.consignmentCommission.findMany({ where: { cycleId: { in: seededIds(siklusIds) } }, select: { id: true } }) : [];
  const bayar = siklusIds.length ? await prisma.consignmentPayment.findMany({ where: { cycleId: { in: seededIds(siklusIds) } }, select: { id: true } }) : [];
  const gerakRusak = barangIds.length ? await prisma.damagedStockMovement.findMany({ where: { itemId: { in: seededIds(barangIds) } }, select: { id: true } }) : [];
  const komisiSpg = tokoIds.length ? await prisma.spgCommission.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true } }) : [];
  const retur = pemasokId ? await prisma.vendorReturn.findMany({ where: { vendorId: seededId(pemasokId) }, select: { id: true } }) : [];
  const klaim = spgId ? await prisma.expenseClaim.findMany({ where: { userId: seededId(spgId) }, select: { id: true } }) : [];
  const adj = barangIds.length ? await prisma.stockAdjustment.findMany({ where: { itemId: { in: seededIds(barangIds) } }, select: { id: true } }) : [];
  const potong = await prisma.stockLossDeduction.findMany({ where: { refId: { startsWith: `${tag}:` }, refType: "KomisiSalesman" }, select: { id: true } });
  const transfer = tokoIds.length ? await prisma.konsiTransfer.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true } }) : [];
  const pesanan = tokoIds.length ? await prisma.fieldSalesOrder.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true } }) : [];
  const returLapangan = tokoIds.length ? await prisma.fieldReturn.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true } }) : [];
  const entitas = [
    ...tokoIds,
    ...siklusIds,
    ...kiriman.map((k) => k.id),
    ...transfer.map((t) => t.id),
    ...pesanan.map((p) => p.id),
    ...returLapangan.map((r) => r.id),
    ...nri.map((n) => n.id),
    ...komisi.map((k) => k.id),
    ...bayar.map((b) => b.id),
    ...gerakRusak.map((g) => g.id),
    ...komisiSpg.map((k) => k.id),
    ...retur.map((r) => r.id),
    ...klaim.map((k) => k.id),
    ...adj.map((a) => a.id),
    ...potong.map((p) => p.id),
    ...lossIds,
    ...(tokoPutusId ? [idKomisiSpg(tokoPutusId, "2004-03")] : []),
  ];
  // Notifikasi yang ditulis tes ini (dicocokkan di JS, seperti penulisnya).
  const notif = await prisma.adminNotification.findMany({ where: { createdAt: { gte: mulaiTes } }, select: { id: true, metadata: true } });
  const milik = notif.filter((n) => {
    const teks = JSON.stringify(n.metadata ?? "");
    return entitas.some((id) => id && teks.includes(id));
  });
  if (milik.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik.map((n) => n.id)) } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: seededIds([adminId, gudangId, spgId].filter(Boolean)) } } });
  if (potong.length) await prisma.stockLossDeduction.deleteMany({ where: { id: { in: seededIds(potong.map((p) => p.id)) } } });
  if (lossIds.length) {
    const bagian = await prisma.stockLossShare.findMany({ where: { lossId: { in: seededIds(lossIds) } }, select: { id: true } });
    if (bagian.length) await prisma.stockLossDeduction.deleteMany({ where: { shareId: { in: seededIds(bagian.map((b) => b.id)) } } });
    await prisma.stockLossShare.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLossLine.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(lossIds) } } });
  }
  if (gerakRusak.length) await prisma.damagedStockMovement.deleteMany({ where: { id: { in: seededIds(gerakRusak.map((g) => g.id)) } } });
  if (siklusIds.length) {
    await prisma.consignmentPayment.deleteMany({ where: { cycleId: { in: seededIds(siklusIds) } } });
    await prisma.consignmentCommission.deleteMany({ where: { cycleId: { in: seededIds(siklusIds) } } });
    await prisma.consignmentSold.deleteMany({ where: { cycleId: { in: seededIds(siklusIds) } } });
    await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: { in: seededIds(siklusIds) } } } });
    await prisma.consignmentReport.deleteMany({ where: { cycleId: { in: seededIds(siklusIds) } } });
  }
  if (kiriman.length) {
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: { in: seededIds(kiriman.map((k) => k.id)) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds(kiriman.map((k) => k.id)) } } });
  }
  if (siklusIds.length) await prisma.consignmentCycle.deleteMany({ where: { id: { in: seededIds(siklusIds) } } });
  // Anak sebelum induk: baris transfer → transfer → baris pesanan → pesanan; baris retur lapangan → returnya.
  if (transfer.length) {
    await prisma.konsiTransferLine.deleteMany({ where: { transferId: { in: seededIds(transfer.map((t) => t.id)) } } });
    await prisma.konsiTransfer.deleteMany({ where: { id: { in: seededIds(transfer.map((t) => t.id)) } } });
  }
  if (pesanan.length) {
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(pesanan.map((p) => p.id)) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(pesanan.map((p) => p.id)) } } });
  }
  if (returLapangan.length) {
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: seededIds(returLapangan.map((r) => r.id)) } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: seededIds(returLapangan.map((r) => r.id)) } } });
  }
  if (nri.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nri.map((n) => n.id)) } } });
  if (tokoIds.length) await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds(tokoIds) } } });
  if (komisiSpg.length) await prisma.spgCommission.deleteMany({ where: { id: { in: seededIds(komisiSpg.map((k) => k.id)) } } });
  if (retur.length) await prisma.vendorReturn.deleteMany({ where: { id: { in: seededIds(retur.map((r) => r.id)) } } });
  if (klaim.length) await prisma.expenseClaim.deleteMany({ where: { id: { in: seededIds(klaim.map((k) => k.id)) } } });
  if (barangIds.length) {
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: seededIds(barangIds) } } });
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: seededIds(barangIds) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: seededIds(barangIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(barangIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(barangIds) } } });
  }
  if (spgId) await prisma.user.delete({ where: { id: seededId(spgId) } });
  if (pemasokId) await prisma.supplier.delete({ where: { id: seededId(pemasokId) } });
  if (tokoIds.length) await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds) } } });
});

/** Debit − kredit per peran untuk satu jenis sumber + id dokumen (semua generasi). */
async function saldoPeran(sourceType: string, id: string): Promise<Record<string, number>> {
  const j = await prisma.journal.findMany({
    where: { sourceType, OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}#` } }] },
    select: { lines: { select: { chartAccountId: true, debit: true, credit: true } } },
  });
  const peranDari = new Map([...h.akun.entries()].map(([r, a]) => [a, r]));
  const hasil: Record<string, number> = {};
  for (const l of j.flatMap((x) => x.lines)) {
    const r = peranDari.get(l.chartAccountId) ?? (l.chartAccountId === rekeningLainId ? "BANK2" : "?");
    hasil[r] = Math.round(((hasil[r] ?? 0) + Number(l.debit) - Number(l.credit)) * 100) / 100;
  }
  for (const k of Object.keys(hasil)) if (hasil[k] === 0) delete hasil[k];
  return hasil;
}

async function jumlahGenerasi(sourceType: string, id: string): Promise<number> {
  return prisma.journal.count({ where: { sourceType, OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}#` } }] } });
}

async function kirim(qty: number, shippedAt = wib("2004-09-10")) {
  const r = await kirimTitipan({
    storeId: tokoId,
    olehUserId: adminId,
    shippedAt,
    items: [{ itemId: barangId, variantSku: "", itemName: `${tag} Kaos`, qty, price: 100_000 }],
  });
  if (!r.ok) throw new Error(`kiriman gagal: ${r.alasan}`);
  return r.id;
}

async function siklusDenganLaporan(qty: number) {
  siklusId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K${urut}`, storeId: tokoId, periodYear: 2004, periodMonth: 9 } })).id;
  for (const source of ["SPG", "TOKO"] as const) {
    await prisma.consignmentReport.create({
      data: { cycleId: siklusId, source, reportedAt: new Date(), items: { create: [{ itemId: barangId, itemName: `${tag} Kaos`, qty }] } },
    });
  }
}

const kunci = (qty: number) =>
  kunciAngka({ cycleId: siklusId, olehUserId: adminId, gajiPokokPerSpg: 1_000_000, baris: [{ itemId: barangId, itemName: `${tag} Kaos`, qty, price: 75_000 }] });

describe("konsinyasi: kiriman, siklus, pembayaran toko, gaji SPG", () => {
  it("kiriman titipan memindahkan biaya kartu stok ke persediaan konsinyasi; idempoten", async () => {
    const id = await kirim(4);
    expect(await postJurnalKirimKonsi(id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.KIRIM_KONSI, id)).toEqual({ INVENTORY_CONSIGNMENT: 200_000, INVENTORY_FG: -200_000 });
    const konsi = await prisma.journalLine.findFirst({
      where: { journal: { sourceType: SUMBER_OPERASIONAL.KIRIM_KONSI, sourceId: id }, chartAccountId: h.akun.get("INVENTORY_CONSIGNMENT") },
      select: { storeId: true },
    });
    expect(konsi?.storeId).toBe(tokoId);
    expect(await postJurnalKirimKonsi(id, adminId)).toMatchObject({ ok: true, created: false });
    expect(await jumlahGenerasi(SUMBER_OPERASIONAL.KIRIM_KONSI, id)).toBe(1);
  });

  it("siklus dikunci → pendapatan neto + HPP dari biaya kirim + gaji SPG; buka kunci membalik; kunci ulang menjurnal angka baru", async () => {
    const kiriman = await kirim(4);
    await postJurnalKirimKonsi(kiriman, adminId);
    await siklusDenganLaporan(3);
    expect(await kunci(3)).toMatchObject({ ok: true, jumlahSpg: 1 });

    expect(await selaraskanJurnalSiklusKonsi(siklusId, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toEqual({
      AR_CONSIGNMENT: 225_000,
      SALES_REVENUE: -225_000,
      COGS: 150_000,
      INVENTORY_CONSIGNMENT: -150_000,
    });
    const pendapatan = await prisma.journalLine.findFirst({
      where: { journal: { sourceType: SUMBER_OPERASIONAL.SIKLUS_KONSI, sourceId: siklusId }, chartAccountId: h.akun.get("SALES_REVENUE") },
      select: { channel: true, storeId: true, journal: { select: { date: true } } },
    });
    expect(pendapatan).toMatchObject({ channel: "KONSINYASI", storeId: tokoId });
    // Akhir bulan periodenya (30 September WIB), bukan saat dikunci.
    expect(pendapatan?.journal.date.toISOString()).toBe("2004-09-29T17:00:00.000Z");

    expect(await selaraskanJurnalKomisiKonsi(siklusId, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.KOMISI_KONSI, siklusId)).toEqual({ SPG_COMMISSION_EXPENSE: 1_006_000, COMMISSION_PAYABLE: -1_006_000 });
    // Diselaraskan lagi tanpa perubahan: tidak ada generasi baru.
    expect(await selaraskanJurnalSiklusKonsi(siklusId, adminId)).toMatchObject({ ok: true, created: false });

    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
    await selaraskanJurnalSiklusKonsi(siklusId, adminId);
    await selaraskanJurnalKomisiKonsi(siklusId, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toEqual({});
    expect(await saldoPeran(SUMBER_OPERASIONAL.KOMISI_KONSI, siklusId)).toEqual({});
    expect(await jumlahGenerasi(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toBe(2);

    expect(await kunci(2)).toMatchObject({ ok: true });
    await selaraskanJurnalSiklusKonsi(siklusId, adminId);
    await selaraskanJurnalKomisiKonsi(siklusId, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toEqual({
      AR_CONSIGNMENT: 150_000,
      SALES_REVENUE: -150_000,
      COGS: 100_000,
      INVENTORY_CONSIGNMENT: -100_000,
    });
    expect(await saldoPeran(SUMBER_OPERASIONAL.KOMISI_KONSI, siklusId)).toEqual({ SPG_COMMISSION_EXPENSE: 1_004_000, COMMISSION_PAYABLE: -1_004_000 });
    expect(await jumlahGenerasi(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toBe(3);

    // Pembayaran toko: piutang konsinyasi berkurang; dibatalkan → dibalik.
    const bayar = await catatPembayaranToko({ cycleId: siklusId, jumlah: 150_000, tanggal: wib("2004-10-05"), cara: "transfer", olehUserId: adminId });
    if (!bayar.ok) throw new Error(`bayar gagal: ${bayar.alasan}`);
    await selaraskanJurnalBayarTokoKonsi(bayar.id, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI, bayar.id)).toEqual({ BANK: 150_000, AR_CONSIGNMENT: -150_000 });
    expect(await batalkanPembayaranToko({ paymentId: bayar.id, alasan: "uji", olehUserId: adminId })).toMatchObject({ ok: true });
    await selaraskanJurnalBayarTokoKonsi(bayar.id, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI, bayar.id)).toEqual({});

    // Gaji dibayar: hutang komisi lunas dari bank.
    const [k] = await prisma.consignmentCommission.findMany({ where: { cycleId: siklusId }, select: { id: true } });
    expect(await bayarKomisi({ commissionId: k.id, olehUserId: adminId })).toEqual({ ok: true });
    expect(await postJurnalBayarGajiKonsi(k.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.BAYAR_GAJI_KONSI, k.id)).toEqual({ COMMISSION_PAYABLE: 1_004_000, BANK: -1_004_000 });
  });

  it("PPN per toko (Elorae PKP dipalsukan): dibekukan saat dikunci; sakelar toko diubah tidak mengubah siklus terkunci; buka-kunci-ulang menyesuaikan dan setiap generasi seimbang", async () => {
    h.ppn = { ...PPN_BAWAAN, statusPkp: "PKP", berlakuSejak: null };
    const kiriman = await kirim(4);
    await postJurnalKirimKonsi(kiriman, adminId);
    await siklusDenganLaporan(3);
    // Bawaan toko: tagihan konsinyasi TANPA PPN.
    expect(await kunci(3)).toMatchObject({ ok: true });
    expect((await prisma.consignmentCycle.findUnique({ where: { id: siklusId }, select: { vatApplied: true } }))?.vatApplied).toBe(false);
    await selaraskanJurnalSiklusKonsi(siklusId, adminId);
    const tanpaPpn = { AR_CONSIGNMENT: 225_000, SALES_REVENUE: -225_000, COGS: 150_000, INVENTORY_CONSIGNMENT: -150_000 };
    expect(await saldoPeran(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toEqual(tanpaPpn);

    // Sakelar toko dinyalakan: siklus yang sudah dikunci tidak berubah diam-diam.
    await prisma.store.update({ where: { id: tokoId }, data: { consignmentVat: true } });
    expect(await selaraskanJurnalSiklusKonsi(siklusId, adminId)).toMatchObject({ ok: true, created: false });
    expect(await saldoPeran(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toEqual(tanpaPpn);

    // Buka kunci → kunci ulang: membaca sakelar baru, PPN dipisah dari tagihan.
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
    expect((await prisma.consignmentCycle.findUnique({ where: { id: siklusId }, select: { vatApplied: true } }))?.vatApplied).toBeNull();
    await selaraskanJurnalSiklusKonsi(siklusId, adminId);
    expect(await kunci(3)).toMatchObject({ ok: true });
    await selaraskanJurnalSiklusKonsi(siklusId, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toEqual({
      AR_CONSIGNMENT: 225_000,
      SALES_REVENUE: -202_703,
      PPN_KELUARAN: -22_297,
      COGS: 150_000,
      INVENTORY_CONSIGNMENT: -150_000,
    });

    // Dimatikan lagi → kembali tanpa PPN.
    await prisma.store.update({ where: { id: tokoId }, data: { consignmentVat: false } });
    expect(await bukaKunci({ cycleId: siklusId, olehUserId: adminId })).toEqual({ ok: true });
    expect(await kunci(3)).toMatchObject({ ok: true });
    await selaraskanJurnalSiklusKonsi(siklusId, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toEqual(tanpaPpn);

    // Setiap generasi seimbang sendiri (mesin selaras hanya memposting selisih).
    const generasi = await prisma.journal.findMany({
      where: { sourceType: SUMBER_OPERASIONAL.SIKLUS_KONSI, OR: [{ sourceId: siklusId }, { sourceId: { startsWith: `${siklusId}#` } }] },
      select: { lines: { select: { debit: true, credit: true } } },
    });
    expect(generasi.length).toBeGreaterThanOrEqual(4);
    for (const j of generasi) {
      const selisih = j.lines.reduce((n, l) => n + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100), 0);
      expect(selisih).toBe(0);
    }
  });

  it("siklus yang belum dikunci tidak dijurnal; periode sebelum tanggal mulai juga tidak", async () => {
    await siklusDenganLaporan(1);
    expect(await selaraskanJurnalSiklusKonsi(siklusId, adminId)).toEqual({ ok: false, code: "BELUM_BERLAKU" });
    h.mulai = wib("2004-12-01");
    expect(await kunci(1)).toMatchObject({ ok: true });
    expect(await selaraskanJurnalSiklusKonsi(siklusId, adminId)).toEqual({ ok: false, code: "BELUM_BERLAKU" });
    h.mulai = null;
    expect(await selaraskanJurnalSiklusKonsi(siklusId, adminId)).toEqual({ ok: false, code: "GL_CUTOVER_NOT_CONFIGURED" });
  });
});

describe("konsinyasi: pindah barang per pengiriman (KonsiTransfer)", () => {
  const PINDAH = SUMBER_OPERASIONAL.PINDAH_KONSI;
  let nomorTransfer = 0;

  /** Pesanan konsinyasi yang disetujui (persetujuan hanya mencadangkan — tidak berjurnal). */
  async function pesananKonsi() {
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}/KONSI/${urut}`,
        storeId: tokoId,
        salesmanId: adminId,
        orderType: "KONSI",
        status: "APPROVED",
        approvedAt: wib("2004-09-01"),
        subtotal: 0,
        total: 0,
      },
    });
    const baris = await prisma.fieldSalesOrderLine.create({
      data: { orderId: o.id, itemId: barangId, productName: `${tag} Kaos`, qty: 100, unitPrice: 0, lineTotal: 0 },
    });
    return { orderId: o.id, lineId: baris.id, orderNo: o.orderNo };
  }

  /**
   * Bentuk yang ditulis `issueKonsiTransfer` saat pengiriman selesai: satu transfer per pengiriman,
   * baris = qty terkirim × harga rata-rata gudang saat itu, penyesuaian stok KONSI_TRANSFER TANPA kunci.
   */
  async function transfer(p: { orderId: string; lineId: string }, isi: Array<{ qty: number; unitCost: number; itemId?: string }>, createdAt: Date) {
    nomorTransfer += 1;
    const shipmentId = `${tag}-SHP-${urut}-${nomorTransfer}`;
    const t = await prisma.konsiTransfer.create({
      data: { docNo: `${tag}/KTRF/${urut}/${nomorTransfer}`, orderId: p.orderId, storeId: tokoId, transferredById: adminId, shipmentId, createdAt },
    });
    await prisma.konsiTransferLine.createMany({
      data: isi.map((l) => ({ transferId: t.id, orderLineId: p.lineId, itemId: l.itemId ?? barangId, productName: `${tag} Kaos`, qty: l.qty, unitCost: l.unitCost })),
    });
    for (const l of isi) {
      await prisma.stockAdjustment.create({
        data: {
          docNumber: `${tag}-KTRF-${urut}-${nomorTransfer}-${l.itemId ?? barangId}`,
          itemId: l.itemId ?? barangId,
          type: "NEGATIVE",
          qtyChange: -l.qty,
          reason: `Konsi transfer ${tag}/KTRF/${urut}/${nomorTransfer}`,
          prevQty: 100,
          newQty: 100 - l.qty,
          prevAvgCost: l.unitCost,
          newAvgCost: l.unitCost,
          source: "KONSI_TRANSFER",
          createdAt,
        },
      });
    }
    return { id: t.id, shipmentId, docNo: t.docNo };
  }

  it("pesanan dikirim 60 lalu 40: dua jurnal pindah ke persediaan konsinyasi, masing-masing pada hari barangnya pindah; idempoten", async () => {
    const p = await pesananKonsi();
    const a = await transfer(p, [{ qty: 60, unitCost: 40_000 }], wib("2004-09-03"));
    const b = await transfer(p, [{ qty: 40, unitCost: 40_000 }, { qty: 2, unitCost: 10_000, itemId: kainId }], wib("2004-09-10"));

    expect(await postJurnalPindahKonsi(a.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await postJurnalPindahKonsi(b.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(PINDAH, a.id)).toEqual({ INVENTORY_CONSIGNMENT: 2_400_000, INVENTORY_FG: -2_400_000 });
    // Barang jadi ke persediaan barang jadi, kain ke persediaan bahan — pemisahan yang sama dengan kiriman titipan.
    expect(await saldoPeran(PINDAH, b.id)).toEqual({ INVENTORY_CONSIGNMENT: 1_620_000, INVENTORY_FG: -1_600_000, INVENTORY: -20_000 });

    const jurnalA = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: PINDAH, sourceId: a.id } },
      select: { date: true, description: true, lines: { select: { chartAccountId: true, storeId: true } } },
    });
    expect(jurnalA.date.toISOString()).toBe(wib("2004-09-03").toISOString());
    expect(jurnalA.description).toContain(a.docNo);
    expect(jurnalA.description).toContain(p.orderNo);
    expect(jurnalA.lines.find((l) => l.chartAccountId === h.akun.get("INVENTORY_CONSIGNMENT"))?.storeId).toBe(tokoId);

    expect(await postJurnalPindahKonsi(a.id, adminId)).toMatchObject({ ok: true, created: false });
    expect(await jumlahGenerasi(PINDAH, a.id)).toBe(1);

    // Sumber pesanan lama tidak menjurnal barang yang sama: penyesuaian pengiriman tidak berkunci `konsi-transfer-line-`.
    expect(await postJurnalPesananKonsi(p.orderId, adminId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    expect(await cariPesananKonsiTanpaJurnal({ sejak: wib("2004-08-01"), sampai: wib("2004-12-31"), batas: 500, ids: [p.orderId] })).toEqual([]);
    expect(await jumlahGenerasi(SUMBER_OPERASIONAL.PESANAN_KONSI, p.orderId)).toBe(0);
  });

  it("pencari: hanya transfer bernilai yang belum berjurnal, dalam cakupan id dan rentang tanggalnya", async () => {
    const p = await pesananKonsi();
    const a = await transfer(p, [{ qty: 5, unitCost: 40_000 }], wib("2004-09-03"));
    const nol = await transfer(p, [{ qty: 5, unitCost: 0 }], wib("2004-09-04"));
    const opsi = { sejak: wib("2004-09-01"), sampai: wib("2004-09-30"), batas: 500, ids: [a.id, nol.id] };

    const temu = await cariPindahKonsiTanpaJurnal(opsi);
    expect(temu.map((d) => d.id)).toEqual([a.id]);
    expect(temu[0].label).toBe(a.docNo);
    // Pencari dan penulis sepakat: transfer tanpa harga tidak pernah tampil "tanpa jurnal".
    expect(await postJurnalPindahKonsi(nol.id, adminId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });

    expect(await cariPindahKonsiTanpaJurnal({ ...opsi, ids: [] })).toEqual([]);
    expect(await cariPindahKonsiTanpaJurnal({ ...opsi, sejak: wib("2004-10-01"), sampai: wib("2004-10-31") })).toEqual([]);

    await postJurnalPindahKonsi(a.id, adminId);
    expect(await cariPindahKonsiTanpaJurnal(opsi)).toEqual([]);
  });

  it("gerbang tanggal mulai buku besar: sebelum tanggal mulai tidak dijurnal; tanpa tanggal mulai tidak ada yang dijurnal", async () => {
    const p = await pesananKonsi();
    const a = await transfer(p, [{ qty: 1, unitCost: 40_000 }], wib("2004-09-03"));
    h.mulai = wib("2004-09-05");
    expect(await postJurnalPindahKonsi(a.id, adminId)).toEqual({ ok: false, code: "BELUM_BERLAKU" });
    h.mulai = null;
    expect(await postJurnalPindahKonsi(a.id, adminId)).toEqual({ ok: false, code: "GL_CUTOVER_NOT_CONFIGURED" });
    expect(await jumlahGenerasi(PINDAH, a.id)).toBe(0);
  });

  it("kait per pengiriman: menjurnal transfer pengiriman itu, ulangan tidak menambah, tidak pernah melempar; peran belum dipetakan → JOURNAL_PENDING bernomor", async () => {
    const p = await pesananKonsi();
    const a = await transfer(p, [{ qty: 3, unitCost: 40_000 }], wib("2004-09-03"));

    delete process.env.JURNAL_OPERASIONAL_KAIT_UJI;
    try {
      await kaitPindahKonsiPengiriman(a.shipmentId, adminId);
      expect(await jumlahGenerasi(PINDAH, a.id)).toBe(0);
    } finally {
      process.env.JURNAL_OPERASIONAL_KAIT_UJI = "1";
    }

    await kaitPindahKonsiPengiriman(a.shipmentId, adminId);
    expect(await saldoPeran(PINDAH, a.id)).toEqual({ INVENTORY_CONSIGNMENT: 120_000, INVENTORY_FG: -120_000 });
    // Ulangan (replay penyelesaian yang sama) tidak menambah jurnal.
    await kaitPindahKonsiPengiriman(a.shipmentId, adminId);
    expect(await jumlahGenerasi(PINDAH, a.id)).toBe(1);
    // Pengiriman tanpa transfer (putus, atau konsi tanpa barang terkirim) dan id kosong: diam.
    await expect(kaitPindahKonsiPengiriman(`${tag}-tanpa-transfer`, adminId)).resolves.toBeUndefined();
    await expect(kaitPindahKonsiPengiriman("", adminId)).resolves.toBeUndefined();

    const b = await transfer(p, [{ qty: 1, unitCost: 40_000 }], wib("2004-09-04"));
    const akunKonsi = h.akun.get("INVENTORY_CONSIGNMENT")!;
    h.akun.delete("INVENTORY_CONSIGNMENT");
    try {
      await expect(kaitPindahKonsiPengiriman(b.shipmentId, adminId)).resolves.toBeUndefined();
    } finally {
      h.akun.set("INVENTORY_CONSIGNMENT", akunKonsi);
    }
    expect(await jumlahGenerasi(PINDAH, b.id)).toBe(0);
    const tanda = (
      await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING", createdAt: { gte: mulaiTes } }, select: { title: true, metadata: true } })
    ).filter((n) => (n.metadata as Record<string, unknown>)?.docId === b.id);
    expect(tanda).toHaveLength(1);
    expect(tanda[0].metadata).toMatchObject({ kind: "konsi_pindah", reason: "UNMAPPED_ROLE", role: "INVENTORY_CONSIGNMENT" });
    expect(tanda[0].title).toContain(b.docNo);

    // Sesudah dipetakan, kait yang sama (mis. ulangan penyelesaian) memostingnya.
    await kaitPindahKonsiPengiriman(b.shipmentId, adminId);
    expect(await jumlahGenerasi(PINDAH, b.id)).toBe(1);
  });
});

describe("konsinyasi: konfirmasi sampai pesanan konsi lama (KonsiTransfer tanpa pengiriman)", () => {
  const PINDAH = SUMBER_OPERASIONAL.PINDAH_KONSI;
  let nomor = 0;

  /**
   * Bentuk yang ditulis `konfirmasiSampaiPesananLama` lewat `issueKonsiTransfer`: transfer tanpa
   * pengiriman bertanda `oldOrderArrival`; baris yang gudangnya sudah diopname sesudah pesanan
   * disetujui membawa `mainCountedByOpnameId` dan tidak memotong kartu stok gudang.
   */
  async function sampai(isi: Array<{ qty: number; unitCost: number; itemId?: string; opnameId?: string | null }>, createdAt: Date) {
    nomor += 1;
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}/KONSI-LAMA/${urut}/${nomor}`,
        storeId: tokoId,
        salesmanId: adminId,
        orderType: "KONSI",
        status: "APPROVED",
        approvedAt: wib("2004-08-01"),
        subtotal: 0,
        total: 0,
      },
    });
    const baris = await prisma.fieldSalesOrderLine.create({
      data: { orderId: o.id, itemId: barangId, productName: `${tag} Kaos`, qty: 100, unitPrice: 0, lineTotal: 0 },
    });
    const t = await prisma.konsiTransfer.create({
      data: { docNo: `${tag}/KTRF-LAMA/${urut}/${nomor}`, orderId: o.id, storeId: tokoId, transferredById: adminId, oldOrderArrival: true, createdAt },
    });
    await prisma.konsiTransferLine.createMany({
      data: isi.map((l) => ({
        transferId: t.id,
        orderLineId: baris.id,
        itemId: l.itemId ?? barangId,
        productName: `${tag} Kaos`,
        qty: l.qty,
        unitCost: l.unitCost,
        mainCountedByOpnameId: l.opnameId ?? null,
      })),
    });
    return { id: t.id, docNo: t.docNo, orderNo: o.orderNo };
  }

  it("biasa: DR persediaan konsinyasi / CR persediaan gudang, bertanggal konfirmasinya, satu jurnal per transfer", async () => {
    const a = await sampai([{ qty: 10, unitCost: 40_000 }], wib("2004-11-05"));
    expect(await postJurnalPindahKonsi(a.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(PINDAH, a.id)).toEqual({ INVENTORY_CONSIGNMENT: 400_000, INVENTORY_FG: -400_000 });
    const j = await prisma.journal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: PINDAH, sourceId: a.id } },
      select: { date: true, description: true },
    });
    expect(j.date.toISOString()).toBe(wib("2004-11-05").toISOString());
    expect(j.description).toContain(a.orderNo);
    expect(await postJurnalPindahKonsi(a.id, adminId)).toMatchObject({ ok: true, created: false });
  });

  it("gudang sudah diopname sesudah disetujui: kreditnya Selisih persediaan (akun jurnal opname), TIDAK persediaan gudang", async () => {
    const a = await sampai(
      [
        { qty: 6, unitCost: 40_000, opnameId: `${tag}-OPN` },
        { qty: 2, unitCost: 10_000, itemId: kainId },
      ],
      wib("2004-11-06"),
    );
    expect(await postJurnalPindahKonsi(a.id, adminId)).toMatchObject({ ok: true, created: true });
    // Baris yang sudah diopname: 240.000 dari Selisih; kain biasa: 20.000 dari persediaan bahan.
    expect(await saldoPeran(PINDAH, a.id)).toEqual({ INVENTORY_CONSIGNMENT: 260_000, INVENTORY_VARIANCE: -240_000, INVENTORY: -20_000 });
  });

  it("gerbang tanggal mulai buku besar sama dengan saudaranya; kait per transfer tidak pernah melempar dan idempoten", async () => {
    const a = await sampai([{ qty: 1, unitCost: 40_000 }], wib("2004-11-07"));
    h.mulai = wib("2004-11-08");
    expect(await postJurnalPindahKonsi(a.id, adminId)).toEqual({ ok: false, code: "BELUM_BERLAKU" });
    h.mulai = wib("2004-01-01");
    await kaitPindahKonsiTransfer(a.id, adminId);
    await kaitPindahKonsiTransfer(a.id, adminId);
    expect(await jumlahGenerasi(PINDAH, a.id)).toBe(1);
    await expect(kaitPindahKonsiTransfer("", adminId)).resolves.toBeUndefined();
    // Sapuan menemukan transfer konfirmasi seperti transfer pengiriman.
    const b = await sampai([{ qty: 1, unitCost: 40_000 }], wib("2004-11-07"));
    const temu = await cariPindahKonsiTanpaJurnal({ sejak: wib("2004-11-01"), sampai: wib("2004-11-30"), batas: 500, ids: [a.id, b.id] });
    expect(temu.map((d) => d.id)).toEqual([b.id]);
  });
});

describe("retur lapangan dari toko konsinyasi (FieldReturn)", () => {
  const RETUR = SUMBER_OPERASIONAL.RETUR_LAPANGAN_KONSI;
  let nomorRetur = 0;
  let nomorKirim = 0;

  /** Biaya kirim barang ini ke toko konsinyasi: satu penyesuaian KONSI_TRANSFER sebelum returnya. */
  const biayaKirim = (unitCost: number, itemId = barangId) =>
    prisma.stockAdjustment.create({
      data: {
        docNumber: `${tag}-KIRIM-${urut}-${++nomorKirim}`,
        itemId,
        type: "NEGATIVE",
        qtyChange: -10,
        reason: "Konsi transfer uji",
        prevQty: 100,
        newQty: 90,
        prevAvgCost: unitCost,
        newAvgCost: unitCost,
        source: "KONSI_TRANSFER",
        createdAt: wib("2004-09-02"),
      },
    });

  /** Bentuk yang ditinggalkan `approveFieldReturn`: baris retur + masuk gudang utama di kartu stok. */
  async function returDisetujui(isi: {
    storeId?: string;
    itemId?: string;
    status?: "APPROVED" | "PENDING_APPROVAL";
    credited: number;
    sellable: number;
    rejected: number;
    nilaiMasuk: number | null;
  }) {
    nomorRetur += 1;
    const itemId = isi.itemId ?? barangId;
    const disetujui = (isi.status ?? "APPROVED") === "APPROVED";
    const r = await prisma.fieldReturn.create({
      data: {
        docNo: `${tag}/RTL/${urut}/${nomorRetur}`,
        storeId: isi.storeId ?? tokoId,
        raisedById: adminId,
        status: isi.status ?? "APPROVED",
        approvedAt: disetujui ? wib("2004-09-20") : null,
        approvedById: disetujui ? adminId : null,
      },
    });
    await prisma.fieldReturnLine.create({
      data: {
        returnId: r.id,
        itemId,
        qty: isi.credited,
        reason: "UNSOLD",
        receivedQty: isi.sellable + isi.rejected,
        sellableQty: isi.sellable,
        rejectedQty: isi.rejected,
        creditedQty: disetujui ? isi.credited : null,
      },
    });
    if (disetujui && isi.sellable > 0) {
      await prisma.stockLedgerEntry.create({
        data: {
          locationType: "MAIN",
          itemId,
          type: "IN",
          refType: "FieldReturn",
          refId: r.id,
          refDocNumber: r.docNo,
          qty: isi.sellable,
          unitCost: isi.nilaiMasuk === null ? null : isi.nilaiMasuk / isi.sellable,
          totalCost: isi.nilaiMasuk,
          balanceQty: 100 + isi.sellable,
          balanceValue: isi.nilaiMasuk === null ? null : 0,
        },
      });
    }
    return { id: r.id, docNo: r.docNo };
  }

  it("barang layak kembali ke kartu stok, konsinyasi keluar pada biaya kirim, barang ditolak gudang jadi selisih; idempoten", async () => {
    await biayaKirim(40_000);
    // 5 keluar dari toko; 4 layak masuk gudang pada rata-rata gudang 45.000, 1 ditolak gudang.
    const r = await returDisetujui({ credited: 5, sellable: 4, rejected: 1, nilaiMasuk: 180_000 });
    expect(await postJurnalReturLapanganKonsi(r.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(RETUR, r.id)).toEqual({ INVENTORY_FG: 180_000, INVENTORY_CONSIGNMENT: -200_000, INVENTORY_VARIANCE: 20_000 });
    const konsi = await prisma.journalLine.findFirst({
      where: { journal: { sourceType: RETUR, sourceId: r.id }, chartAccountId: h.akun.get("INVENTORY_CONSIGNMENT") },
      select: { storeId: true, journal: { select: { date: true } } },
    });
    expect(konsi?.storeId).toBe(tokoId);
    expect(konsi?.journal.date.toISOString()).toBe(wib("2004-09-20").toISOString());
    expect(await postJurnalReturLapanganKonsi(r.id, adminId)).toMatchObject({ ok: true, created: false });
    expect(await jumlahGenerasi(RETUR, r.id)).toBe(1);
  });

  it("toko putus, retur belum disetujui, dan nilai masuk yang tidak tercatat tidak dijurnal; pencari sepakat dengan penulisnya", async () => {
    await biayaKirim(40_000);
    const putus = await returDisetujui({ storeId: tokoPutusId, credited: 2, sellable: 2, rejected: 0, nilaiMasuk: 80_000 });
    const belum = await returDisetujui({ status: "PENDING_APPROVAL", credited: 2, sellable: 2, rejected: 0, nilaiMasuk: 80_000 });
    const takTercatat = await returDisetujui({ credited: 2, sellable: 2, rejected: 0, nilaiMasuk: null });
    const sah = await returDisetujui({ credited: 1, sellable: 1, rejected: 0, nilaiMasuk: 40_000 });

    expect(await postJurnalReturLapanganKonsi(putus.id, adminId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    expect(await postJurnalReturLapanganKonsi(belum.id, adminId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    // Persediaan yang masuk tanpa nilai tidak ditebak nol.
    expect(await postJurnalReturLapanganKonsi(takTercatat.id, adminId)).toEqual({ ok: false, code: "BIAYA_TIDAK_DIKETAHUI", detail: takTercatat.docNo });

    const opsi = { sejak: wib("2004-09-01"), sampai: wib("2004-09-30"), batas: 500, ids: [putus.id, belum.id, takTercatat.id, sah.id] };
    expect((await cariReturLapanganKonsiTanpaJurnal(opsi)).map((d) => d.id).sort()).toEqual([takTercatat.id, sah.id].sort());
    expect(await cariReturLapanganKonsiTanpaJurnal({ ...opsi, ids: [] })).toEqual([]);

    await kaitReturLapanganKonsi(sah.id, adminId);
    expect(await saldoPeran(RETUR, sah.id)).toEqual({ INVENTORY_FG: 40_000, INVENTORY_CONSIGNMENT: -40_000 });
    expect((await cariReturLapanganKonsiTanpaJurnal(opsi)).map((d) => d.id)).toEqual([takTercatat.id]);
  });

  it("retur yang semua angkanya nol tidak dicari selamanya; biaya konsinyasi cadangan tetap dicari", async () => {
    // Kain dikirim saat harga rata-ratanya nol, dan kembali bernilai nol di kartu stok gudang utama.
    await biayaKirim(0, kainId);
    const nol = await returDisetujui({ itemId: kainId, credited: 2, sellable: 2, rejected: 0, nilaiMasuk: 0 });
    // Semua ditolak gudang, biaya kirimnya nol: tidak ada yang masuk, tidak ada yang keluar bernilai.
    const ditolakNol = await returDisetujui({ itemId: kainId, credited: 1, sellable: 0, rejected: 1, nilaiMasuk: null });
    // Kaos tanpa kiriman tercatat: biayanya cadangan dari harga rata-rata gudang (50.000); semua ditolak gudang.
    const cadangan = await returDisetujui({ credited: 1, sellable: 0, rejected: 1, nilaiMasuk: null });

    const opsi = { sejak: wib("2004-09-01"), sampai: wib("2004-09-30"), batas: 500, ids: [nol.id, ditolakNol.id, cadangan.id] };
    expect((await cariReturLapanganKonsiTanpaJurnal(opsi)).map((d) => d.id)).toEqual([cadangan.id]);

    expect(await postJurnalReturLapanganKonsi(nol.id, adminId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    expect(await postJurnalReturLapanganKonsi(ditolakNol.id, adminId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    expect(await postJurnalReturLapanganKonsi(cadangan.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(RETUR, cadangan.id)).toEqual({ INVENTORY_CONSIGNMENT: -50_000, INVENTORY_VARIANCE: 50_000 });
    expect(await cariReturLapanganKonsiTanpaJurnal(opsi)).toEqual([]);
  });
});

describe("retur dari toko konsinyasi dan gudang barang rusak", () => {
  it("layak kembali ke kartu stok, rusak ke gudang rusak sebesar nilai gerakannya, konsinyasi keluar pada biaya kirim, beda harga ke selisih", async () => {
    const kiriman = await kirim(4);
    await postJurnalKirimKonsi(kiriman, adminId);
    // Harga rata-rata gudang naik sesudah barangnya dikirim (mis. ada pembelian baru).
    await prisma.inventoryValue.update({ where: { id: invIds[0] }, data: { avgCost: 60_000 } });

    const r = await catatHitunganGudang({
      storeId: tokoId,
      warehouseUserId: gudangId,
      receivedAt: new Date(),
      deliveryMethod: "SALES",
      items: [
        { itemId: barangId, variantSku: "", itemName: `${tag} Kaos`, qty: 1, price: 75_000, condition: "LAYAK" },
        { itemId: barangId, variantSku: "", itemName: `${tag} Kaos`, qty: 3, price: 75_000, condition: "RUSAK" },
      ],
    });
    if (!r.ok) throw new Error(`hitungan gagal: ${r.alasan}`);
    // Nilai gerakan masuk gudang rusak ditulis bersama hitungannya.
    const masuk = await prisma.damagedStockMovement.findMany({ where: { itemId: barangId, kind: "MASUK_RETUR" }, select: { value: true, qty: true } });
    expect(masuk.map((m) => [m.qty, Number(m.value)])).toEqual([[3, 180_000]]);

    // Kait lapangan menyelaraskan dua pasangan: jurnal retur putus (kosong untuk konsinyasi) dan jurnal konsinyasi.
    await kaitReturBerubah({ nriIds: [r.id] }, gudangId);
    expect(await jumlahGenerasi(SUMBER_LAPANGAN.RETUR, r.id)).toBe(0);
    expect(await saldoPeran(SUMBER_OPERASIONAL.RETUR_KONSI, r.id)).toEqual({
      INVENTORY_FG: 60_000,
      INVENTORY_DAMAGED: 180_000,
      INVENTORY_CONSIGNMENT: -200_000,
      INVENTORY_VARIANCE: -40_000,
    });
    // Diselaraskan lagi: tidak berubah.
    expect(await selaraskanJurnalReturKonsi(r.id, gudangId)).toMatchObject({ ok: true, created: false });

    // Gudang rusak: musnahkan 1 → beban sebesar nilai rata-ratanya.
    const musnah = await putuskanGudangRusak({ itemId: barangId, variantSku: "", keputusan: "MUSNAHKAN", qty: 1, catatan: "uji", olehUserId: adminId });
    if (!musnah.ok) throw new Error(`musnahkan gagal: ${musnah.alasan}`);
    expect(Number((await prisma.damagedStockMovement.findUniqueOrThrow({ where: { id: musnah.gerakId } })).value)).toBe(60_000);
    expect(await postJurnalGudangRusak(musnah.gerakId, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.GUDANG_RUSAK, musnah.gerakId)).toEqual({ LOSS_EXPENSE: 60_000, INVENTORY_DAMAGED: -60_000 });

    // Perbaiki 1 sesudah harga rata-rata gudang naik lagi: masuk kartu stok pada harga baru, beda ke selisih.
    await prisma.inventoryValue.update({ where: { id: invIds[0] }, data: { avgCost: 65_000 } });
    const baik = await putuskanGudangRusak({ itemId: barangId, variantSku: "", keputusan: "PERBAIKI", qty: 1, catatan: "uji", olehUserId: adminId });
    if (!baik.ok) throw new Error(`perbaiki gagal: ${baik.alasan}`);
    expect(await postJurnalGudangRusak(baik.gerakId, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.GUDANG_RUSAK, baik.gerakId)).toEqual({ INVENTORY_FG: 65_000, INVENTORY_DAMAGED: -60_000, INVENTORY_VARIANCE: -5_000 });

    // Jual obral 1 dengan hasil Rp20.000: `value` tetap HASIL JUAL (layar gudang rusak), biayanya dari jejak keputusan.
    const obral = await putuskanGudangRusak({ itemId: barangId, variantSku: "", keputusan: "JUAL_OBRAL", qty: 1, catatan: "uji", nilai: 20_000, olehUserId: adminId });
    if (!obral.ok) throw new Error(`obral gagal: ${obral.alasan}`);
    expect(Number((await prisma.damagedStockMovement.findUniqueOrThrow({ where: { id: obral.gerakId } })).value)).toBe(20_000);
    expect(await postJurnalGudangRusak(obral.gerakId, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.GUDANG_RUSAK, obral.gerakId)).toEqual({
      COGS: 60_000,
      INVENTORY_DAMAGED: -60_000,
      CASH: 20_000,
      SALES_REVENUE: -20_000,
    });

    // Gudang rusak barang ini kosong dan bernilai nol — sama dengan buku besarnya.
    const sisa = await putarBarangRusak(prisma, barangId, "");
    expect(sisa).toMatchObject({ qty: 0, sen: 0 });
  });
});

describe("barang hilang di toko konsinyasi", () => {
  it("diputuskan → beban sebesar biaya kirim; dibatalkan → dibalik", async () => {
    const kiriman = await kirim(4);
    await postJurnalKirimKonsi(kiriman, adminId);
    const buat = await buatBarangHilang({
      storeId: tokoId,
      baris: [{ itemId: barangId, variantSku: "", qty: 1 }],
      catatan: "uji",
      idempotencyKey: `${tag}-hilang-${urut}`,
      userId: adminId,
    });
    if (!buat.ok) throw new Error(`catat hilang gagal: ${buat.kode}`);
    lossIds.push(buat.id);
    // Belum diputuskan: belum ada jurnal.
    expect(await selaraskanJurnalBarangHilang(buat.id, adminId)).toEqual({ ok: false, code: "BELUM_BERLAKU" });
    const loss = await prisma.stockLoss.findUniqueOrThrow({ where: { id: buat.id }, select: { totalAmount: true } });
    const putus = await putuskanBarangHilang({
      lossId: buat.id,
      bagian: [{ bearer: "ELORAE", bearerUserId: null, amount: Number(loss.totalAmount) }],
      olehUserId: adminId,
    });
    expect(putus).toMatchObject({ ok: true });
    await selaraskanJurnalBarangHilang(buat.id, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.BARANG_HILANG, buat.id)).toEqual({ LOSS_EXPENSE: 50_000, INVENTORY_CONSIGNMENT: -50_000 });
    expect(await batalkanBarangHilang({ lossId: buat.id, alasan: "ketemu", olehUserId: adminId })).toMatchObject({ ok: true });
    await selaraskanJurnalBarangHilang(buat.id, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.BARANG_HILANG, buat.id)).toEqual({});
    expect(await jumlahGenerasi(SUMBER_OPERASIONAL.BARANG_HILANG, buat.id)).toBe(2);
  });
});

describe("komisi SPG toko putus dan potongan beban sales", () => {
  it("per toko × bulan diselaraskan; penetapan ulang menyesuaikan; pembayaran per baris", async () => {
    const a = await prisma.spgCommission.create({
      data: { userId: spgId, storeId: tokoPutusId, period: "2004-03", unitsSold: 10, commission: 300_000, deduction: 50_000, basis: "PER_SPG", lockedById: adminId },
    });
    const b = await prisma.spgCommission.create({
      data: { userId: adminId, storeId: tokoPutusId, period: "2004-03", unitsSold: 5, commission: 200_000, basis: "PER_SPG", lockedById: adminId },
    });
    const id = idKomisiSpg(tokoPutusId, "2004-03");
    expect(await selaraskanJurnalKomisiSpg(tokoPutusId, "2004-03", adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.KOMISI_SPG, id)).toEqual({ SPG_COMMISSION_EXPENSE: 500_000, COMMISSION_PAYABLE: -450_000, LOSS_RECOVERY: -50_000 });
    const beban = await prisma.journalLine.findFirst({
      where: { journal: { sourceType: SUMBER_OPERASIONAL.KOMISI_SPG, sourceId: id }, chartAccountId: h.akun.get("SPG_COMMISSION_EXPENSE") },
      select: { channel: true, storeId: true },
    });
    expect(beban).toMatchObject({ channel: "PUTUS", storeId: tokoPutusId });

    await prisma.spgCommission.delete({ where: { id: b.id } });
    await selaraskanJurnalKomisiSpg(tokoPutusId, "2004-03", adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.KOMISI_SPG, id)).toEqual({ SPG_COMMISSION_EXPENSE: 300_000, COMMISSION_PAYABLE: -250_000, LOSS_RECOVERY: -50_000 });
    expect(await jumlahGenerasi(SUMBER_OPERASIONAL.KOMISI_SPG, id)).toBe(2);

    await prisma.spgCommission.update({ where: { id: a.id }, data: { paidAt: wib("2004-04-05"), paidById: adminId } });
    expect(await postJurnalBayarKomisiSpg(a.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.BAYAR_KOMISI_SPG, a.id)).toEqual({ COMMISSION_PAYABLE: 250_000, BANK: -250_000 });

    const d = await prisma.stockLossDeduction.create({
      data: { shareId: `${tag}-share`, amount: 40_000, refType: "KomisiSalesman", refId: `${tag}:2004-03:k${urut}`, createdById: adminId },
    });
    expect(await postJurnalPotongSales(d.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.POTONG_SALES, d.id)).toEqual({ SALES_COMMISSION_EXPENSE: 40_000, LOSS_RECOVERY: -40_000 });
  });
});

describe("stok manual, retur pemasok, biaya perjalanan", () => {
  it("penyesuaian manual: perubahan nilai kartu stok melawan selisih persediaan; impor stok awal tidak dijurnal", async () => {
    const adj = await prisma.stockAdjustment.create({
      data: {
        docNumber: `${tag}-ADJ-${urut}`,
        itemId: barangId,
        type: "NEGATIVE",
        qtyChange: 3,
        reason: "rusak di rak",
        prevQty: 100,
        newQty: 97,
        prevAvgCost: 50_000,
        newAvgCost: 50_000,
        createdAt: wib("2004-09-15"),
      },
    });
    const temu = await cariStokManualTanpaJurnal({ sejak: wib("2004-09-14"), sampai: wib("2004-09-16"), batas: 500 });
    expect(temu.map((d) => d.id)).toContain(adj.id);
    expect(await postJurnalStokManual(adj.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.STOK_MANUAL, adj.id)).toEqual({ INVENTORY_FG: -150_000, INVENTORY_VARIANCE: 150_000 });
    expect((await cariStokManualTanpaJurnal({ sejak: wib("2004-09-14"), sampai: wib("2004-09-16"), batas: 500 })).map((d) => d.id)).not.toContain(adj.id);

    const awal = await prisma.stockAdjustment.create({
      data: {
        docNumber: `${tag}-ADJ-AWAL-${urut}`,
        itemId: barangId,
        type: "POSITIVE",
        qtyChange: 5,
        reason: "UMKM opening balance reconciliation (one-time); cutoff=2004-01-01",
        prevQty: 97,
        newQty: 102,
        prevAvgCost: 50_000,
        newAvgCost: 50_000,
        source: "ERP",
      },
    });
    expect(await postJurnalStokManual(awal.id, adminId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
  });

  const returPemasokSelesai = (akhiran: string) =>
    prisma.vendorReturn.create({
      data: {
        docNumber: `${tag}-RET-${urut}${akhiran}`,
        vendorId: pemasokId,
        lines: JSON.stringify([{ type: "FABRIC", itemId: kainId, qty: 10, costValue: 100_000 }]),
        totalItems: 10,
        totalValue: 100_000,
        status: "COMPLETED",
        completedAt: wib("2004-09-20"),
        createdById: adminId,
        poId: `${tag}-po`,
        poCreditAmount: 111_000,
      },
    });
  const keluarBukuBesar = (ret: { id: string; docNumber: string }, totalCost: number | null) =>
    prisma.stockLedgerEntry.create({
      data: {
        locationType: "MAIN",
        itemId: kainId,
        type: "OUT",
        refType: "VendorReturn",
        refId: ret.id,
        refDocNumber: ret.docNumber,
        qty: -10,
        unitCost: totalCost === null ? null : totalCost / 10,
        totalCost,
        balanceQty: 0,
        balanceValue: totalCost === null ? null : 0,
      },
    });
  const keluarArsip = (ret: { id: string; docNumber: string }, totalCost: number) =>
    prisma.stockMovement.create({
      data: { itemId: kainId, type: "OUT", refType: "VENDOR_RETURN", refId: ret.id, refDocNumber: ret.docNumber, qty: -10, unitCost: totalCost / 10, totalCost, balanceQty: 0, balanceValue: 0 },
    });

  it("retur pemasok selesai: hutang berkurang kredit PO, persediaan keluar sebesar kartu stok, beda ke selisih", async () => {
    const ret = await returPemasokSelesai("");
    await keluarBukuBesar(ret, 100_000);
    expect(await postJurnalReturPemasok(ret.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.RETUR_PEMASOK, ret.id)).toEqual({ AP: 111_000, INVENTORY: -100_000, INVENTORY_VARIANCE: -11_000 });
  });

  it("retur pemasok lama: nilai keluarnya dari arsip bila buku besar stok tidak punya nilai; tidak tercatat di mana pun → ditolak", async () => {
    // Sebelum buku besar stok: hanya arsip.
    const lama = await returPemasokSelesai("-L");
    await keluarArsip(lama, 100_000);
    expect(await postJurnalReturPemasok(lama.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.RETUR_PEMASOK, lama.id)).toEqual({ AP: 111_000, INVENTORY: -100_000, INVENTORY_VARIANCE: -11_000 });

    // Baris buku besar tanpa nilai: arsip yang memegang nilainya.
    const campur = await returPemasokSelesai("-C");
    await keluarBukuBesar(campur, null);
    await keluarArsip(campur, 90_000);
    expect(await postJurnalReturPemasok(campur.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.RETUR_PEMASOK, campur.id)).toEqual({ AP: 111_000, INVENTORY: -90_000, INVENTORY_VARIANCE: -21_000 });

    // Tercatat di keduanya: buku besar dipakai, tidak dijumlahkan.
    const ganda = await returPemasokSelesai("-G");
    await keluarBukuBesar(ganda, 100_000);
    await keluarArsip(ganda, 100_000);
    expect(await postJurnalReturPemasok(ganda.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.RETUR_PEMASOK, ganda.id)).toEqual({ AP: 111_000, INVENTORY: -100_000, INVENTORY_VARIANCE: -11_000 });

    // Tanpa nilai di mana pun: persediaan yang keluar tidak ditebak nol.
    const takTercatat = await returPemasokSelesai("-T");
    await keluarBukuBesar(takTercatat, null);
    expect(await postJurnalReturPemasok(takTercatat.id, adminId)).toEqual({
      ok: false,
      code: "BIAYA_TIDAK_DIKETAHUI",
      detail: takTercatat.docNumber,
    });
  });

  it("biaya perjalanan disetujui → beban + hutang penggantian; dibayar dari rekening yang dipilih", async () => {
    const k = await prisma.expenseClaim.create({
      data: { userId: spgId, spentAt: wib("2004-09-03"), category: "BENSIN", amount: 75_000, status: "DISETUJUI", reviewedById: adminId, reviewedAt: wib("2004-09-04") },
    });
    expect(await postJurnalBiayaPerjalanan(k.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.BIAYA_PERJALANAN, k.id)).toEqual({ TRAVEL_EXPENSE: 75_000, REIMBURSE_PAYABLE: -75_000 });
    // Belum dibayar: belum ada yang dijurnal.
    expect(await postJurnalBayarBiayaPerjalanan(k.id, adminId)).toEqual({ ok: false, code: "NOTHING_TO_POST" });
    await prisma.expenseClaim.update({ where: { id: k.id }, data: { status: "DIBAYAR", paidById: adminId, paidAt: wib("2004-09-06"), paidAccountId: rekeningLainId } });
    expect(await postJurnalBayarBiayaPerjalanan(k.id, adminId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(SUMBER_OPERASIONAL.BAYAR_BIAYA_PERJALANAN, k.id)).toEqual({ REIMBURSE_PAYABLE: 75_000, BANK2: -75_000 });
  });
});

describe("tertunda, sapuan, registri", () => {
  it("peran belum dipetakan → JOURNAL_PENDING bernomor dokumen; sesudah dipetakan, posting ulang menyelesaikannya", async () => {
    const id = await kirim(2);
    const temu = await cariKirimKonsiTanpaJurnal({ sejak: wib("2004-09-09"), sampai: wib("2004-09-11"), batas: 500 });
    expect(temu.map((d) => d.id)).toContain(id);

    const akunKonsi = h.akun.get("INVENTORY_CONSIGNMENT")!;
    h.akun.delete("INVENTORY_CONSIGNMENT");
    try {
      const gagal = await postingJurnalOperasionalAman(SUMBER_OPERASIONAL.KIRIM_KONSI, id, adminId);
      expect(gagal).toMatchObject({ ok: false, code: "UNMAPPED_ROLE", role: "INVENTORY_CONSIGNMENT" });
      // Gagal dua kali dengan sebab sama = satu notifikasi.
      await postingJurnalOperasionalAman(SUMBER_OPERASIONAL.KIRIM_KONSI, id, adminId);
    } finally {
      h.akun.set("INVENTORY_CONSIGNMENT", akunKonsi);
    }
    const tanda = (
      await prisma.adminNotification.findMany({
        where: { category: "JOURNAL_PENDING", createdAt: { gte: mulaiTes } },
        select: { id: true, title: true, readAt: true, metadata: true },
      })
    ).filter((n) => (n.metadata as Record<string, unknown>)?.docId === id);
    expect(tanda).toHaveLength(1);
    expect(tanda[0].metadata).toMatchObject({ kind: "konsi_kirim", reason: "UNMAPPED_ROLE" });
    expect(tanda[0].title).toContain("KKIRIM/");
    expect(await hitungJurnalTertunda({ notifikasiIds: [tanda[0].id] })).toBe(1);

    expect(await postingJurnalOperasionalAman(SUMBER_OPERASIONAL.KIRIM_KONSI, id, adminId)).toMatchObject({ ok: true, created: true });
    expect((await prisma.adminNotification.findUniqueOrThrow({ where: { id: tanda[0].id } })).readAt).not.toBeNull();
    expect(await hitungJurnalTertunda({ notifikasiIds: [tanda[0].id] })).toBe(0);
    expect((await cariKirimKonsiTanpaJurnal({ sejak: wib("2004-09-09"), sampai: wib("2004-09-11"), batas: 500 })).map((d) => d.id)).not.toContain(id);
  });

  it("kait pasca-commit: menjurnal bila dinyalakan, diam di bawah vitest bila tidak (tes aksi lain tidak meninggalkan jurnal)", async () => {
    const id = await kirim(1);
    delete process.env.JURNAL_OPERASIONAL_KAIT_UJI;
    try {
      await kaitKirimTitipan(id, adminId);
      expect(await jumlahGenerasi(SUMBER_OPERASIONAL.KIRIM_KONSI, id)).toBe(0);
    } finally {
      process.env.JURNAL_OPERASIONAL_KAIT_UJI = "1";
    }
    await kaitKirimTitipan(id, adminId);
    expect(await saldoPeran(SUMBER_OPERASIONAL.KIRIM_KONSI, id)).toEqual({ INVENTORY_CONSIGNMENT: 50_000, INVENTORY_FG: -50_000 });

    // Kait siklus menjurnal penjualan DAN gaji SPG-nya sekaligus.
    await siklusDenganLaporan(1);
    expect(await kunci(1)).toMatchObject({ ok: true });
    await kaitSiklusKonsi(siklusId, adminId);
    expect(await jumlahGenerasi(SUMBER_OPERASIONAL.SIKLUS_KONSI, siklusId)).toBe(1);
    expect(await jumlahGenerasi(SUMBER_OPERASIONAL.KOMISI_KONSI, siklusId)).toBe(1);
  });

  it("setiap pencari dokumen tanpa jurnal berjalan di basis data ini (SQL-nya sah), menghormati rentang dan batas", async () => {
    for (const s of SEMUA_SUMBER_OPERASIONAL) {
      const hasil = await PENCARI_OPERASIONAL[s]({ sejak: wib("2001-01-01"), sampai: wib("2001-01-02"), batas: 3 });
      expect(Array.isArray(hasil), s).toBe(true);
      expect(hasil.length, s).toBeLessThanOrEqual(3);
    }
  });

  it("rekonsiliasi persediaan terbaca (hanya membaca): setiap peran persediaan muncul sekali", async () => {
    const r = await rekonsiliasiPersediaan();
    const peran = r.baris.flatMap((b) => b.peran).sort();
    expect(peran).toEqual(["INVENTORY", "INVENTORY_CONSIGNMENT", "INVENTORY_DAMAGED", "INVENTORY_FG", "INVENTORY_VAN"]);
    expect(Number.isFinite(r.rincian.barangJadi)).toBe(true);
  });

  it("setiap sumber operasional terdaftar di sapuan", () => {
    const terdaftar = new Set(sumberSapuanTerdaftar().map((s) => s.sourceType));
    for (const s of SEMUA_SUMBER_OPERASIONAL) expect(terdaftar.has(s), s).toBe(true);
  });
});
