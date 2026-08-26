'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { putuskanKlaim } from '@/lib/receivables/writer';

export type HasilAksiKlaim =
  | { ok: true }
  | { ok: false; kode: 'TANPA_AKSES' | 'TIDAK_DITEMUKAN' | 'SUDAH_DIPUTUSKAN' | 'ALASAN_WAJIB' | 'GAGAL' };

/**
 * Verifikasi klaim pembayaran — pintu tempat piutang berkurang.
 *
 * Mengembalikan kode, bukan melempar: di produksi Next menyamarkan pesan error
 * menjadi digest acak, jadi melempar berarti operator melihat "terjadi
 * kesalahan" tanpa tahu apa yang salah.
 */
export async function verifikasiKlaimAction(
  paymentClaimId: string,
  keputusan: 'TERVERIFIKASI' | 'DITOLAK',
  catatan?: string,
): Promise<HasilAksiKlaim> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  // Verifikasi ke mutasi bank adalah pekerjaan admin keuangan, bukan sales —
  // kalau sales bisa memverifikasi klaimnya sendiri, seluruh Aturan 1 runtuh.
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await putuskanKlaim({
      paymentClaimId,
      keputusan,
      olehUserId: session.user.id,
      catatan,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    revalidatePath('/backoffice/pelunasan');
    revalidatePath('/backoffice/piutang');
    return { ok: true };
  } catch (err) {
    console.error('verifikasiKlaim gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
