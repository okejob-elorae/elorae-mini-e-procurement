/**
 * Pilihan huruf untuk seluruh aplikasi.
 *
 * Dua puluh, bukan semua yang ada di Google Fonts. Daftar yang terlalu panjang
 * bukan pilihan lagi — ia jadi pekerjaan, dan orang berhenti di yang pertama.
 * Yang dikumpulkan di sini: grotesk modern untuk keseharian, beberapa yang
 * berkarakter untuk yang mau tampil, dua serif, dan satu monospasi.
 *
 * `keterangan` ditulis untuk orang yang BUKAN desainer. "Grotesk geometris
 * dengan terminal miring" tidak membantu siapa pun memilih; "bulat dan ramah,
 * enak untuk layar penuh angka" membantu.
 *
 * Berkas ini murni data — nama variabel CSS-nya harus sama persis dengan yang
 * dideklarasikan di `app/layout.tsx`, dan itu dijaga sebuah tes.
 */

export type PilihanFont = {
  /** Disimpan di basis data dan localStorage. Jangan pernah diubah. */
  id: string;
  nama: string;
  keterangan: string;
  /** Variabel CSS yang dibuat `next/font` di layout. */
  variabel: string;
  jenis: 'sans' | 'display' | 'serif' | 'mono';
};

export const DAFTAR_FONT: PilihanFont[] = [
  {
    id: 'jakarta',
    nama: 'Plus Jakarta Sans',
    keterangan: 'Bawaan. Digambar di Jakarta — hangat, bulat, tidak kaku.',
    variabel: '--font-jakarta',
    jenis: 'sans',
  },
  {
    id: 'inter',
    nama: 'Inter',
    keterangan: 'Paling netral. Dibuat khusus untuk layar, terbaca pada ukuran kecil.',
    variabel: '--font-inter',
    jenis: 'sans',
  },
  {
    id: 'geist',
    nama: 'Geist',
    keterangan: 'Bersih dan modern. Angkanya rapi berbaris — bagus untuk tabel.',
    variabel: '--font-geist',
    jenis: 'sans',
  },
  {
    id: 'dm-sans',
    nama: 'DM Sans',
    keterangan: 'Geometris dan tenang. Aman untuk teks panjang.',
    variabel: '--font-dm-sans',
    jenis: 'sans',
  },
  {
    id: 'manrope',
    nama: 'Manrope',
    keterangan: 'Modern dengan sudut sedikit membulat. Ramah tanpa jadi lucu.',
    variabel: '--font-manrope',
    jenis: 'sans',
  },
  {
    id: 'figtree',
    nama: 'Figtree',
    keterangan: 'Lembut dan lapang. Terasa santai.',
    variabel: '--font-figtree',
    jenis: 'sans',
  },
  {
    id: 'outfit',
    nama: 'Outfit',
    keterangan: 'Geometris tegas. Huruf besarnya kuat — cocok untuk judul.',
    variabel: '--font-outfit',
    jenis: 'sans',
  },
  {
    id: 'poppins',
    nama: 'Poppins',
    keterangan: 'Bulat sempurna. Populer, ramah, terasa muda.',
    variabel: '--font-poppins',
    jenis: 'sans',
  },
  {
    id: 'onest',
    nama: 'Onest',
    keterangan: 'Netral yang sedikit lebih hangat dari Inter.',
    variabel: '--font-onest',
    jenis: 'sans',
  },
  {
    id: 'schibsted',
    nama: 'Schibsted Grotesk',
    keterangan: 'Tegas dan rapat. Terasa seperti majalah.',
    variabel: '--font-schibsted',
    jenis: 'sans',
  },
  {
    id: 'archivo',
    nama: 'Archivo',
    keterangan: 'Padat dan kokoh. Muat banyak dalam ruang sempit.',
    variabel: '--font-archivo',
    jenis: 'sans',
  },
  {
    id: 'instrument-sans',
    nama: 'Instrument Sans',
    keterangan: 'Rapi dan sedikit teknis. Enak untuk antarmuka padat.',
    variabel: '--font-instrument-sans',
    jenis: 'sans',
  },
  {
    id: 'space-grotesk',
    nama: 'Space Grotesk',
    keterangan: 'Agak nyeleneh, huruf kecilnya berkarakter. Terasa kekinian.',
    variabel: '--font-space-grotesk',
    jenis: 'display',
  },
  {
    id: 'sora',
    nama: 'Sora',
    keterangan: 'Tegas dan sedikit futuristik.',
    variabel: '--font-sora',
    jenis: 'display',
  },
  {
    id: 'gabarito',
    nama: 'Gabarito',
    keterangan: 'Tebal dan penuh percaya diri. Judulnya menonjol.',
    variabel: '--font-gabarito',
    jenis: 'display',
  },
  {
    id: 'bricolage',
    nama: 'Bricolage Grotesque',
    keterangan: 'Sengaja tidak rapi. Berkarakter kuat — bukan untuk semua orang.',
    variabel: '--font-bricolage',
    jenis: 'display',
  },
  {
    id: 'syne',
    nama: 'Syne',
    keterangan: 'Nyentrik dan artistik. Paling berani di daftar ini.',
    variabel: '--font-syne',
    jenis: 'display',
  },
  {
    id: 'unbounded',
    nama: 'Unbounded',
    keterangan: 'Lebar dan mencolok. Sangat kuat — pakai kalau memang mau ramai.',
    variabel: '--font-unbounded',
    jenis: 'display',
  },
  {
    id: 'fraunces',
    nama: 'Fraunces',
    keterangan: 'Serif yang hidup dan sedikit genit. Terasa seperti butik.',
    variabel: '--font-fraunces',
    jenis: 'serif',
  },
  {
    id: 'instrument-serif',
    nama: 'Instrument Serif',
    keterangan: 'Serif elegan dan tipis. Anggun, cocok untuk merek fesyen.',
    variabel: '--font-instrument-serif',
    jenis: 'serif',
  },
];

/** Yang dipakai kalau belum pernah memilih, atau pilihannya sudah tidak ada. */
export const FONT_BAWAAN = 'jakarta';

export function cariFont(id: string | null | undefined): PilihanFont {
  return DAFTAR_FONT.find((f) => f.id === id) ?? DAFTAR_FONT[0];
}

/**
 * Apakah sebuah id benar-benar ada di daftar.
 *
 * Dipakai penulisnya sebelum menyimpan. Id yang tidak dikenal disimpan begitu
 * saja akan diam-diam jatuh ke bawaan setiap kali dibaca — pengguna memilih
 * sesuatu, tampilannya tidak berubah, dan tidak ada yang menjelaskan kenapa.
 */
export function fontDikenal(id: string): boolean {
  return DAFTAR_FONT.some((f) => f.id === id);
}
