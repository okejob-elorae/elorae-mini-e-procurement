import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';

/**
 * Mesin OCR — mengubah gambar jadi baris teks.
 *
 * BERJALAN DI SERVER SENDIRI, bukan di layanan AI mana pun. Ini syarat dari
 * brief dan syarat itu tidak bisa ditawar: foto di modul ini adalah nota retur
 * dan bukti transfer milik toko dan sales.
 *
 * Brief menetapkan Apple Vision lewat program kecil macOS. Itu tidak dipakai di
 * sini, dan alasannya bukan kemalasan: sales memotret dari HP lewat browser dan
 * Elorae berjalan di Linux, jadi sebuah binary macOS tidak bisa melayani satu
 * pun penggunanya. Tesseract berjalan di server yang sama dengan aplikasinya,
 * dan fotonya memang sudah ada di basis data itu — jadi tidak ada satu pun
 * data yang berpindah tangan.
 *
 * Harganya jujur: Tesseract membaca lebih kasar daripada Apple Vision. Karena
 * itu langkah tinjau manusia di `bacaNota` WAJIB, bukan kesopanan.
 */

/**
 * Model bahasa dibundel di repo, TIDAK diunduh saat jalan.
 *
 * Bawaan tesseract.js mengambil model dari CDN pada pemakaian pertama. Yang
 * berpindah memang cuma modelnya, bukan fotonya — tapi ia membuat pembacaan
 * pertama bergantung jaringan keluar, dan sebuah server yang dipagari firewall
 * akan gagal membaca nota tanpa sebab yang jelas bagi penggunanya.
 *
 * `ind` dan `eng` berdampingan: nama barang berbahasa Indonesia, tapi kode SKU
 * dan angka lebih akurat dibaca model Inggris.
 */
const JALUR_MODEL = process.env.OCR_TESSDATA_PATH ?? path.join(process.cwd(), 'tessdata');

/**
 * Satu worker dipakai ulang.
 *
 * Menyiapkan worker berarti memuat WASM dan modelnya; melakukannya tiap
 * permintaan membuang beberapa ratus milidetik untuk pekerjaan yang persis sama.
 * Prosesnya panjang umur (VPS, bukan serverless), jadi menyimpannya aman.
 */
let worker: Promise<Worker> | null = null;

function ambilWorker(): Promise<Worker> {
  if (!worker) {
    worker = createWorker(['ind', 'eng'], 1, {
      langPath: JALUR_MODEL,
      gzip: true,
      // Tidak menyalin model ke cache: berkasnya sudah ada di disk, dan salinan
      // kedua hanya bisa basi.
      cacheMethod: 'none',
    }).catch((err) => {
      // Kegagalan penyiapan TIDAK boleh menempel. Kalau promise gagalnya
      // disimpan, satu kegagalan sesaat membuat OCR mati sampai proses
      // direstart — dan tidak ada yang tahu kenapa.
      worker = null;
      throw err;
    });
  }
  return worker;
}

/**
 * Antrean satu-satu.
 *
 * Worker Tesseract tidak bisa dipanggil ulang saat masih membaca. Dua permintaan
 * yang datang bersamaan akan saling merusak hasil — dan hasil yang rusak di
 * sini adalah angka uang di layar seseorang.
 */
let antrean: Promise<unknown> = Promise.resolve();

export type HasilOcr = {
  baris: string[];
  /** Keyakinan mesin, 0–100. Rendah berarti fotonya buruk, bukan notanya. */
  keyakinan: number;
  msBaca: number;
};

/** Baca satu gambar jadi baris teks. */
export async function bacaGambar(gambar: Buffer): Promise<HasilOcr> {
  const giliran = antrean.then(async () => {
    const w = await ambilWorker();
    const mulai = Date.now();
    const { data } = await w.recognize(gambar);
    return {
      baris: data.text.split('\n').filter((b) => b.trim() !== ''),
      keyakinan: data.confidence,
      msBaca: Date.now() - mulai,
    };
  });
  // Antrean tetap jalan walau giliran ini gagal; kalau tidak, satu kegagalan
  // membekukan setiap permintaan sesudahnya.
  antrean = giliran.catch(() => undefined);
  return giliran;
}
