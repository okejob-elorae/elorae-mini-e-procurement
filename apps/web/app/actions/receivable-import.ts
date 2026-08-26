'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import type { BarisImpor } from '@/lib/receivables/impor/baris';
import { simpanImpor, tinjauImpor, type HasilImpor, type TinjauanImpor } from '@/lib/receivables/impor/writer';

export type HasilAksiImpor =
  | { ok: true; tinjauan: TinjauanImpor }
  | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' };

export type HasilAksiSimpanImpor =
  | { ok: true; hasil: HasilImpor }
  | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' };

/**
 * Baris hasil urai dikirim dari klien, bukan berkasnya.
 *
 * Penguraiannya murni dan berjalan di browser, jadi berkas mentahnya tidak
 * pernah meninggalkan mesin pengguna — dan yang disimpan adalah persis yang
 * dilihatnya di pratinjau, bukan hasil urai kedua yang bisa berbeda.
 */

/** Berapa yang akan masuk, dan apa yang tidak. Tidak menulis apa pun. */
export async function tinjauImporAction(baris: BarisImpor[]): Promise<HasilAksiImpor> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    return { ok: true, tinjauan: await tinjauImpor(pulihkanTanggal(baris)) };
  } catch (err) {
    console.error('tinjauImpor gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Simpan yang lolos. */
export async function simpanImporAction(baris: BarisImpor[]): Promise<HasilAksiSimpanImpor> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await simpanImpor(pulihkanTanggal(baris));
    revalidatePath('/backoffice/piutang');
    return { ok: true, hasil };
  } catch (err) {
    console.error('simpanImpor gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Kembalikan `Date` yang jadi string saat melintasi batas server action.
 *
 * Muatan aksi server diserialkan, dan `Date` tiba sebagai string ISO. Tanpa
 * pemulihan ini `dueDate` masuk sebagai teks dan Prisma menolaknya — atau lebih
 * buruk, sebuah `undefined` diam-diam menjadi tanggal hari ini.
 */
function pulihkanTanggal(baris: BarisImpor[]): BarisImpor[] {
  const tgl = (v: unknown): Date | null => {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return baris.map((b) => ({
    ...b,
    tglFaktur: tgl(b.tglFaktur),
    jatuhTempo: tgl(b.jatuhTempo),
  }));
}
