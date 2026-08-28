import { daftarPiutang, ringkasPiutang } from '@/lib/receivables/queries';

/**
 * Angka piutang untuk beranda.
 *
 * DIHITUNG ULANG dari nol, bukan dijumlahkan dari kolom `outstanding`.
 *
 * Kolom itu cache, dan seluruh modul piutang berdiri di atas satu aturan:
 * sisa tidak pernah dibaca dari kolom, selalu dihitung ulang dari klaim yang
 * menyentuhnya. Beranda yang melanggar aturan itu akan menyebut angka berbeda
 * dari layar Piutang — dan dua layar yang berselisih tentang uang membuat orang
 * berhenti mempercayai keduanya, bukan cuma yang salah.
 *
 * HARGANYA NYATA: ini bacaan terberat di modul itu, dan sekarang beranda ikut
 * memikulnya tiap dibuka. Kalau suatu hari jadi lambat, jalan keluarnya bukan
 * membaca kolom cache melainkan menyempitkan `daftarPiutang` — ia sudah punya
 * lingkup, tinggal dipakai.
 */
export type RingkasPiutangBeranda = {
  total: number;
  jumlah: number;
  /** Yang sudah lewat janji bayar — ini yang menuntut tindakan hari ini. */
  lewatNilai: number;
  lewatJumlah: number;
  /** Ditahan karena retur belum dihitung gudang. */
  tertahanNilai: number;
};

export async function ringkasPiutangBeranda(): Promise<RingkasPiutangBeranda> {
  const baris = await daftarPiutang({ hanyaTerbuka: true });
  const r = ringkasPiutang(baris);
  return {
    total: r.total,
    jumlah: r.jumlahPiutang,
    lewatNilai: r.perKeadaan.lewat.nilai,
    lewatJumlah: r.perKeadaan.lewat.jumlah,
    tertahanNilai: r.perKeadaan.tertahan.nilai,
  };
}
