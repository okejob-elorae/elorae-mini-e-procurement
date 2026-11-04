import type { TaxInvoiceStatusFilter } from "@/lib/tax-invoices/queries";
/**
 * Tautan dari rincian pesanan ke dokumen penagihannya. Murni (aman untuk klien).
 *
 * Dulu nomor faktur membuka daftar piutang TERSARING KEADAAN (`?keadaan=klaim`),
 * yang bisa berbeda dengan keadaan yang tertulis di baris dan berisi faktur
 * lain; "Piutang: lunas" membuka semua faktur lunas. Sekarang tautan mencari
 * NOMOR fakturnya (`?cari=`) — daftar piutang menampilkan faktur yang dicari
 * persis, juga yang sudah lunas (`saringPiutang`).
 */
export function tautanPiutangFaktur(invoiceNo: string): string {
  return `/backoffice/piutang?cari=${encodeURIComponent(invoiceNo.trim())}`;
}

/**
 * Antrean faktur pajak untuk satu nota, atau null bila tidak ada yang bisa
 * ditunjuk: tanpa baris faktur pajak, atau "dibuat" tanpa nomor (tertulis "—").
 * Bernomor → dicari nomornya; selain itu → dicari nomor notanya.
 */
export function tautanFakturPajak(
  faktur: { status: TaxInvoiceStatusFilter; invoiceNo: string | null } | null,
  docNo: string,
): string | null {
  if (!faktur) return null;
  const nomor = faktur.invoiceNo?.trim() ?? "";
  // Sent to the store still carries its number, so it is found by it like a created one.
  const bernomor = faktur.status === "CREATED" || faktur.status === "SENT_TO_STORE";
  if (bernomor && !nomor) return null;
  const q = bernomor ? nomor : docNo;
  return `/backoffice/finance/faktur-pajak?q=${encodeURIComponent(q)}`;
}
