import { URUT_KEADAAN_TAMPIL, type KeadaanTampil } from "@/lib/receivables/jatuh-tempo";
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

type Jumlah = { jumlah: number; nilai: number };

/** Angka pil saringan: "Belum lunas" + satu per keadaan. */
export type PilPiutang = { semua: Jumlah; perKeadaan: Record<KeadaanTampil, Jumlah> };

/**
 * Angka setiap pil, dihitung dengan `saringPiutang` yang SAMA dengan daftarnya
 * dan mengikuti kotak cari: angka pil = jumlah baris yang muncul saat pil itu
 * diklik. Dulu pil tetap "Belum lunas 6" sementara pencarian menyisakan 2 baris.
 */
export function hitungPilPiutang<
  T extends {
    invoiceNo: string;
    storeName: string;
    salesmanName: string | null;
    keadaanTampil: KeadaanTampil;
    outstanding: number;
  },
>(baris: T[], cari: string): PilPiutang {
  const jumlahkan = (xs: T[]): Jumlah => ({ jumlah: xs.length, nilai: xs.reduce((n, b) => n + b.outstanding, 0) });
  const perKeadaan = Object.fromEntries(
    URUT_KEADAAN_TAMPIL.map((k) => [k, jumlahkan(saringPiutang(baris, { keadaan: k, cari }))]),
  ) as Record<KeadaanTampil, Jumlah>;
  return { semua: jumlahkan(saringPiutang(baris, { keadaan: null, cari })), perKeadaan };
}
