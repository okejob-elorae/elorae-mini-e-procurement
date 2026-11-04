import { Prisma } from '@elorae/db';

/**
 * Kiriman laporan lapangan dari antrean offline HP.
 *
 * Antrean mengirim ulang sampai servernya menjawab, dan jawaban bisa hilang
 * setelah laporannya tersimpan. Setiap laporan membawa kunci yang dibuat HP
 * sekali (`idempotencyKey`, unik di basis data); penulis memeriksanya lebih
 * dulu dan mengembalikan baris yang sudah ada alih-alih mencatat dua kali.
 */

/**
 * Apakah galat ini bentrok pada kolom kunci kiriman — dua kiriman kembar yang
 * tiba bersamaan, bukan nomor dokumen yang dipakai orang lain.
 *
 * Dicocokkan pada seluruh `meta`, bukan `meta.target` saja: bentuknya berbeda
 * antar dialek dan antar versi adaptor (nama constraint, daftar kolom, atau
 * bersarang di galat adaptor), sedangkan nama kolomnya muncul di semuanya.
 */
export function bentrokKunciKiriman(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  return JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes('idempotencyKey');
}
