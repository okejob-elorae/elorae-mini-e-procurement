'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import {
  gantiGambarKonten,
  hapusBanyakKonten,
  hapusKonten,
  tukarJadwalKonten,
  simpanKonten,
  type AlasanGagalKreatif,
  type IsiKonten,
} from '@/lib/creative/writer';

export type HasilAksiKreatif =
  | { ok: true; id?: string; docNo?: string }
  | { ok: false; kode: AlasanGagalKreatif | 'TANPA_AKSES' | 'GAGAL'; detail?: string };

/**
 * Setiap ekspor berkas `'use server'` adalah endpoint yang bisa dipanggil
 * langsung, jadi izinnya diperiksa di SETIAP aksi — bukan sekali di halamannya.
 */
async function penulis(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE)
    ? session.user.id
    : null;
}

function segarkan() {
  // Seluruh ruang Kreatif membaca kolaborasi yang sama; menyegarkan tata
  // letaknya menyegarkan setiap tab sekaligus.
  revalidatePath('/backoffice/kreatif', 'layout');
}

export async function simpanKontenAction(
  id: string | null,
  /*
   * Tanggal menyeberang batas server sebagai TEKS, bukan Date. Menuliskannya
   * sebagai perpotongan (`IsiKonten & { scheduledAt: string }`) menghasilkan
   * `Date & string` — tipe yang tidak bisa dipenuhi apa pun, jadi kolomnya
   * praktis mustahil diisi.
   */
  isi: Omit<IsiKonten, 'scheduledAt' | 'publishedAt'> & {
    scheduledAt?: string | null;
    publishedAt?: string | null;
  },
  /** Wajib bila status dimundurkan (aturan di `lib/creative/rencana-konten.ts`). */
  alasan?: string | null,
): Promise<HasilAksiKreatif> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await simpanKonten({
      id,
      isi: {
        ...isi,
        scheduledAt: isi.scheduledAt === undefined ? undefined : isi.scheduledAt ? new Date(isi.scheduledAt) : null,
        publishedAt: isi.publishedAt === undefined ? undefined : isi.publishedAt ? new Date(isi.publishedAt) : null,
      },
      alasan: typeof alasan === 'string' ? alasan.slice(0, 1000) : null,
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error('simpanKonten gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Ganti gambar satu konten — jalur ubin grid.
 *
 * Terpisah dari `simpanKontenAction` supaya menempel gambar tidak menuntut
 * seluruh isi kontennya dikirim ulang.
 */
export async function gantiGambarKontenAction(
  id: string,
  imageUrl: string | null,
): Promise<HasilAksiKreatif> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await gantiGambarKonten({ id, imageUrl, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error('gantiGambarKonten gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Hapus satu rencana konten. */
export async function hapusKontenAction(id: string): Promise<HasilAksiKreatif> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await hapusKonten({ id, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error('hapusKonten gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Tukar posisi dua ubin di grid — yang berarti menukar JADWALNYA.
 *
 * Urutan grid murni berasal dari tanggal, jadi tidak ada cara memindahkan ubin
 * tanpa memindahkan jadwalnya. Pemanggil wajib memberi tahu penggunanya.
 */
export async function tukarJadwalKontenAction(
  idA: string,
  idB: string,
): Promise<HasilAksiKreatif> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await tukarJadwalKonten({ idA, idB, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error('tukarJadwalKonten gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Hapus beberapa konten sekaligus. */
export async function hapusBanyakKontenAction(
  ids: string[],
): Promise<HasilAksiKreatif & { dihapus?: number }> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await hapusBanyakKonten({ ids, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id, dihapus: r.dihapus };
  } catch (err) {
    console.error('hapusBanyakKonten gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
