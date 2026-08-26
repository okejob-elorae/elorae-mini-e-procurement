import { Prisma } from '@elorae/db';

/**
 * Penomoran dokumen yang mengulang sendiri saat bentrok.
 *
 * Setiap nomor dokumen di modul ini dibuat dengan pola "cari yang terakhir,
 * tambah satu". Pola itu TIDAK atomik: dua orang yang menyimpan pada detik yang
 * sama sama-sama membaca nomor terakhir yang sama dan sama-sama menyusun nomor
 * berikutnya yang sama.
 *
 * Kolomnya `@unique`, jadi yang kalah TIDAK PERNAH mendapat nomor kembar — ia
 * gagal. Itu benar, dan itulah penjagaan sebenarnya. Yang salah adalah apa yang
 * terjadi sesudahnya: sebelum ini, yang kalah kehilangan seluruh isian dan
 * hanya diberi tahu "nomor bentrok", padahal yang perlu dilakukan hanyalah
 * mengambil nomor berikutnya. Sales di lapangan tidak punya cara menafsirkan
 * kalimat itu selain mengetik ulang semuanya.
 *
 * Maka: ulangi seluruh transaksinya. Percobaan kedua membaca nomor terakhir
 * yang sudah berisi milik pemenang, jadi ia menyusun nomor sesudahnya.
 *
 * SENGAJA TIDAK memakai tabel urutan tersendiri. Tabel urutan menuntut migrasi,
 * menuntut baris awal per awalan per tahun, dan tetap bisa bolong kalau
 * transaksinya batal setelah nomornya diambil. Mengulang pada bentrok memberi
 * nomor rapat tanpa satu pun dari itu.
 */

/**
 * Nama kolom nomor yang boleh diulang saat bentrok.
 *
 * `noNrt` TIDAK ADA di sini, dan itu inti pembedaannya: NRT adalah nomor nota
 * TOKO — diketik orang, bukan disusun mesin. Bentrok di sana berarti nomor itu
 * memang sudah pernah dipakai toko tersebut, dan mengulang hanya akan gagal
 * lagi dengan cara yang sama sambil menyembunyikan sebabnya. Yang begitu harus
 * sampai ke layar apa adanya.
 */
const KOLOM_NOMOR_MESIN = ['docNo', 'noNri', 'noKirim', 'noKonsi'];

function bentrokNomorMesin(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }
  /*
   * Bentuk `meta.target` berbeda antar dialek: Postgres memberi nama constraint
   * (`PaymentClaim_docNo_key`), MySQL memberi daftar kolom. Dicocokkan sebagai
   * teks supaya keduanya terbaca tanpa perlu tahu sedang di mana.
   */
  const target = err.meta?.target;
  const teks = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return KOLOM_NOMOR_MESIN.some((kolom) => teks.includes(kolom));
}

/**
 * Jalankan sebuah penyimpanan yang menyusun nomornya sendiri, ulangi kalau
 * nomornya keburu diambil orang lain.
 *
 * Batasnya kecil dengan sengaja: kalau tiga percobaan berturut-turut kalah,
 * yang terjadi bukan lagi tabrakan kebetulan melainkan sesuatu yang lain, dan
 * mengulang lebih banyak hanya menunda kabarnya.
 */
export async function denganNomorUnik<T>(jalankan: () => Promise<T>, batas = 3): Promise<T> {
  let terakhir: unknown;
  for (let percobaan = 0; percobaan < batas; percobaan++) {
    try {
      return await jalankan();
    } catch (err) {
      if (!bentrokNomorMesin(err)) throw err;
      terakhir = err;
    }
  }
  throw terakhir;
}
