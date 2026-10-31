import { ensurePeriodRows, prisma } from "@elorae/db";
import { bulanSesudah, bulanWib } from "./periode";

/**
 * Membuat baris `AccountingPeriod` (TERBUKA) bulan berjalan dan bulan depan
 * bila belum ada. Dipanggil cron harian: posting jurnal pertama di sebuah
 * bulan lalu tidak perlu menyisipkan barisnya sendiri, satu-satunya keadaan
 * di mana dua posting bersamaan di MariaDB bisa saling mengunci (gap lock).
 */
export async function siapkanBarisPeriode(sekarang: Date = new Date()): Promise<void> {
  const ini = bulanWib(sekarang);
  const depan = bulanSesudah(ini);
  await ensurePeriodRows(prisma, [
    { year: ini.tahun, month: ini.bulan },
    { year: depan.tahun, month: depan.bulan },
  ]);
}
