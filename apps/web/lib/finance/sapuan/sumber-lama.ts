import { Prisma, sqlId } from "@elorae/db";
import { postGrnJournal, postGrnReversalJournal } from "@/lib/inventory/grn-journal";
import { postOpnameJournal } from "@/lib/inventory/opname-journal";
import { postVanLoadJournal, postVanReconcileJournal, postVanSaleJournal } from "@/lib/canvassing/van-journal";
import { postSalesCogsJournal, postSalesRevenueJournal } from "@/lib/finance/sales/sales-journal";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { daftarkanSumberSapuan } from "./registri";
import { cariTanpaJurnalSql } from "./sql";
import { catatGagalSapuan, selesaikanHasilSapuan } from "./tertunda";

/*
 * Sumber jurnal otomatis yang SUDAH ada sebelum registri sapuan (2026-10-08)
 * dan tidak punya pemilik baru di pembangunan akuntansi lengkap: penerimaan
 * barang (+ pembaliknya), opname, kanvas (muat, jual, rekonsiliasi), dan
 * penjualan marketplace (pendapatan, HPP).
 *
 * TIDAK didaftarkan di sini (dan kenapa):
 * - `FG_RECEIPT` — milik pembangunan CMT ke HPP (`lib/production/`).
 * - `SALESRETURN_*` — dijurnal saat keputusan retur dengan gerbang "penjualan
 *   asalnya berjurnal" yang bisa menolak selamanya; pencari yang meniru
 *   gerbang itu belum dibuat.
 * - `SUPPLIER_PAYMENT*` — jurnal bergenerasi per PO (`poId#n`), digantikan
 *   pembayaran pemasok baru.
 * - `SETTLEMENT` — DIPOSTING MANUSIA sesudah memeriksa checksum; settlement
 *   tanpa jurnal adalah keadaan normal "menunggu keuangan", bukan jurnal yang
 *   terlewat.
 * - `KOL_*` — diselaraskan per kolaborasi oleh `lib/creative/jurnal-kol.ts`.
 *
 * Syarat "seharusnya berjurnal" setiap pencari meniru penulisnya persis (nilai
 * bukan nol, status final); bila penulisnya berubah, ubah pencarinya — kalau
 * tidak, dokumen bernilai nol tampil selamanya sebagai "tanpa jurnal".
 */

const nilaiBaris = (alias: string, tabel: string, kolomInduk: string) => Prisma.sql`(
  SELECT COALESCE(SUM(l.${sqlId("qty")} * l.${sqlId("unitCost")}), 0)
  FROM ${sqlId(tabel)} l WHERE l.${sqlId(kolomInduk)} = ${Prisma.raw(alias)}.${sqlId("id")}
)`;

/** Posting yang melempar tetap meninggalkan `JOURNAL_PENDING` (sebab ERROR), lalu melempar lagi ke runner. */
async function aman(
  post: () => Promise<GenerateAutoJournalResult>,
  gagal: { metadata: Record<string, unknown>; judul: string; pesan: string },
): Promise<GenerateAutoJournalResult> {
  try {
    return await post();
  } catch (e) {
    await catatGagalSapuan({
      metadata: { ...gagal.metadata, reason: "ERROR", role: null },
      judul: gagal.judul,
      pesan: `${gagal.pesan} (${e instanceof Error ? e.message : "galat"})`,
    });
    throw e;
  }
}

// ─── Penerimaan barang ───────────────────────────────────────────────────────

const PETUNJUK = "Petakan akunnya di Keuangan → Pemetaan Akun bila perlu; sapuan harian akan mencoba lagi.";

daftarkanSumberSapuan({
  sourceType: "GRN",
  label: "Penerimaan barang",
  // GRN yang ditolak pemilik tidak menambah hutang bersih: jurnal penerimaannya
  // (bila ada) dibalik `GRN_REVERSAL`, dan yang belum pernah berjurnal tidak perlu keduanya.
  cariTanpaJurnal: (opsi) =>
    cariTanpaJurnalSql({
      tabel: "GRN",
      sourceType: "GRN",
      tanggal: Prisma.sql`d.${sqlId("grnDate")}`,
      kolomLabel: "docNumber",
      syarat: Prisma.sql`AND ABS(d.${sqlId("totalAmount")}) >= 0.01 AND d.${sqlId("ownerDeclinedAt")} IS NULL`,
      opsi,
    }),
  posting: async (id, oleh) => {
    const gagal = (kode: string) => ({
      metadata: { grnId: id, kind: "receipt" },
      judul: "Jurnal penerimaan barang belum diposting",
      pesan: `Sapuan harian gagal memposting jurnal penerimaan barang (${kode}). ${PETUNJUK}`,
    });
    const r = await aman(() => postGrnJournal(id, oleh), gagal("ERROR"));
    return selesaikanHasilSapuan(r, { sourceType: "GRN", sourceId: id }, gagal);
  },
});

