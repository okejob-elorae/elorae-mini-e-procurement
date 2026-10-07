import type { KeadaanTampil } from "@/lib/receivables/jatuh-tempo";
import { cocokCari } from "./_daftar/halaman";

/**
 * Saringan daftar Faktur & Piutang (`?keadaan=`, `?cari=`).
 *
 * Tanpa saringan keadaan, faktur LUNAS disembunyikan — ia bukan piutang lagi,
 * dan bercampur dengan yang terbuka membuat orang membaca Rp 0 sebagai pekerjaan.
 * Yang lunas tetap bisa dibuka lewat saringan "Lunas", atau dengan mencari
 * nomor fakturnya.
 */
export function saringPiutang<
  T extends { invoiceNo: string; storeName: string; salesmanName: string | null; keadaanTampil: KeadaanTampil },
>(baris: T[], s: { keadaan: KeadaanTampil | null; cari: string }): T[] {
  return baris.filter((b) => {
    if (s.keadaan) {
      if (b.keadaanTampil !== s.keadaan) return false;
    } else if (b.keadaanTampil === "lunas" && !(s.cari && cocokCari(s.cari, b.invoiceNo))) {
      return false;
    }
    return cocokCari(s.cari, b.invoiceNo, b.storeName, b.salesmanName);
  });
}
