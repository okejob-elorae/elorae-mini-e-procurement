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
  faktur: { status: "PENDING" | "CREATED" | "NOT_REQUIRED"; invoiceNo: string | null } | null,
  docNo: string,
): string | null {
  if (!faktur) return null;
  const nomor = faktur.invoiceNo?.trim() ?? "";
  if (faktur.status === "CREATED" && !nomor) return null;
  const q = faktur.status === "CREATED" ? nomor : docNo;
  return `/backoffice/finance/faktur-pajak?q=${encodeURIComponent(q)}`;
}
