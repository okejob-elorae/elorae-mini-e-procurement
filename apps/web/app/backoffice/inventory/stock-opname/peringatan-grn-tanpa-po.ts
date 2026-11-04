/*
 * GRN tanpa PO yang masih menunggu konfirmasi admin (P51a) di layar opname gudang. Barangnya
 * sudah ada di rak tetapi belum masuk stok: kalau ikut dihitung (jadi surplus) lalu GRN-nya
 * dikonfirmasi, stoknya dobel. Hanya peringatan — opname tidak ditolak selama ada GRN yang
 * menunggu (belum diputuskan pemilik). Layar hitung memperlihatkannya selama menghitung; layar
 * rincian selama opname masih bisa disetujui.
 *
 * Modul murni, aman diimpor komponen klien.
 */

/** Layar rincian/persetujuan: tampil selama opname belum disetujui dan belum dibatalkan. */
export function peringatanGrnTanpaPoTampil(status: string): boolean {
  return status !== "APPROVED" && status !== "CANCELLED";
}
