/**
 * Batas tunggu jawaban server untuk kiriman dari HP.
 *
 * Aksi server tidak bisa dibatalkan, jadi yang dibatasi hanya penantiannya:
 * sesudah `ms`, pemanggil menganggap kirimannya tidak sampai dan
 * mengantrekannya. Jawaban yang ternyata datang belakangan tidak berbahaya —
 * setiap kiriman membawa kuncinya sendiri, dan antrean yang mengirim ulang
 * mendapat hasil yang sama. Penolakan yang datang sesudah batas ditelan di
 * sini (tidak menjadi "unhandled rejection").
 */
export const BATAS_JAWABAN_MS = 20_000;

export class BatasWaktuHabis extends Error {
  constructor() {
    super("BATAS_WAKTU");
    this.name = "BatasWaktuHabis";
  }
}

export function denganBatasWaktu<T>(janji: Promise<T>, ms: number = BATAS_JAWABAN_MS): Promise<T> {
  return new Promise<T>((selesai, gagal) => {
    const pewaktu = setTimeout(() => gagal(new BatasWaktuHabis()), ms);
    janji.then(
      (nilai) => {
        clearTimeout(pewaktu);
        selesai(nilai);
      },
      (err: unknown) => {
        clearTimeout(pewaktu);
        gagal(err);
      },
    );
  });
}

/** Tidak ada sinyal sama sekali — kirim langsung ke antrean tanpa mencoba. */
export function tanpaSinyal(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