daftarkanSumberSapuan({
  sourceType: "GRN_REVERSAL",
  label: "Pembatalan penerimaan barang",
  // Hanya GRN yang ditolak pemilik DAN jurnal penerimaannya berdiri — itu yang harus dibalik.
  cariTanpaJurnal: (opsi) =>
    cariTanpaJurnalSql({
      tabel: "GRN",
      sourceType: "GRN_REVERSAL",
      tanggal: Prisma.sql`d.${sqlId("ownerDeclinedAt")}`,
      kolomLabel: "docNumber",
      syarat: Prisma.sql`AND d.${sqlId("ownerDeclinedAt")} IS NOT NULL AND ABS(d.${sqlId("totalAmount")}) >= 0.01
        AND EXISTS (SELECT 1 FROM ${sqlId("Journal")} jg WHERE jg.${sqlId("sourceType")} = 'GRN' AND jg.${sqlId("sourceId")} = d.${sqlId("id")})`,
      opsi,
    }),
  posting: async (id, oleh) => {
    const gagal = (kode: string) => ({
      metadata: { grnId: id, kind: "reversal" },
      judul: "Jurnal pembatalan penerimaan barang belum diposting",
      pesan: `Sapuan harian gagal memposting jurnal pembatalan penerimaan barang (${kode}). ${PETUNJUK}`,
    });
    const r = await aman(() => postGrnReversalJournal(id, oleh), gagal("ERROR"));
    return selesaikanHasilSapuan(r, { sourceType: "GRN_REVERSAL", sourceId: id }, gagal);
  },
});

// ─── Opname ──────────────────────────────────────────────────────────────────

daftarkanSumberSapuan({
  sourceType: "OPNAME",
  label: "Selisih stock opname",
  // Sama dengan `opnameNetDelta`: Σ nilai pergerakan stok opname itu bukan nol.
  cariTanpaJurnal: (opsi) =>
    cariTanpaJurnalSql({
      tabel: "StockOpname",
      sourceType: "OPNAME",
      tanggal: Prisma.sql`d.${sqlId("approvedAt")}`,
      kolomLabel: "docNumber",
      syarat: Prisma.sql`AND d.${sqlId("status")} = 'APPROVED' AND ABS((
        SELECT COALESCE(SUM(m.${sqlId("totalCost")}), 0) FROM ${sqlId("StockMovement")} m
        WHERE m.${sqlId("refType")} = 'OPNAME' AND m.${sqlId("refId")} = d.${sqlId("id")}
      )) >= 0.01`,
      opsi,
    }),
  posting: async (id, oleh) => {
    const gagal = (kode: string) => ({
      metadata: { opnameId: id },
      judul: "Jurnal selisih opname belum diposting",
      pesan: `Sapuan harian gagal memposting jurnal selisih opname (${kode}). ${PETUNJUK}`,
    });
    const r = await aman(() => postOpnameJournal(id, oleh), gagal("ERROR"));
    return selesaikanHasilSapuan(r, { sourceType: "OPNAME", sourceId: id }, gagal);
  },
});

// ─── Kanvas ──────────────────────────────────────────────────────────────────

daftarkanSumberSapuan({
  sourceType: "VAN_LOAD",
  label: "Muatan kanvas",
  cariTanpaJurnal: (opsi) =>
    cariTanpaJurnalSql({
      tabel: "VanLoad",
      sourceType: "VAN_LOAD",
      tanggal: Prisma.sql`d.${sqlId("createdAt")}`,
      kolomLabel: "docNo",
      syarat: Prisma.sql`AND ${nilaiBaris("d", "VanLoadLine", "vanLoadId")} >= 0.01`,
      opsi,
    }),
  posting: async (id, oleh) => {
    const gagal = (kode: string) => ({
      metadata: { docId: id, kind: "van_load" },
      judul: "Jurnal muatan kanvas belum diposting",
      pesan: `Sapuan harian gagal memposting jurnal muatan kanvas (${kode}). ${PETUNJUK}`,
    });
    const r = await aman(() => postVanLoadJournal(id, oleh), gagal("ERROR"));
    return selesaikanHasilSapuan(r, { sourceType: "VAN_LOAD", sourceId: id }, gagal);
  },
});

daftarkanSumberSapuan({
  sourceType: "VAN_SALE",
  label: "Penjualan kanvas",
  cariTanpaJurnal: (opsi) =>
    cariTanpaJurnalSql({
      tabel: "VanSale",
      sourceType: "VAN_SALE",
      tanggal: Prisma.sql`d.${sqlId("createdAt")}`,
      kolomLabel: "docNo",
      syarat: Prisma.sql`AND (d.${sqlId("total")} >= 0.01 OR ${nilaiBaris("d", "VanSaleLine", "vanSaleId")} >= 0.01)`,
      opsi,
    }),
  posting: async (id, oleh) => {
    const gagal = (kode: string) => ({
      metadata: { docId: id, kind: "van_sale" },
      judul: "Jurnal penjualan kanvas belum diposting",
      pesan: `Sapuan harian gagal memposting jurnal penjualan kanvas (${kode}). ${PETUNJUK}`,
    });
    const r = await aman(() => postVanSaleJournal(id, oleh), gagal("ERROR"));
    return selesaikanHasilSapuan(r, { sourceType: "VAN_SALE", sourceId: id }, gagal);
  },
});

