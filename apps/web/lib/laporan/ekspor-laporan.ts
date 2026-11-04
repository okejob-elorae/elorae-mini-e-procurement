import idMessages from "@/lib/i18n/messages/id.json";
import { formatDisplayDate } from "@/lib/date-only";
import { getStatusMeta } from "@/lib/ui/status-map";

/**
 * Baris berkas ekspor Laporan operasional (CSV/Excel) — murni, tanpa Prisma.
 *
 * Dulu kepala kolomnya Inggris ("Doc Number", "Outstanding Value"), statusnya
 * kode mentah (`SUBMITTED`), dan tanggalnya diformat `toLocaleDateString()` di
 * server tanpa zona waktu — padahal layarnya sudah Indonesia. Berkas ekspor
 * dibuka orang yang sama yang membaca layarnya, jadi kata-katanya harus sama:
 * label status diambil dari namespace `statuses` yang sama dengan layar, dan
 * tanggal lewat `formatDisplayDate` (WIB, "26 Agu 2026").
 *
 * Bahasanya Indonesia tetap: aksi server tidak tahu bahasa pilihan pembaca.
 */

const STATUS = idMessages.statuses as Record<string, string>;

/** Label status dokumen yang sama dengan layar (`statuses.<kunci>`). */
export function labelStatusEkspor(jenis: "purchaseOrder" | "workOrder", status: string): string {
  return STATUS[getStatusMeta(jenis, status).labelKey] ?? status;
}

const JENIS_BARANG: Record<string, string> = {
  FABRIC: "Kain",
  ACCESSORIES: "Aksesoris",
  FINISHED_GOOD: "Barang jadi",
};

export function labelJenisBarangEkspor(jenis: string): string {
  return JENIS_BARANG[jenis] ?? jenis;
}

export const KOLOM_PENGADAAN = [
  "Nomor PO",
  "Pemasok",
  "Kode pemasok",
  "Status",
  "Tanggal tiba",
  "Keterangan tiba",
  "Nilai PO",
  "Qty belum diterima",
  "Nilai belum diterima",
  "Jumlah penerimaan barang",
] as const;

export type BarisPengadaanSumber = {
  docNumber: string;
  supplier: { name: string; code: string };
  status: string;
  etaDate: Date | string | null;
  etaMessage: string;
  grandTotal: number;
  outstandingQty: number;
  outstandingValue: number;
  grnCount: number;
};

export function barisEksporPengadaan(report: readonly BarisPengadaanSumber[]): Record<(typeof KOLOM_PENGADAAN)[number], string | number>[] {
  return report.map((r) => ({
    "Nomor PO": r.docNumber,
    Pemasok: r.supplier.name,
    "Kode pemasok": r.supplier.code,
    Status: labelStatusEkspor("purchaseOrder", r.status),
    "Tanggal tiba": r.etaDate ? formatDisplayDate(r.etaDate) : "",
    "Keterangan tiba": r.etaMessage,
    "Nilai PO": r.grandTotal,
    "Qty belum diterima": r.outstandingQty,
    "Nilai belum diterima": r.outstandingValue,
    "Jumlah penerimaan barang": r.grnCount,
  }));
}

export const KOLOM_KINERJA_PEMASOK = [
  "Nomor perintah kerja",
  "Barang jadi",
  "Qty rencana",
  "Qty jadi",
  "Efisiensi %",
  "Biaya bahan",
  "Nilai retur",
  "Status",
  "Lama pengerjaan (hari)",
] as const;

export type BarisKinerjaSumber = {
  docNumber: string;
  finishedGood: string;
  plannedQty: number;
  actualQty: number;
  efficiency: number;
  materialCost: number;
  returnValue: number;
  status: string;
  completionTimeDays: number | null;
};

export function barisEksporKinerjaPemasok(
  rows: readonly BarisKinerjaSumber[],
): Record<(typeof KOLOM_KINERJA_PEMASOK)[number], string | number>[] {
  return rows.map((r) => ({
    "Nomor perintah kerja": r.docNumber,
    "Barang jadi": r.finishedGood,
    "Qty rencana": r.plannedQty,
    "Qty jadi": r.actualQty,
    "Efisiensi %": r.efficiency,
    "Biaya bahan": r.materialCost,
    "Nilai retur": r.returnValue,
    Status: labelStatusEkspor("workOrder", r.status),
    "Lama pengerjaan (hari)": r.completionTimeDays ?? "",
  }));
}

export const KOLOM_NILAI_PERSEDIAAN = [
  "SKU",
  "Nama",
  "Jenis",
  "Satuan",
  "Stok di tangan",
  "Harga rata-rata",
  "Nilai",
  "% dari total",
] as const;

export type BarisPersediaanSumber = {
  sku: string;
  name: string;
  type: string;
  uomCode: string;
  qtyOnHand: number;
  avgCost: number;
  totalValue: number;
  percentageOfTotal: number;
};

export function barisEksporPersediaan(
  details: readonly BarisPersediaanSumber[],
): Record<(typeof KOLOM_NILAI_PERSEDIAAN)[number], string | number>[] {
  return details.map((d) => ({
    SKU: d.sku,
    Nama: d.name,
    Jenis: labelJenisBarangEkspor(d.type),
    Satuan: d.uomCode,
    "Stok di tangan": d.qtyOnHand,
    "Harga rata-rata": d.avgCost,
    Nilai: d.totalValue,
    "% dari total": Math.round(d.percentageOfTotal * 100) / 100,
  }));
}

/** CSV dengan kepala kolom tetap — berkas kosong pun berkepala yang sama. */
export function keCsv(kolom: readonly string[], baris: readonly Record<string, string | number>[]): string {
  const sel = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [kolom.join(","), ...baris.map((b) => kolom.map((k) => sel(b[k] ?? "")).join(","))].join("\n");
}
