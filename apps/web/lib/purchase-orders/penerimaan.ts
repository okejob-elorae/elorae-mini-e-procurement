/*
 * Status PO yang boleh menerima barang (GRN). Satu aturan untuk penulis GRN:
 * - DRAFT: belum disetujui/dikirim ke pemasok;
 * - CANCELLED: dibatalkan;
 * - CLOSED: sudah ditutup — lengkap lewat GRN atau ditutup lewat "Tutup PO".
 *   GRN berikutnya akan menghitung ulang status dan membuka kembali PO itu.
 * SUBMITTED, PARTIAL dan OVER (terima-lebih yang sudah disetujui) tetap boleh.
 */

export type KodeTolakPenerimaanPo = "PO_BELUM_DISETUJUI" | "PO_DIBATALKAN" | "PO_DITUTUP";

export function alasanTolakPenerimaanPo(status: string): KodeTolakPenerimaanPo | null {
  if (status === "DRAFT") return "PO_BELUM_DISETUJUI";
  if (status === "CANCELLED") return "PO_DIBATALKAN";
  if (status === "CLOSED") return "PO_DITUTUP";
  return null;
}
