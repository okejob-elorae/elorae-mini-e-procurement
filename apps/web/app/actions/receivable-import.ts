'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import type { BarisImpor } from '@/lib/receivables/impor/baris';
import { simpanImpor, tinjauImpor, type HasilImpor, type TinjauanImpor } from '@/lib/receivables/impor/writer';
import { batalkanImpor, idFakturImpor } from '@/lib/receivables/impor/batal';
import { kaitFakturPiutang } from '@/lib/finance/lapangan/kait';
import {
  buatPiutangManual,
  type AlasanGagalFaktur,
  type BarisFaktur,
} from '@/lib/receivables/manual-writer';

export type HasilAksiImpor =
  | { ok: true; tinjauan: TinjauanImpor }
  | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' };

export type HasilAksiSimpanImpor =
  | { ok: true; hasil: HasilImpor }
  | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' };

export type HasilAksiBatalImpor =
  | { ok: true; dihapus: number }
  | { ok: false; kode: string; dipakai?: string[] };

/**
 * Baris hasil urai dikirim dari klien, bukan berkasnya.
 *
 * Penguraiannya murni dan berjalan di browser, jadi berkas mentahnya tidak
 * pernah meninggalkan mesin pengguna — dan yang disimpan adalah persis yang
 * dilihatnya di pratinjau, bukan hasil urai kedua yang bisa berbeda.
 */

/** Berapa yang akan masuk, dan apa yang tidak. Tidak menulis apa pun. */
export async function tinjauImporAction(baris: BarisImpor[]): Promise<HasilAksiImpor> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    return { ok: true, tinjauan: await tinjauImpor(pulihkanTanggal(baris)) };
  } catch (err) {
    console.error('tinjauImpor gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Simpan yang lolos. */
export async function simpanImporAction(baris: BarisImpor[]): Promise<HasilAksiSimpanImpor> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const { ids, ...hasil } = await simpanImpor(pulihkanTanggal(baris), { olehUserId: session.user.id });
    // Faktur bertanggal sejak tanggal mulai buku besar dijurnal (DR piutang toko / CR penjualan);
    // sesudah commit, tidak pernah menggagalkan impornya — yang gagal menjadi JOURNAL_PENDING.
    await kaitFakturPiutang(ids ?? [], session.user.id);
    revalidatePath('/backoffice/piutang');
    return { ok: true, hasil };
  } catch (err) {
    console.error('simpanImpor gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Kembalikan `Date` yang jadi string saat melintasi batas server action.
 *
 * Muatan aksi server diserialkan, dan `Date` tiba sebagai string ISO. Tanpa
 * pemulihan ini `dueDate` masuk sebagai teks dan Prisma menolaknya — atau lebih
 * buruk, sebuah `undefined` diam-diam menjadi tanggal hari ini.
 */
function pulihkanTanggal(baris: BarisImpor[]): BarisImpor[] {
  const tgl = (v: unknown): Date | null => {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return baris.map((b) => ({
    ...b,
    tglFaktur: tgl(b.tglFaktur),
    jatuhTempo: tgl(b.jatuhTempo),
  }));
}

export type KodeAksiFakturManual =
  | 'TANPA_AKSES'
  | 'TANGGAL_TIDAK_VALID'
  | AlasanGagalFaktur
  | 'GAGAL';

export type HasilFakturManual = { ok: true } | { ok: false; kode: KodeAksiFakturManual };

/** "YYYY-MM-DD" dibaca sebagai tengah malam WIB, bukan UTC. */
function tglWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Ketik satu faktur dengan tangan, lengkap dengan rincian barangnya. */
export async function buatFakturManualAction(input: {
  invoiceNo: string;
  storeId: string;
  invoiceDate: string;
  dueDate: string;
  amount?: number;
  items?: BarisFaktur[];
}): Promise<HasilFakturManual> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  const tglFaktur = tglWib(input.invoiceDate);
  const tempo = tglWib(input.dueDate);
  if (!tglFaktur || !tempo) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await buatPiutangManual({
      ...input,
      invoiceDate: tglFaktur,
      dueDate: tempo,
      salesmanId: session.user.id,
      olehUserId: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    await kaitFakturPiutang([hasil.id], session.user.id);
    revalidatePath('/backoffice/piutang');
    return { ok: true };
  } catch (err) {
    console.error('buatFakturManual gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Batalkan satu batch impor.
 *
 * Satu berkas yang salah berarti puluhan tagihan palsu, dan sebelum ini
 * satu-satunya cara membersihkannya adalah menghapus baris demi baris lewat
 * basis data. Alasannya wajib — pembatalan yang tidak dijelaskan tidak bisa
 * dibedakan dari kehilangan data ketika ada yang memeriksanya bulan depan.
 */
export async function batalkanImporAction(
  auditLogId: string,
  alasan: string,
): Promise<HasilAksiBatalImpor> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await batalkanImpor({ auditLogId, alasan, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan, dipakai: hasil.dipakai };
    // Faktur yang sudah dijurnal dibalik (generasi berikutnya), bukan dihapus jurnalnya.
    const ids = await idFakturImpor(auditLogId).catch((e) => {
      console.error('idFakturImpor gagal — jurnal faktur batch ini tidak dibalik otomatis:', e);
      return [] as string[];
    });
    await kaitFakturPiutang(ids, session.user.id);
    revalidatePath('/backoffice/piutang');
    revalidatePath('/backoffice/piutang/impor');
    return { ok: true, dihapus: hasil.dihapus };
  } catch (err) {
    console.error('batalkanImpor gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
