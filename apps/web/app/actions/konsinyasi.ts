'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { bolehMengelola } from '@/lib/receivables/izin';
import {
  bayarKomisi,
  bukaKunci,
  bukaSiklus,
  catatLaporan,
  catatNomorDokumen,
  kirimTitipan,
  kunciAngka,
  type AlasanGagalKonsi,
  type BarisKirim,
  type BarisLaporan,
  type BarisResmi,
} from '@/lib/konsinyasi/writer';

export type KodeAksiKonsi = 'TANPA_AKSES' | 'TANGGAL_TIDAK_VALID' | AlasanGagalKonsi | 'GAGAL';
export type HasilAksiKonsi = { ok: true } | { ok: false; kode: KodeAksiKonsi };

function segarkan() {
  revalidatePath('/backoffice/konsinyasi');
}

function tanggalWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Seluruh aksi konsinyasi memakai `receivables:manage`.
 *
 * Brief aslinya memisahkan admin penjualan dan admin pajak sebagai peran
 * sendiri. Elorae belum punya keduanya, dan MENGARANG peran baru di sini akan
 * membuat izin yang tidak pernah diberikan kepada siapa pun — layarnya jadi
 * tidak bisa dibuka sama sekali. Pemisahan itu dicatat sebagai pekerjaan
 * berikutnya, bukan dipura-purakan sudah ada.
 */
async function butuh(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return bolehMengelola(session.user.permissions) ? session.user.id : null;
}

export async function bukaSiklusAction(input: {
  storeId: string;
  periodYear: number;
  periodMonth: number;
  spgDueDate?: string;
}): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  const tenggat = input.spgDueDate ? tanggalWib(input.spgDueDate) : null;
  if (input.spgDueDate && !tenggat) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await bukaSiklus({ ...input, spgDueDate: tenggat });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('bukaSiklus gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function kirimTitipanAction(input: {
  storeId: string;
  cycleId?: string | null;
  shippedAt: string;
  items: BarisKirim[];
  note?: string;
}): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  const tanggal = tanggalWib(input.shippedAt);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await kirimTitipan({ ...input, shippedAt: tanggal });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('kirimTitipan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function catatLaporanAction(input: {
  cycleId: string;
  source: 'SPG' | 'TOKO';
  reportedAt: string;
  items: BarisLaporan[];
  note?: string;
}): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  const tanggal = tanggalWib(input.reportedAt);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await catatLaporan({ ...input, reportedAt: tanggal, reportedById: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('catatLaporan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function kunciAngkaAction(
  cycleId: string,
  baris: BarisResmi[],
  gajiPokokPerSpg?: number,
): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await kunciAngka({ cycleId, baris, gajiPokokPerSpg, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('kunciAngka gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function bukaKunciAction(cycleId: string): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await bukaKunci({ cycleId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('bukaKunci gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function bayarKomisiAction(
  commissionId: string,
  catatan?: string,
): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await bayarKomisi({ commissionId, olehUserId: userId, catatan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('bayarKomisi gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function catatNomorDokumenAction(
  cycleId: string,
  jenis: 'NOTA' | 'PAJAK',
  nomor: string,
): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await catatNomorDokumen({ cycleId, jenis, nomor });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('catatNomorDokumen gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