daftarkanSumberSapuan({
  sourceType: "VAN_RECONCILE",
  label: "Rekonsiliasi kanvas",
  // Ada baris yang kembali atau berselisih dengan biaya bukan nol (`reconcileSplit`).
  cariTanpaJurnal: (opsi) =>
    cariTanpaJurnalSql({
      tabel: "VanReconcile",
      sourceType: "VAN_RECONCILE",
      tanggal: Prisma.sql`d.${sqlId("createdAt")}`,
      kolomLabel: "docNo",
      syarat: Prisma.sql`AND EXISTS (
        SELECT 1 FROM ${sqlId("VanReconcileLine")} l
        WHERE l.${sqlId("vanReconcileId")} = d.${sqlId("id")} AND l.${sqlId("unitCost")} > 0
          AND (l.${sqlId("countedQty")} <> 0 OR l.${sqlId("varianceQty")} <> 0)
      )`,
      opsi,
    }),
  posting: async (id, oleh) => {
    const gagal = (kode: string) => ({
      metadata: { docId: id, kind: "van_reconcile" },
      judul: "Jurnal rekonsiliasi kanvas belum diposting",
      pesan: `Sapuan harian gagal memposting jurnal rekonsiliasi kanvas (${kode}). ${PETUNJUK}`,
    });
    const r = await aman(() => postVanReconcileJournal(id, oleh), gagal("ERROR"));
    return selesaikanHasilSapuan(r, { sourceType: "VAN_RECONCILE", sourceId: id }, gagal);
  },
});

// ─── Penjualan marketplace ───────────────────────────────────────────────────

/*
 * Sama dengan sapuan 5 menit `postPendingSalesJournals` (`lib/finance/sales/sweep.ts`):
 * pesanan terkirim, ditanggali `COALESCE(shippedAt, transactionDate)`. Sapuan itu
 * tetap jalan; pencari ini yang membuat sisanya TERLIHAT di Integritas dan daftar
 * periksa tutup buku.
 */
const tanggalJual = Prisma.sql`COALESCE(d.${sqlId("shippedAt")}, d.${sqlId("transactionDate")})`;
const terkirim = Prisma.sql`AND (d.${sqlId("status")} IN ('SHIPPED','COMPLETED') OR d.${sqlId("fulfillmentStatus")} = 'SHIPPED')`;

daftarkanSumberSapuan({
  sourceType: "SALESORDER_REVENUE",
  label: "Pendapatan penjualan marketplace",
  cariTanpaJurnal: (opsi) =>
    cariTanpaJurnalSql({
      tabel: "SalesOrder",
      sourceType: "SALESORDER_REVENUE",
      tanggal: tanggalJual,
      kolomLabel: "salesorderNo",
      syarat: Prisma.sql`${terkirim} AND ABS(d.${sqlId("grandTotal")}) >= 0.01`,
      opsi,
    }),
  posting: async (id, oleh) => {
    const gagal = (kode: string) => ({
      metadata: { orderId: id, kind: "revenue" },
      judul: "Jurnal penjualan belum diposting",
      pesan: `Jurnal pendapatan penjualan marketplace gagal diposting (${kode}). ${PETUNJUK}`,
    });
    const r = await aman(() => postSalesRevenueJournal(id, oleh), gagal("ERROR"));
    return selesaikanHasilSapuan(r, { sourceType: "SALESORDER_REVENUE", sourceId: id }, gagal);
  },
});

daftarkanSumberSapuan({
  sourceType: "SALESORDER_COGS",
  label: "HPP penjualan marketplace",
  // Pesanan tanpa biaya tercatat (Σ cogs = 0) memang tidak berjurnal HPP — bukan "terlewat".
  cariTanpaJurnal: (opsi) =>
    cariTanpaJurnalSql({
      tabel: "SalesOrder",
      sourceType: "SALESORDER_COGS",
      tanggal: tanggalJual,
      kolomLabel: "salesorderNo",
      syarat: Prisma.sql`${terkirim} AND ABS((
        SELECT COALESCE(SUM(i.${sqlId("cogs")}), 0) FROM ${sqlId("SalesOrderItem")} i
        WHERE i.${sqlId("salesOrderId")} = d.${sqlId("id")}
      )) >= 0.01`,
      opsi,
    }),
  posting: async (id, oleh) => {
    const gagal = (kode: string) => ({
      metadata: { orderId: id, kind: "cogs" },
      judul: "Jurnal HPP penjualan belum diposting",
      pesan: `Jurnal HPP penjualan marketplace gagal diposting (${kode}). ${PETUNJUK}`,
    });
    const r = await aman(() => postSalesCogsJournal(id, oleh), gagal("ERROR"));
    return selesaikanHasilSapuan(r, { sourceType: "SALESORDER_COGS", sourceId: id }, gagal);
  },
});
