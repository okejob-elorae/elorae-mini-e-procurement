'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import {
  buatBrief,
  gantiGambarKonten,
  hapusBanyakKonten,
  hapusKonten,
  tukarJadwalKonten,
  pindahStatusBrief,
  simpanKol,
  simpanKonten,
  type AlasanGagalKreatif,
  type BarisBarangKirim,
  type BarisDeliverable,
  type IsiKol,
  type IsiKonten,
} from '@/lib/creative/writer';
import type { StatusBrief } from '@/lib/creative/aturan';
import { hapusPalet, simpanPalet, type AlasanGagalPalet } from '@/lib/creative/palet/writer';
import type { AlasanTintaTidakSah, TintaDasar } from '@/lib/creative/sablon/tinta-dasar';
import { simpanTintaDasar } from '@/lib/creative/sablon/writer';

export type HasilAksiKreatif =
  | { ok: true; id?: string; docNo?: string; stokKeluar?: number }
  | { ok: false; kode: AlasanGagalKreatif | 'TANPA_AKSES' | 'GAGAL'; detail?: string };

/**
 * Setiap ekspor berkas `'use server'` adalah endpoint yang bisa dipanggil
 * langsung, jadi izinnya diperiksa di SETIAP aksi — bukan sekali di halamannya.
 * Salah satunya menggerakkan stok gudang.
 */
async function penulis(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE)
    ? session.user.id
    : null;
}

function segarkan() {
  revalidatePath('/backoffice/kreatif/kol');
  revalidatePath('/backoffice/kreatif/brief');
  revalidatePath('/backoffice/kreatif/konten');
}

export async function simpanKolAction(
  id: string | null,
  isi: IsiKol,
): Promise<HasilAksiKreatif> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await simpanKol({ id, isi, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error('simpanKol gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function buatBriefAction(input: {
  kolId: string;
  campaign: string;
  fee: number;
  briefText?: string | null;
  doList?: string | null;
  dontList?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  deliverables: BarisDeliverable[];
  barang?: BarisBarangKirim[];
}): Promise<HasilAksiKreatif> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await buatBrief({
      ...input,
      // Tanggal menyeberang batas server sebagai teks; dipulihkan di sini supaya
      // penulisnya selalu menerima Date, tidak pernah string yang menyamar.
      startDate: input.startDate ? new Date(input.startDate) : null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      deliverables: input.deliverables.map((d) => ({
        ...d,
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
      })),
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id, docNo: r.docNo };
  } catch (err) {
    console.error('buatBrief gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Pindahkan status brief.
 *
 * Perpindahan draft → dikirim MENGELUARKAN STOK GUDANG, jadi aksi ini bukan
 * perubahan label. Kegagalannya dikembalikan sebagai kode, bukan dilempar —
 * lemparan di produksi tersamar jadi digest dan operatornya hanya melihat
 * "terjadi kesalahan" untuk sesuatu yang sebenarnya bisa dijelaskan.
 */
export async function pindahStatusBriefAction(
  briefId: string,
  ke: StatusBrief,
  alasan?: string | null,
): Promise<HasilAksiKreatif> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await pindahStatusBrief({ briefId, ke, alasan, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, stokKeluar: r.stokKeluar };
  } catch (err) {
    console.error('pindahStatusBrief gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
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
): Promise<HasilAksiKreatif> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await simpanKonten({
      id,
      isi: {
        ...isi,
        scheduledAt: isi.scheduledAt ? new Date(isi.scheduledAt) : null,
        publishedAt: isi.publishedAt ? new Date(isi.publishedAt) : null,
      },
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
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await simpanPalet({ masukan, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan };
    revalidatePath('/backoffice/kreatif/palet');
    return { ok: true, id: r.id };
  } catch (err) {
    console.error('simpanPalet gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function hapusPaletAction(id: string): Promise<HasilAksiPalet> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await hapusPalet(id);
    if (!r.ok) return { ok: false, kode: r.alasan };
    revalidatePath('/backoffice/kreatif/palet');
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
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const r = await simpanTintaDasar(tinta);
    if (!r.ok) return { ok: false, kode: r.alasan };
    revalidatePath('/backoffice/kreatif/palet');
    return { ok: true, tinta: r.tinta };
  } catch (err) {
    console.error('simpanTintaDasar gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
