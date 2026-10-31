import { prisma, Prisma, sqlId } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { cariTanpaJurnalSql } from "@/lib/finance/sapuan/sql";
import { akhirBulanWib, bacaPeriode, idKomisiSpg, NAMA_SUMBER_OPERASIONAL, SUMBER_OPERASIONAL, tanggalPeriode, type SumberOperasional } from "./aturan";
import { AWALAN_STOK_AWAL_UMKM } from "./jurnal";
import { postingJurnalOperasionalAman } from "./tertunda";

/*
 * Pencari "dokumen operasional tanpa jurnal" untuk sapuan terjadwal (registri
 * `lib/finance/sapuan/registri.ts`) dan layar Rekonsiliasi persediaan.
 * Syarat "seharusnya berjurnal" setiap pencari meniru penulisnya di
 * `jurnal.ts` (status final, nilai bukan nol); bila penulisnya berubah,
 * ubah pencarinya — kalau tidak, dokumen bernilai nol tampil selamanya
 * sebagai "tanpa jurnal".
 *
 * "Tanpa jurnal" = belum punya jurnal GENERASI PERTAMA (sourceId = id dokumen).
 * Jurnal bergenerasi yang tertinggal dari keadaan dokumennya diselaraskan oleh
 * kait pasca-commit dan tombol "Posting ulang", bukan oleh sapuan ini.
 */

const d = (kolom: string) => Prisma.sql`d.${sqlId(kolom)}`;

/** Toko dokumen (`kolom` di `d`) berjenis konsinyasi. */
const tokoKonsi = (kolom: Prisma.Sql) =>
  Prisma.sql`EXISTS (SELECT 1 FROM ${sqlId("Store")} s WHERE s.${sqlId("id")} = ${kolom} AND s.${sqlId("termsType")} = 'KONSI')`;

/**
 * Dokumen yang id-nya disusun di JS (bukan satu tabel): disaring dari daftar
 * kandidat. Cakupan (`ids`) diterapkan SEBELUM batas.
 */
async function tanpaJurnalDari(
  sourceType: SumberOperasional,
  semuaKandidat: DokumenTanpaJurnal[],
  opsi: Pick<OpsiCariSapuan, "batas" | "ids">,
): Promise<DokumenTanpaJurnal[]> {
  const batas = opsi.batas;
  const izinkan = opsi.ids ? new Set(opsi.ids) : null;
  const kandidat = izinkan ? semuaKandidat.filter((k) => izinkan.has(k.id)) : semuaKandidat;
  const hasil: DokumenTanpaJurnal[] = [];
  for (let i = 0; i < kandidat.length && hasil.length < batas; i += 200) {
    const potong = kandidat.slice(i, i + 200);
    const ada = new Set(
      (await prisma.journal.findMany({ where: { sourceType, sourceId: { in: potong.map((k) => k.id) } }, select: { sourceId: true } })).map((j) => j.sourceId),
    );
    for (const k of potong) {
      if (ada.has(k.id)) continue;
      hasil.push(k);
      if (hasil.length >= batas) break;
    }
  }
  return hasil;
}

export function cariKirimKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ConsignmentShipment",
    sourceType: SUMBER_OPERASIONAL.KIRIM_KONSI,
    tanggal: d("shippedAt"),
    kolomLabel: "noKirim",
    syarat: Prisma.sql`AND EXISTS (
      SELECT 1 FROM ${sqlId("ConsignmentShipmentItem")} i
      JOIN ${sqlId("StockAdjustment")} a ON a.${sqlId("idempotencyKey")} = CONCAT('konsi-kirim-', i.${sqlId("id")})
      WHERE i.${sqlId("shipmentId")} = d.${sqlId("id")} AND a.${sqlId("prevAvgCost")} > 0
    )`,
    opsi,
  });
}

