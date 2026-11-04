import { capNotificationText } from "@/lib/notifications/text";

/*
 * Kategori `AdminNotification` tagihan pemasok (registri izin putaran 4) dan teks loncengnya. Penerimanya
 * ditetapkan di `CATEGORY_PERMISSION` (`lib/notifications/admin-fanout.ts`), tautannya di
 * `getNotificationHref` (`lib/notifications/navigation.ts`). Teks selalu bahasa Indonesia dan dipotong
 * ke panjang kolomnya (`capNotificationText`). Murni.
 */

/** Invoice yang harganya berbeda dari utang tercatat penerimaannya — ke `vendor_bills:decide_price` (P27, P53). */
export const VENDOR_BILL_PRICE_DIFFERENCE = "VENDOR_BILL_PRICE_DIFFERENCE";
/** Permintaan invoice yang 7 hari belum terjawab — ke `vendor_bills:manage` (P19). */
export const SUPPLIER_INVOICE_OVERDUE = "SUPPLIER_INVOICE_OVERDUE";

/** Baris `AdminNotification` yang sudah ditulis di dalam transaksi, untuk dikirim sesudah commit. */
export type NotifikasiKantor = { id: string; category: string; title: string; message: string; metadata?: unknown };

const rupiah = (n: number) => `Rp ${Math.abs(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

export function susunKabarSelisihHarga(a: { namaPemasok: string; vendorInvoiceNo: string; docNumber: string; jumlah: number; totalSelisih: number }): {
  title: string;
  message: string;
} {
  const arah = a.totalSelisih >= 0 ? "lebih tinggi" : "lebih rendah";
  return {
    title: capNotificationText(`Selisih harga invoice ${a.vendorInvoiceNo} menunggu keputusan`),
    message: capNotificationText(
      `${a.namaPemasok}: ${a.jumlah} baris invoice ${a.vendorInvoiceNo} (${a.docNumber}) ${arah} ${rupiah(a.totalSelisih)} dari utang tercatat. Penerimaannya belum bisa dibayar sampai diputuskan.`,
    ),
  };
}

export function susunKabarInvoiceTerlambat(a: { namaPemasok: string; jumlah: number; tanggalMinta: string }): { title: string; message: string } {
  return {
    title: capNotificationText(`Invoice ${a.namaPemasok} belum diterima`),
    message: capNotificationText(
      `Diminta ${a.tanggalMinta} untuk ${a.jumlah} penerimaan, sudah 7 hari belum ada invoice-nya. Minta ulang atau catat invoicenya.`,
    ),
  };
}
