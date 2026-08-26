'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { bolehMelapor } from '@/lib/receivables/izin';
import { putuskanKlaim } from '@/lib/receivables/writer';
import {
  buatKlaimPembayaran,
  type AlasanGagalKlaim,
  type BarisPelunasan,
  type BarisPotongan,
} from '@/lib/receivables/claim-writer';

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

export type KodeAksiKlaimBaru =
  | 'TANPA_AKSES'
  | 'TANGGAL_TIDAK_VALID'
  | AlasanGagalKlaim
  | 'GAGAL';

export type HasilKlaimBaru = { ok: true; docNo: string } | { ok: false; kode: KodeAksiKlaimBaru };

/** "YYYY-MM-DD" dibaca sebagai tengah malam WIB, bukan UTC. */
function tanggalWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Catat klaim pembayaran (BKM).
 *
 * Boleh dilakukan sales lapangan, bukan hanya admin kantor: sales yang
 * menyaksikan transfernya. Yang TIDAK boleh ia lakukan adalah memverifikasinya
 * — itu jalur lain dengan izin lain. Kalau pelapor bisa mengesahkan laporannya
 * sendiri, seluruh Aturan 1 runtuh.
 */
export async function buatKlaimAction(input: {
  storeId: string;
  claimedTransferAt: string;
  method: string;
  pelunasan: BarisPelunasan[];
  potongan?: BarisPotongan[];
  transferPhotoUrl?: string | null;
  breakdownPhotoUrl?: string | null;
}): Promise<HasilKlaimBaru> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!bolehMelapor(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };

  const tanggal = tanggalWib(input.claimedTransferAt);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await buatKlaimPembayaran({
      ...input,
      claimedTransferAt: tanggal,
      salesmanId: session.user.id,
      createdById: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    revalidatePath('/backoffice/pelunasan');
    revalidatePath('/backoffice/piutang');
    return { ok: true, docNo: hasil.docNo };
  } catch (err) {
    console.error('buatKlaim gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
