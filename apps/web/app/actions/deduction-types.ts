'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { bolehMengelola } from '@/lib/receivables/izin';
import {
  nonaktifkanJenisPotongan,
  simpanJenisPotongan,
  type AlasanGagalJenis,
  type CaraPotongan,
} from '@/lib/receivables/deduction-types';

export type HasilAksiJenis =
  | { ok: true }
  | { ok: false; kode: 'TANPA_AKSES' | AlasanGagalJenis | 'GAGAL' };

function segarkan() {
  revalidatePath('/backoffice/settings/jenis-potongan');
  revalidatePath('/backoffice/pelunasan/baru');
}

export async function simpanJenisPotonganAction(input: {
  id?: string | null;
  nama: string;
  cara: CaraPotongan;
  bolehManual: boolean;
  hanyaPkp: boolean;
  wajibCatatan: boolean;
  aktif: boolean;
  peranJurnal?: string | null;
}): Promise<HasilAksiJenis> {
  const session = await auth();
  if (!session?.user?.id || !bolehMengelola(session.user.permissions)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await simpanJenisPotongan({ ...input, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('simpanJenisPotongan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function nonaktifkanJenisPotonganAction(id: string): Promise<HasilAksiJenis> {
  const session = await auth();
  if (!session?.user?.id || !bolehMengelola(session.user.permissions)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await nonaktifkanJenisPotongan({ id, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('nonaktifkanJenisPotongan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
