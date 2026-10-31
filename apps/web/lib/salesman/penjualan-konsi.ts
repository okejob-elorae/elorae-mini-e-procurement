import { kunciHariWib } from "@/lib/dashboard/tren";

/**
 * Omzet KONSINYASI salesman — satu aturan, satu tempat (keputusan pemilik
 * 2026-10-06, "ikuti usulan Claude dulu"). Kuerinya di `penjualan-konsi-queries.ts`.
 *
 * Mengirim barang titipan BUKAN menjual: pesanan konsi yang disetujui hanya
 * memindahkan barang ke gudang lain (toko). Omzet konsi baru ada saat barang
 * itu LAKU di toko:
 * - toko yang punya buku stok (SPG mencatat): JUAL dikurangi RETUR_PEMBELI,
 *   menurut tanggal gerakannya;
 * - bulan sebelum buku toko itu dimulai (atau toko tanpa buku sama sekali):
 *   laporan laku resmi siklus konsinyasi yang sudah dikunci
 *   (`ConsignmentSold`), dianggap laku di akhir bulan siklusnya. Bulan saat
 *   buku dimulai dan sesudahnya dibaca dari buku saja — dua sumber tidak
 *   pernah dijumlahkan untuk bulan yang sama.
 *
 * Nilainya HARGA ELORAE: harga yang Elorae terima per potong di toko itu
 * (`hargaTerimaKonsi` — harga di toko ÷ (1 + markup toko sekarang)), sama
 * dengan dasar "harga toko terima" barang hilang; barang yang belum pernah
 * dikirim berharga ke toko itu jatuh ke harga jual Elorae.
 *
 * Omzetnya milik PEMEGANG toko pada SAAT barang itu laku (`Store.salesmanId`
 * sekarang, dibaca mundur lewat jejak `STORE_SALESMAN_CHANGED`) — rotasi toko
 * tidak memindahkan omzet bulan-bulan sebelumnya. Saat toko tanpa pemegang:
 * milik salesman yang mengirim pesanan konsi disetujui terakhir ke toko itu
 * sampai saat laku — sama dengan aturan penagih piutang (pemegang dulu,
 * penjual sebagai cadangan).
 *
 * Di HP salesman konsinyasi tetap TANPA rupiah (aturan mutlak) — hanya pcs
 * laku. Layar kantor (komisi, target, peringkat, rincian sales) memakai
 * rupiahnya.
 */

/** Dasar omzet konsinyasi yang berlaku. Diganti di sini bila pemilik memutuskan lain. */
export const DASAR_OMZET_KONSI = "LAKU_DI_TOKO" as const;

/** Satu gerakan laku konsinyasi yang dihitung untuk seorang salesman. */
export type BarisLakuKonsi = {
  tanggal: Date;
  storeId: string;
  itemId: string;
  /** "" = per barang (laporan resmi tidak mencatat ukuran). */
  variantSku: string;
  /** Laku bersih; negatif untuk barang yang dikembalikan pembeli. */
  pcs: number;
  /** pcs × harga Elorae, rupiah (dua desimal). */
  nilai: number;
};

/** Pemilik omzet laku satu toko konsinyasi; null = tidak dihitung ke siapa pun. */
export function pemilikOmzetKonsi(t: { pemegangId: string | null; pengirimTerakhirId: string | null }): string | null {
  return t.pemegangId || t.pengirimTerakhirId || null;
}

/** Satu pergantian pemegang toko dari jejaknya: kapan, dan siapa pemegang SEBELUM itu. */
export type GantiPemegang = { pada: Date; sebelum: string | null };

/**
 * Pemegang toko pada saat `t`: nilai "sebelum" dari pergantian pertama yang
 * terjadi SESUDAH `t`; tanpa pergantian sesudahnya, pemegang sekarang.
 * Tidak bergantung pada rantai sebelum→sesudah yang rapi.
 */
export function pemegangPada(riwayat: readonly GantiPemegang[], sekarang: string | null, t: Date): string | null {
  let pertama: GantiPemegang | null = null;
  for (const g of riwayat) if (g.pada > t && (!pertama || g.pada < pertama.pada)) pertama = g;
  return pertama ? pertama.sebelum || null : sekarang || null;
}

/** Satu pesanan konsi yang disetujui ke toko itu. */
export type KirimanKonsi = { pada: Date; salesmanId: string };

/**
 * Pengirim konsi pada saat `t`: yang disetujui terakhir sampai `t`; bila toko
 * belum pernah dikirimi sampai saat itu (laku dari stok pembukaan), pengirim
 * pertama sesudahnya.
 */
export function pengirimPada(kiriman: readonly KirimanKonsi[], t: Date): string | null {
  let sebelum: KirimanKonsi | null = null;
  let sesudah: KirimanKonsi | null = null;
  for (const k of kiriman) {
    if (k.pada <= t) {
      if (!sebelum || k.pada > sebelum.pada) sebelum = k;
    } else if (!sesudah || k.pada < sesudah.pada) sesudah = k;
  }
  return (sebelum ?? sesudah)?.salesmanId ?? null;
}

/** "YYYY-MM" dari tahun & bulan siklus. */
export function kunciBulanSiklus(tahun: number, bulan: number): string {
  return `${tahun}-${String(bulan).padStart(2, "0")}`;
}

/**
 * Apakah laporan laku resmi satu siklus dipakai: hanya bila toko belum punya
 * buku, atau bulan siklusnya SEBELUM bulan (WIB) gerakan buku pertamanya.
 */
export function laporanSiklusDipakai(bulanSiklus: string, bukuPertama: Date | null): boolean {
  if (!bukuPertama) return true;
  return bulanSiklus < kunciHariWib(bukuPertama).slice(0, 7);
}

/**
 * Tanggal laku sebuah laporan siklus: saat terakhir bulannya (WIB), dibatasi
 * `sekarang` — siklus bulan berjalan yang dikunci lebih awal tetap jatuh di
 * bulannya sendiri dan tidak di masa depan.
 */
export function tanggalLaporanSiklus(tahun: number, bulan: number, sekarang: Date): Date {
  const berikut = bulan === 12 ? `${tahun + 1}-01` : `${tahun}-${String(bulan + 1).padStart(2, "0")}`;
  const akhir = new Date(new Date(`${berikut}-01T00:00:00+07:00`).getTime() - 1);
  return akhir > sekarang ? sekarang : akhir;
}

/** Nilai laku dalam rupiah dari pcs × harga satuan dalam sen — dihitung dalam sen bulat. */
export function nilaiLaku(pcs: number, unitSen: number): number {
  return (pcs * Math.round(unitSen)) / 100;
}

/** Jumlah pcs laku per tanggal — bahan pcs konsinyasi di HP (tanpa rupiah). */
export function pcsDariLaku(baris: readonly BarisLakuKonsi[]): { tanggal: Date; pcs: number }[] {
  return baris.map((b) => ({ tanggal: b.tanggal, pcs: b.pcs }));
}