export function cariPesananKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "FieldSalesOrder",
    sourceType: SUMBER_OPERASIONAL.PESANAN_KONSI,
    tanggal: d("approvedAt"),
    kolomLabel: "orderNo",
    syarat: Prisma.sql`AND d.${sqlId("orderType")} = 'KONSI' AND d.${sqlId("approvedAt")} IS NOT NULL AND EXISTS (
      SELECT 1 FROM ${sqlId("FieldSalesOrderLine")} l
      JOIN ${sqlId("StockAdjustment")} a ON a.${sqlId("idempotencyKey")} = CONCAT('konsi-transfer-line-', l.${sqlId("id")})
      WHERE l.${sqlId("orderId")} = d.${sqlId("id")} AND a.${sqlId("prevAvgCost")} > 0
    )`,
    opsi,
  });
}

export function cariReturKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  const tokoNri = Prisma.sql`COALESCE(d.${sqlId("storeId")}, (SELECT r.${sqlId("storeId")} FROM ${sqlId("StoreReturn")} r WHERE r.${sqlId("id")} = d.${sqlId("storeReturnId")}))`;
  return cariTanpaJurnalSql({
    tabel: "WarehouseReturn",
    sourceType: SUMBER_OPERASIONAL.RETUR_KONSI,
    tanggal: d("finalisedAt"),
    kolomLabel: "noNri",
    syarat: Prisma.sql`AND d.${sqlId("status")} = 'FINAL' AND ${tokoKonsi(tokoNri)} AND EXISTS (
      SELECT 1 FROM ${sqlId("WarehouseReturnItem")} i
      WHERE i.${sqlId("warehouseReturnId")} = d.${sqlId("id")} AND i.${sqlId("itemId")} IS NOT NULL AND i.${sqlId("qty")} > 0
    )`,
    opsi,
  });
}

/** Siklus yang dikunci, bertanggal jurnal (akhir bulan periodenya, paling lambat saat dikunci) di rentang. */
async function siklusTerkunci(opsi: OpsiCariSapuan, syarat: Prisma.ConsignmentCycleWhereInput, sourceType: SumberOperasional) {
  const rows = await prisma.consignmentCycle.findMany({
    where: { lockedAt: { not: null, gte: opsi.sejak }, ...syarat, ...(opsi.ids ? { id: { in: [...opsi.ids] } } : {}) },
    orderBy: [{ lockedAt: "asc" }, { id: "asc" }],
    select: { id: true, noKonsi: true, lockedAt: true, periodYear: true, periodMonth: true },
  });
  const kandidat = rows
    .map((r) => ({ id: r.id, tanggal: tanggalPeriode(r.periodYear, r.periodMonth, r.lockedAt), label: r.noKonsi }))
    .filter((r) => r.tanggal.getTime() >= opsi.sejak.getTime() && r.tanggal.getTime() <= opsi.sampai.getTime());
  return tanpaJurnalDari(sourceType, kandidat, opsi);
}

export function cariSiklusKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return siklusTerkunci(
    opsi,
    { OR: [{ sold: { some: { amount: { not: 0 } } } }, { promoBorneByElorae: { not: 0 } }, { lossChargedToStore: { not: 0 } }] },
    SUMBER_OPERASIONAL.SIKLUS_KONSI,
  );
}

export function cariKomisiKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return siklusTerkunci(opsi, { commissions: { some: { total: { gt: 0 } } } }, SUMBER_OPERASIONAL.KOMISI_KONSI);
}

export function cariBayarGajiKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ConsignmentCommission",
    sourceType: SUMBER_OPERASIONAL.BAYAR_GAJI_KONSI,
    tanggal: d("paidAt"),
    kolomLabel: "id",
    syarat: Prisma.sql`AND d.${sqlId("paidAt")} IS NOT NULL AND d.${sqlId("total")} - d.${sqlId("deduction")} > 0`,
    opsi,
  });
}

export function cariBayarTokoKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ConsignmentPayment",
    sourceType: SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI,
    tanggal: d("paidOn"),
    kolomLabel: "id",
    syarat: Prisma.sql`AND d.${sqlId("cancelledAt")} IS NULL AND d.${sqlId("amount")} > 0`,
    opsi,
  });
}

