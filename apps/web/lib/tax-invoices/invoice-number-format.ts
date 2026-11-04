/**
 * Nomor Seri Faktur Pajak (NSFP) yang diterima penulis, setelah spasi dan tanda baca
 * dibuang — sengaja longgar, yang ditolak hanya yang jelas bukan NSFP:
 *  - 16 digit, e-Faktur lama: `010.000-24.00000001` = 2 digit kode transaksi,
 *    1 digit status (0 normal, 1 pengganti), lalu 13 digit NSFP alokasi DJP
 *    (3 kode cabang, 2 tahun, 8 nomor urut);
 *  - 13 digit, NSFP alokasi itu sendiri tanpa kode transaksi: `000-24.00000001`;
 *  - 17 digit, nomor faktur Coretax (2025+);
 *  - 14–15 digit ikut diterima karena tidak ada alasan kuat menolaknya.
 * Huruf, kurang dari 13 digit, atau lebih dari 17 digit ditolak.
 */
const PANJANG_MIN_NSFP = 13;
const PANJANG_MAKS_NSFP = 17;

export function normalisasiNomorFaktur(nomor: string): string {
  return nomor.replace(/[\s.,\-/_]/g, "");
}

export function periksaFormatNomorFaktur(nomor: string): boolean {
  const n = normalisasiNomorFaktur(nomor);
  return /^[0-9]+$/.test(n) && n.length >= PANJANG_MIN_NSFP && n.length <= PANJANG_MAKS_NSFP;
}

/**
 * Soft hint only — the mark-created dialog shows a muted note when this returns `false` for a
 * number `periksaFormatNomorFaktur` accepts, never blocks submission. DJP has changed the real
 * e-Faktur number format before and will again; a hard pattern would strand real work with no
 * override, so the only hard floor is the loose digit count above. Import-free for the same reason
 * as `status-display.ts` beside it — a client component uses this directly.
 */
const DJP_PATTERN = /^\d{3}\.\d{3}-\d{2}\.\d{8}$/;

export function looksLikeDjpInvoiceNumber(value: string): boolean {
  return DJP_PATTERN.test(value.trim());
}
