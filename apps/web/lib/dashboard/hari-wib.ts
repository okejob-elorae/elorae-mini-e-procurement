/**
 * Batas "hari ini" dan "minggu ini" dalam hari kalender WIB.
 *
 * Server produksi berjalan di UTC. `setHours(0, 0, 0, 0)` memotong hari di
 * tengah malam UTC — jam 07.00 WIB — sehingga penjualan antara 00.00 dan 07.00
 * WIB masuk "kemarin" dan angka "hari ini" di beranda kehilangan tujuh jam
 * pertamanya. Semua batas di sini dihitung dari tanggal WIB, tidak bergantung
 * zona waktu proses.
 */

const WIB_MS = 7 * 3_600_000;
const HARI_MS = 86_400_000;

/** Tanggal WIB (YYYY-MM-DD) dari sebuah instan. */
export function tanggalWib(d: Date): string {
  return new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10);
}

/** Instan 00.00.00.000 WIB pada tanggal WIB yang diberikan. */
function awalTanggalWib(tanggal: string): Date {
  return new Date(Date.parse(`${tanggal}T00:00:00.000Z`) - WIB_MS);
}

/** Hari ini WIB: awal (inklusif), akhir (inklusif, .999), dan tanggalnya. */
export function batasHariIniWib(sekarang: Date = new Date()): { awal: Date; akhir: Date; tanggal: string } {
  const tanggal = tanggalWib(sekarang);
  const awal = awalTanggalWib(tanggal);
  return { awal, akhir: new Date(awal.getTime() + HARI_MS - 1), tanggal };
}

/** Senin 00.00 WIB minggu ini. Minggu dihitung Senin–Minggu. */
export function awalMingguIniWib(sekarang: Date = new Date()): Date {
  const { awal, tanggal } = batasHariIniWib(sekarang);
  const hari = new Date(`${tanggal}T00:00:00Z`).getUTCDay(); // 0 = Minggu
  const mundur = hari === 0 ? 6 : hari - 1;
  return new Date(awal.getTime() - mundur * HARI_MS);
}

/**
 * Bulan WIB yang sedang berjalan sebagai tanggal isian (YYYY-MM-DD): tanggal 1
 * sampai hari terakhirnya. Rentang bawaan "bulan ini" Laporan operasional dulu
 * dibuat dari `new Date(y, m, 1).toISOString()` — di peramban WIB itu menjadi
 * tanggal 30 bulan sebelumnya, sehingga laporan bulanan ikut menghitung satu
 * hari bulan lalu dan melewatkan hari terakhirnya.
 */
export function bulanIniWib(sekarang: Date = new Date()): { dari: string; sampai: string } {
  const [y, m] = tanggalWib(sekarang).split("-").map(Number);
  const akhir = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const bulan = String(m).padStart(2, "0");
  return { dari: `${y}-${bulan}-01`, sampai: `${y}-${bulan}-${String(akhir).padStart(2, "0")}` };
}

const TANGGAL_ISIAN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tanggal isian → batas instan WIB untuk kueri: `dari` 00.00 WIB, `sampai`
 * 23.59.59,999 WIB (inklusif). `new Date("2026-10-31")` adalah 07.00 WIB, jadi
 * hari terakhir rentang kehilangan semua yang dicatat sesudah jam 7 pagi.
 * Isian kosong/rusak = tanpa batas di sisi itu.
 */
export function batasRentangWib(dari: string, sampai: string): { dari?: Date; sampai?: Date } {
  const sah = (s: string) => TANGGAL_ISIAN.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
  return {
    dari: sah(dari) ? awalTanggalWib(dari) : undefined,
    sampai: sah(sampai) ? new Date(awalTanggalWib(sampai).getTime() + HARI_MS - 1) : undefined,
  };
}