export async function cariKomisiSpgTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  const grup = await prisma.spgCommission.groupBy({ by: ["storeId", "period"], _sum: { commission: true } });
  const kandidat: DokumenTanpaJurnal[] = [];
  for (const g of grup) {
    const p = bacaPeriode(g.period);
    if (!p || !(Number(g._sum.commission ?? 0) > 0)) continue;
    const tanggal = akhirBulanWib(p[0], p[1]);
    if (tanggal.getTime() < opsi.sejak.getTime() || tanggal.getTime() > opsi.sampai.getTime()) continue;
    kandidat.push({ id: idKomisiSpg(g.storeId, g.period), tanggal, label: `Komisi SPG ${g.period}` });
  }
  kandidat.sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime() || a.id.localeCompare(b.id));
  return tanpaJurnalDari(SUMBER_OPERASIONAL.KOMISI_SPG, kandidat, opsi);
}

export function cariBayarKomisiSpgTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "SpgCommission",
    sourceType: SUMBER_OPERASIONAL.BAYAR_KOMISI_SPG,
    tanggal: d("paidAt"),
    kolomLabel: "period",
    syarat: Prisma.sql`AND d.${sqlId("paidAt")} IS NOT NULL AND d.${sqlId("commission")} - d.${sqlId("deduction")} > 0`,
    opsi,
  });
}

export function cariBarangHilangTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "StockLoss",
    sourceType: SUMBER_OPERASIONAL.BARANG_HILANG,
    tanggal: Prisma.sql`COALESCE(d.${sqlId("decidedAt")}, d.${sqlId("createdAt")})`,
    kolomLabel: "id",
    syarat: Prisma.sql`AND d.${sqlId("status")} IN ('DITETAPKAN', 'SELESAI') AND ${tokoKonsi(d("storeId"))} AND EXISTS (
      SELECT 1 FROM ${sqlId("StockLossLine")} l WHERE l.${sqlId("lossId")} = d.${sqlId("id")} AND l.${sqlId("itemId")} IS NOT NULL AND l.${sqlId("qty")} > 0
    )`,
    opsi,
  });
}

export function cariPotongSalesTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "StockLossDeduction",
    sourceType: SUMBER_OPERASIONAL.POTONG_SALES,
    tanggal: d("createdAt"),
    kolomLabel: "refId",
    syarat: Prisma.sql`AND d.${sqlId("refType")} = 'KomisiSalesman' AND d.${sqlId("amount")} > 0`,
    opsi,
  });
}

export function cariGudangRusakTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "DamagedStockMovement",
    sourceType: SUMBER_OPERASIONAL.GUDANG_RUSAK,
    tanggal: d("createdAt"),
    kolomLabel: "productName",
    // Nilai keluar nol (gudang rusak tanpa nilai) tidak berjurnal; JUAL_OBRAL menyimpan HASIL JUAL di `value`.
    syarat: Prisma.sql`AND d.${sqlId("kind")} IN ('PERBAIKI', 'JUAL_OBRAL', 'MUSNAHKAN')
      AND (d.${sqlId("kind")} = 'JUAL_OBRAL' OR d.${sqlId("value")} IS NULL OR d.${sqlId("value")} <> 0 OR d.${sqlId("refId")} IS NOT NULL)`,
    opsi,
  });
}

export function cariStokManualTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "StockAdjustment",
    sourceType: SUMBER_OPERASIONAL.STOK_MANUAL,
    tanggal: d("createdAt"),
    kolomLabel: "docNumber",
    syarat: Prisma.sql`AND d.${sqlId("source")} = 'ERP' AND d.${sqlId("reason")} NOT LIKE ${`${AWALAN_STOK_AWAL_UMKM}%`}
      AND ABS(d.${sqlId("newQty")} * d.${sqlId("newAvgCost")} - d.${sqlId("prevQty")} * d.${sqlId("prevAvgCost")}) >= 0.01`,
    opsi,
  });
}

