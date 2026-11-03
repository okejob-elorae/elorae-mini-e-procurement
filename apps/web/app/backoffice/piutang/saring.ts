import { URUT_KEADAAN_TAMPIL, masukLewatJatuhTempo, nilaiLewatJatuhTempo, type KeadaanTampil } from "@/lib/receivables/jatuh-tempo";
import { cocokJenisTagihan, type JenisTagihan } from "@/lib/receivables/jenis-tagihan";
import { cocokCari } from "./_daftar/halaman";

/**
 * Saringan daftar Faktur & Piutang (`?keadaan=`, `?cari=`, `?jenis=`).
 *
 * Tanpa saringan keadaan, faktur LUNAS disembunyikan — ia bukan piutang lagi,
 * dan bercampur dengan yang terbuka membuat orang membaca Rp 0 sebagai pekerjaan.
 * Yang lunas tetap bisa dibuka lewat saringan "Lunas", atau dengan mencari
 * nomor fakturnya.
 *
 * `jenis` (konsi / nonkonsi, keputusan pemilik 2026-10-29) diterapkan lebih dulu,
 * dari penanda `Receivable.isConsignment` (`konsi`). Baris tanpa `konsi` dibaca
 * bukan konsinyasi.
 *
 * "Lewat jatuh tempo" memakai SATU definisi P46 (`masukLewatJatuhTempo`): juga
 * nota yang sebagian ditahan retur dan bagian bebasnya sudah lewat tempo.
 */
export function saringPiutang<
  T extends {
    invoiceNo: string;
    storeName: string;
    salesmanName: string | null;
    keadaanTampil: KeadaanTampil;
    konsi?: boolean;
    alasan?: { lewatTempoDiLuarTahanan?: { hari: number; nilai: number } };
  },
>(baris: T[], s: { keadaan: KeadaanTampil | null; cari: string; jenis?: JenisTagihan | null }): T[] {
  return baris.filter((b) => {
    if (!cocokJenisTagihan(Boolean(b.konsi), s.jenis ?? null)) return false;
    if (s.keadaan === "jatuh_tempo") {
      if (!masukLewatJatuhTempo(b)) return false;
    } else if (s.keadaan) {
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
 * dan mengikuti kotak cari serta jenis: angka pil = jumlah baris yang muncul
 * saat pil itu diklik. Dulu pil tetap "Belum lunas 6" sementara pencarian
 * menyisakan 2 baris.
 *
 * Nilai pil "Lewat jatuh tempo" menjumlahkan bagian yang lewat tempo saja
 * (`nilaiLewatJatuhTempo`): seluruh sisa untuk faktur `jatuh_tempo`, bagian
 * bebas untuk nota yang sebagian ditahan (P46).
 */
export function hitungPilPiutang<
  T extends {
    invoiceNo: string;
    storeName: string;
    salesmanName: string | null;
    keadaanTampil: KeadaanTampil;
    outstanding: number;
    konsi?: boolean;
    alasan?: { lewatTempoDiLuarTahanan?: { hari: number; nilai: number } };
  },
>(baris: T[], cari: string, jenis: JenisTagihan | null = null): PilPiutang {
  const jumlahkan = (xs: T[], k: KeadaanTampil | null): Jumlah => ({
    jumlah: xs.length,
    nilai: xs.reduce((n, b) => n + (k === "jatuh_tempo" ? (nilaiLewatJatuhTempo(b) ?? 0) : b.outstanding), 0),
  });
  const perKeadaan = Object.fromEntries(
    URUT_KEADAAN_TAMPIL.map((k) => [k, jumlahkan(saringPiutang(baris, { keadaan: k, cari, jenis }), k)]),
  ) as Record<KeadaanTampil, Jumlah>;
  return { semua: jumlahkan(saringPiutang(baris, { keadaan: null, cari, jenis }), null), perKeadaan };
}
