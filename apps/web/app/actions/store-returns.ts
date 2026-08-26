'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { bolehMelapor } from '@/lib/receivables/izin';
import {
  alihkanBeban,
  batalkanRetur,
  catatHitunganGudang,
  catatReturToko,
  jodohkanRetur,
  lepasPasangan,
  putuskanBeban,
  tandaiBebanLunas,
  type AlasanGagalRetur,
  type BarisBarang,
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

async function butuh(izin: string) {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.permissions ?? [], izin)) return null;
  return session.user.id;
}

/**
 * Catat klaim retur dari toko (NRT).
 *
 * Boleh dilakukan sales lapangan: dialah yang memegang notanya dan memotretnya.
 * Menghitung fisiknya pekerjaan gudang, dan menetapkan bebannya pekerjaan
 * keuangan — masing-masing izinnya sendiri.
 */
export async function catatReturTokoAction(input: {
  noNrt: string;
  storeId: string;
  claimDate: string;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  claimedAmount?: number;
  items?: BarisBarang[];
  photoUrl?: string | null;
  note?: string;
}): Promise<HasilAksiRetur> {
  const session = await auth();
  if (!session?.user?.id || !bolehMelapor(session.user.permissions)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }
  const userId = session.user.id;

  const tanggal = tanggalWib(input.claimDate);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await catatReturToko({
      ...input,
      claimDate: tanggal,
      salesmanId: userId,
      olehUserId: userId,
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
export async function catatHitunganGudangAction(input: {
  storeReturnId?: string | null;
  storeId?: string | null;
  receivedAt: string;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  physicalAmount?: number;
  items?: BarisBarang[];
  note?: string;
}): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.INVENTORY_OPNAME_COUNT);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  const tanggal = tanggalWib(input.receivedAt);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await catatHitunganGudang({
      ...input,
      receivedAt: tanggal,
      warehouseUserId: userId,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('catatHitunganGudang gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Jodohkan penerimaan gudang yatim dengan nota toko. */
export async function jodohkanReturAction(
  warehouseReturnId: string,
  storeReturnId: string,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await jodohkanRetur({ warehouseReturnId, storeReturnId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('jodohkanRetur gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Lepas pasangan NRT–NRI. Ditolak kalau bebannya sudah diputuskan. */
export async function lepasPasanganAction(warehouseReturnId: string): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await lepasPasangan({ warehouseReturnId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('lepasPasangan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Tetapkan siapa menanggung selisih. Inilah yang melepas faktur. */
export async function putuskanBebanAction(
  chargeId: string,
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN',
  alasan: string,
  bearerUserId?: string | null,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await putuskanBeban({ chargeId, bearer, alasan, bearerUserId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('putuskanBeban gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Tandai beban sudah diganti. Tidak menyentuh piutang. */
export async function tandaiBebanLunasAction(chargeId: string): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await tandaiBebanLunas({ chargeId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('tandaiBebanLunas gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Batalkan nota retur toko. Potongan yang menunjuknya tetap tertahan. */
export async function batalkanReturAction(
  storeReturnId: string,
  alasan: string,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await batalkanRetur({ storeReturnId, alasan, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('batalkanRetur gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Alihkan beban yang sudah diputuskan — atau lengkapi orangnya. */
export async function alihkanBebanAction(
  chargeId: string,
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN',
  alasan: string,
  bearerUserId?: string | null,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await alihkanBeban({ chargeId, bearer, alasan, bearerUserId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    revalidatePath('/backoffice/beban-selisih');
    return { ok: true };
  } catch (err) {
    console.error('alihkanBeban gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