export function cariReturPemasokTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "VendorReturn",
    sourceType: SUMBER_OPERASIONAL.RETUR_PEMASOK,
    tanggal: d("completedAt"),
    kolomLabel: "docNumber",
    syarat: Prisma.sql`AND d.${sqlId("status")} = 'COMPLETED' AND (
      (d.${sqlId("poId")} IS NOT NULL AND COALESCE(d.${sqlId("poCreditAmount")}, 0) <> 0)
      OR EXISTS (SELECT 1 FROM ${sqlId("StockMovement")} m WHERE m.${sqlId("refType")} = 'VENDOR_RETURN' AND m.${sqlId("refId")} = d.${sqlId("id")} AND m.${sqlId("totalCost")} <> 0)
    )`,
    opsi,
  });
}

export function cariBiayaPerjalananTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ExpenseClaim",
    sourceType: SUMBER_OPERASIONAL.BIAYA_PERJALANAN,
    tanggal: Prisma.sql`COALESCE(d.${sqlId("reviewedAt")}, d.${sqlId("spentAt")})`,
    kolomLabel: "category",
    syarat: Prisma.sql`AND d.${sqlId("status")} IN ('DISETUJUI', 'DIBAYAR') AND d.${sqlId("amount")} > 0`,
    opsi,
  });
}

export function cariBayarBiayaPerjalananTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ExpenseClaim",
    sourceType: SUMBER_OPERASIONAL.BAYAR_BIAYA_PERJALANAN,
    tanggal: d("paidAt"),
    kolomLabel: "category",
    syarat: Prisma.sql`AND d.${sqlId("status")} = 'DIBAYAR' AND d.${sqlId("paidAt")} IS NOT NULL AND d.${sqlId("amount")} > 0`,
    opsi,
  });
}

/** Pencari per sumber — satu tempat untuk registri sapuan dan layar rekonsiliasi persediaan. */
export const PENCARI_OPERASIONAL: Readonly<Record<SumberOperasional, (opsi: OpsiCariSapuan) => Promise<DokumenTanpaJurnal[]>>> = {
  CONSIGNMENT_SHIPMENT: cariKirimKonsiTanpaJurnal,
  CONSIGNMENT_ORDER: cariPesananKonsiTanpaJurnal,
  CONSIGNMENT_RETURN: cariReturKonsiTanpaJurnal,
  CONSIGNMENT_CYCLE: cariSiklusKonsiTanpaJurnal,
  CONSIGNMENT_COMMISSION: cariKomisiKonsiTanpaJurnal,
  CONSIGNMENT_COMMISSION_PAYMENT: cariBayarGajiKonsiTanpaJurnal,
  CONSIGNMENT_PAYMENT: cariBayarTokoKonsiTanpaJurnal,
  SPG_COMMISSION: cariKomisiSpgTanpaJurnal,
  SPG_COMMISSION_PAYMENT: cariBayarKomisiSpgTanpaJurnal,
  STOCK_LOSS: cariBarangHilangTanpaJurnal,
  LOSS_SALES_DEDUCTION: cariPotongSalesTanpaJurnal,
  DAMAGED_STOCK: cariGudangRusakTanpaJurnal,
  STOCK_ADJUSTMENT: cariStokManualTanpaJurnal,
  VENDOR_RETURN: cariReturPemasokTanpaJurnal,
  TRAVEL_CLAIM: cariBiayaPerjalananTanpaJurnal,
  TRAVEL_CLAIM_PAYMENT: cariBayarBiayaPerjalananTanpaJurnal,
};

/**
 * Hasil untuk registri sapuan. Kegagalan yang tidak punya kode di tipe hasil
 * registri SUDAH dicatat sebagai `JOURNAL_PENDING` oleh
 * `postingJurnalOperasionalAman`, lalu dilempar supaya runner mencatatnya per
 * dokumen — tidak pernah dipetakan ke kode lain yang artinya berbeda.
 */
