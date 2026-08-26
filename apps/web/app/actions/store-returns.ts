'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import {
  batalkanRetur,
  catatHitunganGudang,
  catatReturToko,
  putuskanBebanSelisih,
  type AlasanGagalRetur,
} from '@/lib/receivables/return-writer';

export type KodeAksiRetur = 'TANPA_AKSES' | 'TANGGAL_TIDAK_VALID' | AlasanGagalRetur | 'GAGAL';
export type HasilAksiRetur = { ok: true } | { ok: false; kode: KodeAksiRetur };

function segarkan() {
  revalidatePath('/backoffice/retur-toko');
  revalidatePath('/backoffice/piutang');
  revalidatePath('/backoffice/pelunasan');
}

/** "YYYY-MM-DD" dibaca sebagai tengah malam WIB, bukan UTC. */
function tanggalWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Catat klaim retur dari toko (NRT).
 *
 * `receivables:manage` — mencatat klaim toko adalah pekerjaan penagihan, dan
 * nota yang salah menahan piutang sampai seseorang membetulkannya.
 */
export async function catatReturTokoAction(input: {
  storeId: string;
  claimDate: string;
  claimedAmount: number;
  note?: string;
}): Promise<HasilAksiRetur> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  const tanggal = tanggalWib(input.claimDate);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await catatReturToko({
      storeId: input.storeId,
      salesmanId: session.user.id,
      claimDate: tanggal,
      claimedAmount: input.claimedAmount,
      note: input.note,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('catatReturToko gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Catat hitungan fisik gudang (NRI).
 *
 * Dibatasi ke `inventory_opname:count` dan BUKAN ke izin piutang. Seluruh guna
 * retur dua sisi ini adalah bahwa yang mengklaim dan yang menghitung bukan orang
 * yang sama; menyatukan keduanya di satu izin membatalkan gunanya.
 */
export async function catatHitunganGudangAction(
  storeReturnId: string,
  countedAmount: number,
  note?: string,
): Promise<HasilAksiRetur> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await catatHitunganGudang({
      storeReturnId,
      countedAmount,
      olehUserId: session.user.id,
      note,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('catatHitunganGudang gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Tetapkan siapa menanggung selisih. Inilah yang melepas faktur. */
export async function putuskanBebanAction(
  storeReturnId: string,
  bearer: 'TOKO' | 'SALES' | 'PERUSAHAAN',
  alasan: string,
): Promise<HasilAksiRetur> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await putuskanBebanSelisih({
      storeReturnId,
      bearer,
      alasan,
      olehUserId: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('putuskanBeban gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Batalkan nota retur. Potongan yang menunjuknya tetap tertahan. */
export async function batalkanReturAction(
  storeReturnId: string,
  alasan: string,
): Promise<HasilAksiRetur> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await batalkanRetur({ storeReturnId, alasan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('batalkanRetur gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
