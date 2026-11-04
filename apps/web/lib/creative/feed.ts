import type { BarisKonten } from './queries';

/**
 * Menyusun konten jadi grid feed Instagram.
 *
 * Instagram membaca profil dari KIRI ATAS ke kanan bawah, terbaru dulu. Jadi
 * urutan grid ini menurun menurut tanggal — bukan menaik seperti daftar tugas.
 * Ini kelihatan sepele sampai seseorang memasang mockup yang terbalik, lalu
 * seluruh komposisi warna yang disusun art director jadi tidak berarti.
 */

export type SelKonten = { jenis: 'konten'; konten: BarisKonten };
/**
 * Slot yang tanggalnya sudah ditetapkan tapi asetnya belum ada.
 *
 * DIPERTAHANKAN sebagai sel, bukan dilewati. Grid yang merapatkan slot kosong
 * memperlihatkan komposisi yang tidak akan pernah terjadi — dan justru
 * komposisi itulah yang sedang dinilai.
 */
export type SelKosong = { jenis: 'kosong'; konten: BarisKonten };

export type BarisFeed = {
  /** Nomor baris grid, 1 di paling atas — sama seperti kolom A di sheet-nya. */
  nomor: number;
  sel: (SelKonten | SelKosong)[];
};

export const KOLOM_FEED = 3;

/**
 * Bagi konten jadi baris bertiga, terbaru di kiri atas.
 *
 * Yang belum berjadwal (`scheduledAt` null) jatuh ke BAWAH, tidak dibuang: ia
 * belum punya tempat di feed, tapi tetap harus terlihat supaya tidak terlupakan.
 */
export function susunFeed(konten: BarisKonten[]): BarisFeed[] {
  const urut = [...konten].sort((a, b) => {
    if (a.scheduledAt === null && b.scheduledAt === null) return 0;
    if (a.scheduledAt === null) return 1;
    if (b.scheduledAt === null) return -1;
    return b.scheduledAt.localeCompare(a.scheduledAt);
  });

  const baris: BarisFeed[] = [];
  for (let i = 0; i < urut.length; i += KOLOM_FEED) {
    baris.push({
      nomor: Math.floor(i / KOLOM_FEED) + 1,
      sel: urut.slice(i, i + KOLOM_FEED).map((k) =>
        k.imageUrl ? { jenis: 'konten' as const, konten: k } : { jenis: 'kosong' as const, konten: k },
      ),
    });
  }
  return baris;
}

/**
 * Label tanggal di atas satu ubin.
 *
 * Dipisah sebagai fungsi karena sebuah slot yang BELUM berjadwal tidak boleh
 * menampilkan tanggal hari ini — pembaca akan mengira ia dijadwalkan hari ini.
 */
export function labelTanggal(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'id-ID', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Jakarta',
  });
}