async function postingSapuan(sumber: SumberOperasional, id: string, olehUserId: string): Promise<GenerateAutoJournalResult> {
  const r = await postingJurnalOperasionalAman(sumber, id, olehUserId);
  if (r.ok) return r.journalId ? { ok: true, journalId: r.journalId, created: r.created } : { ok: false, code: "NOTHING_TO_POST" };
  switch (r.code) {
    case "UNMAPPED_ROLE":
      return { ok: false, code: "UNMAPPED_ROLE", ...(r.role ? { role: r.role } : {}) };
    case "UNBALANCED":
      return { ok: false, code: "UNBALANCED" };
    case "NOTHING_TO_POST":
    case "BELUM_BERLAKU":
    case "GL_CUTOVER_NOT_CONFIGURED":
      return { ok: false, code: "NOTHING_TO_POST" };
    default:
      throw new Error(`Jurnal ${sumber} ${id} gagal: ${r.code}${r.detail ? ` (${r.detail})` : ""}`);
  }
}

const LABEL_SAPUAN: Readonly<Record<SumberOperasional, string>> = {
  CONSIGNMENT_SHIPMENT: "Kiriman titipan konsinyasi",
  CONSIGNMENT_ORDER: "Pesanan konsinyasi disetujui",
  CONSIGNMENT_RETURN: "Retur toko konsinyasi (NRI)",
  CONSIGNMENT_CYCLE: "Penjualan siklus konsinyasi",
  CONSIGNMENT_COMMISSION: "Gaji & komisi SPG konsinyasi",
  CONSIGNMENT_COMMISSION_PAYMENT: "Pembayaran gaji SPG konsinyasi",
  CONSIGNMENT_PAYMENT: "Pembayaran toko konsinyasi",
  SPG_COMMISSION: "Komisi SPG toko putus",
  SPG_COMMISSION_PAYMENT: "Pembayaran komisi SPG toko putus",
  STOCK_LOSS: "Barang hilang di toko konsinyasi",
  LOSS_SALES_DEDUCTION: "Potongan beban barang hilang sales",
  DAMAGED_STOCK: "Keputusan gudang barang rusak",
  STOCK_ADJUSTMENT: "Penyesuaian stok manual",
  VENDOR_RETURN: "Retur ke pemasok",
  TRAVEL_CLAIM: "Biaya perjalanan disetujui",
  TRAVEL_CLAIM_PAYMENT: "Pembayaran biaya perjalanan",
};

for (const sumber of Object.values(SUMBER_OPERASIONAL)) {
  daftarkanSumberSapuan({
    sourceType: sumber,
    label: LABEL_SAPUAN[sumber],
    cariTanpaJurnal: PENCARI_OPERASIONAL[sumber],
    posting: (id, olehUserId) => postingSapuan(sumber, id, olehUserId),
  });
}

export type DokumenOperasionalTanpaJurnal = { sumber: SumberOperasional; id: string; tanggal: string; label: string };

/**
 * Dokumen operasional tanpa jurnal sejak tanggal mulai buku besar, `batas` per
 * jenis (layar rekonsiliasi persediaan). Tanpa tanggal mulai: kosong.
 */
export async function dokumenOperasionalTanpaJurnal(batas: number, sampai = new Date()): Promise<DokumenOperasionalTanpaJurnal[]> {
  const mulai = await readGlCutover();
  if (!mulai || mulai.getTime() > sampai.getTime()) return [];
  const opsi = { sejak: mulai, sampai, batas };
  const hasil: DokumenOperasionalTanpaJurnal[] = [];
  for (const sumber of Object.values(SUMBER_OPERASIONAL)) {
    try {
      for (const dok of await PENCARI_OPERASIONAL[sumber](opsi)) {
        hasil.push({ sumber, id: dok.id, tanggal: dok.tanggal.toISOString(), label: dok.label });
      }
    } catch (e) {
      console.error(`[jurnal-operasional] pencari ${NAMA_SUMBER_OPERASIONAL[sumber]} gagal`, e);
    }
  }
  return hasil;
}
