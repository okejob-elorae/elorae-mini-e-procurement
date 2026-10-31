/**
 * Membedakan "kiriman tidak sampai" dari "server menolak" saat salesman menekan
 * Kirim dalam keadaan HP merasa online tapi sinyalnya lemah.
 *
 * Yang tidak sampai masuk antrean HP dengan kunci idempotensi YANG SAMA, jadi
 * kalau ternyata server sempat mencatatnya, kiriman ulang dari antrean hanya
 * mengembalikan pesanan yang sudah ada — tidak pernah jadi dua pesanan.
 * Penolakan server (`{ ok: false, code }`) dan galat server tidak pernah
 * diantrekan: mengirim ulang hanya menghasilkan penolakan yang sama.
 *
 * Murni (tanpa DOM, tanpa impor server) supaya bisa dites.
 */

/** Kiriman yang terlalu lama menggantung di sinyal lemah. */
export class BatasWaktuKirim extends Error {
  constructor() {
    super("BATAS_WAKTU_KIRIM");
    this.name = "BatasWaktuKirim";
  }
}

/** Lama menunggu jawaban server sebelum pesanan dipindah ke antrean HP. */
export const BATAS_WAKTU_KIRIM_MS = 25_000;

/**
 * Tolak dengan `BatasWaktuKirim` kalau `janji` belum selesai dalam `ms`.
 * Janji aslinya tetap berjalan; hasilnya yang terlambat diabaikan pemanggil.
 */
export function denganBatasWaktu<T>(janji: Promise<T>, ms: number = BATAS_WAKTU_KIRIM_MS): Promise<T> {
  return new Promise<T>((selesai, gagal) => {
    const pengatur = setTimeout(() => gagal(new BatasWaktuKirim()), ms);
    janji.then(
      (hasil) => {
        clearTimeout(pengatur);
        selesai(hasil);
      },
      (err: unknown) => {
        clearTimeout(pengatur);
        gagal(err);
      },
    );
  });
}

/**
 * Apakah galat dari pemanggilan aksi server berarti permintaannya tidak sampai
 * (atau jawabannya tidak kembali).
 *
 * `fetch` yang putus melempar `TypeError` ("Failed to fetch" di Chrome, "Load
 * failed" di Safari, "NetworkError…" di Firefox). Galat yang dilempar SERVER
 * sampai ke browser sebagai `Error` biasa, biasanya membawa `digest` — itu
 * bukan urusan jaringan dan tidak boleh diantrekan.
 */
export function galatJaringan(err: unknown, online: boolean): boolean {
  if (err instanceof BatasWaktuKirim) return true;
  if (!online) return true;
  if (err instanceof TypeError) return true;
  if (err instanceof Error && !("digest" in err)) {
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed|network error/i.test(err.message);
  }
  return false;
}
