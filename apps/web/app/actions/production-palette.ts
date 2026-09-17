'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { hapusPalet, simpanPalet, type AlasanGagalPalet } from '@/lib/production-colors/palet/writer';
import type { AlasanTintaTidakSah, TintaDasar } from '@/lib/production-colors/sablon/tinta-dasar';
import { simpanTintaDasar } from '@/lib/production-colors/sablon/writer';

const HALAMAN = '/backoffice/production/palette';

/**
 * Setiap ekspor berkas `'use server'` adalah endpoint yang bisa dipanggil
 * langsung, jadi izinnya diperiksa di SETIAP aksi — bukan sekali di halamannya.
 * Melihat palet cukup `production_colors:view`; menulis palet dan tinta dasar,
 * yang dipakai seluruh tim produksi, butuh `production_colors:manage`.
 */
async function pengelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.PRODUCTION_COLORS_MANAGE) ? session.user.id : null;
}

export type HasilAksiPalet =
  | { ok: true; id?: string }
  | { ok: false; kode: AlasanGagalPalet | 'TANPA_AKSES' | 'GAGAL' };

/**
 * Simpan palet dari roda warna.
 *
 * Isinya diperiksa ulang di penulis, bukan dipercayakan pada roda: aksi ini
 * bisa dipanggil langsung tanpa melewati layar.
 */
export async function simpanPaletAction(masukan: {
  nama: string;
  aturan: string;
  warna: string[];
  kain?: string | null;
  porsi?: number[] | null;
}): Promise<HasilAksiPalet> {
  const oleh = await pengelola();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await simpanPalet({ masukan, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan };
    revalidatePath(HALAMAN);
    return { ok: true, id: r.id };
  } catch (err) {
    console.error('simpanPalet gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function hapusPaletAction(id: string): Promise<HasilAksiPalet> {
  const oleh = await pengelola();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await hapusPalet(id);
    if (!r.ok) return { ok: false, kode: r.alasan };
    revalidatePath(HALAMAN);
    return { ok: true };
  } catch (err) {
    console.error('hapusPalet gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export type HasilAksiTintaDasar =
  | { ok: true; tinta: TintaDasar[] }
  | { ok: false; kode: AlasanTintaTidakSah | 'TANPA_AKSES' | 'GAGAL' };

/** Ganti daftar tinta dasar tim — bahan resep campur untuk palet berkain. */
export async function simpanTintaDasarAction(tinta: TintaDasar[]): Promise<HasilAksiTintaDasar> {
  const oleh = await pengelola();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await simpanTintaDasar(tinta);
    if (!r.ok) return { ok: false, kode: r.alasan };
    revalidatePath(HALAMAN);
    return { ok: true, tinta: r.tinta };
  } catch (err) {
    console.error('simpanTintaDasar gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
