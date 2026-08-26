'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import {
  buatKontrabon,
  tutupKontrabon,
  type AlasanGagalKontrabon,
} from '@/lib/receivables/collection-writer';

export type KodeAksiKontrabon =
  | 'TANPA_AKSES'
  | 'TANGGAL_TIDAK_VALID'
  | AlasanGagalKontrabon
  | 'TIDAK_DITEMUKAN'
  | 'SUDAH_DITUTUP'
  | 'MASIH_ADA_SISA'
  | 'ALASAN_WAJIB'
  | 'GAGAL';

export type HasilAksiKontrabon = { ok: true } | { ok: false; kode: KodeAksiKontrabon };

function segarkan() {
  revalidatePath('/backoffice/kontrabon');
  revalidatePath('/backoffice/piutang');
}

/**
 * Tanggal dari `<input type="date">` datang sebagai "YYYY-MM-DD" tanpa zona.
 * Ditafsirkan sebagai tengah malam WIB, bukan UTC — kalau tidak, sebuah tanda
 * terima yang diserahkan hari ini tercatat kemarin bagi siapa pun di Jakarta.
 */
function tanggalWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Buat kontrabon baru.
 *
 * Dibatasi ke pemegang `receivables:manage`: menyerahkan faktur fisik adalah
 * keputusan penagihan, dan kontrabon yang salah mengunci piutangnya dari
 * kontrabon lain sampai dibatalkan.
 */
export async function buatKontrabonAction(input: {
  receivableIds: string[];
  handoverDate: string;
  promisedDate: string;
  receivedBy?: string;
  note?: string;
}): Promise<HasilAksiKontrabon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  const serah = tanggalWib(input.handoverDate);
  const janji = tanggalWib(input.promisedDate);
  if (!serah || !janji) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await buatKontrabon({
      receivableIds: input.receivableIds,
      salesmanId: session.user.id,
      handoverDate: serah,
      promisedDate: janji,
      receivedBy: input.receivedBy,
      note: input.note,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('buatKontrabon gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Tandai kontrabon selesai (semua fakturnya lunas) atau batal (faktur ditarik). */
export async function tutupKontrabonAction(
  collectionNoteId: string,
  keputusan: 'SELESAI' | 'BATAL',
  catatan?: string,
): Promise<HasilAksiKontrabon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await tutupKontrabon({
      collectionNoteId,
      keputusan,
      catatan,
      olehUserId: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('tutupKontrabon gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
