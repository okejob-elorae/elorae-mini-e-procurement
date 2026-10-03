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
