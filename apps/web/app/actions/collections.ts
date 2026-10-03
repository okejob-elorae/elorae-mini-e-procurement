'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { bolehMelapor, bolehMengelola } from '@/lib/receivables/izin';
import { hariWib } from '@/lib/receivables/giro';
import { JENIS_KABAR, kabariPengguna } from '@/lib/notifications/kabar-pengguna';
import { formatIDR } from '@/lib/sales-orders/format';
import { formatDisplayDate } from '@/lib/date-only';
import {
  buatKontrabon,
  konfirmasiKontrabon,
  pasangFotoKontrabon,
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
  | 'BUKAN_DARI_LAPANGAN'
  | 'SUDAH_DIKONFIRMASI'
  | 'GAGAL';

export type HasilAksiKontrabon = { ok: true } | { ok: false; kode: KodeAksiKontrabon };

function segarkan() {
  revalidatePath('/backoffice/kontrabon');
  revalidatePath('/backoffice/piutang');
  revalidatePath('/pwa/piutang');
}

/**
 * Kabar ke salesman atas janji bayar yang ia catat di lapangan: dikonfirmasi
 * kantor, atau dibatalkan beserta alasannya.
 *
 * Hanya untuk kontrabon LAPANGAN — kontrabon kantor tidak punya pelapor yang
 * menunggu kabar. Dipanggil SESUDAH transaksinya selesai dan tidak pernah
 * melempar: keputusannya sudah tersimpan, kabar yang gagal tidak boleh
 * membuatnya tampak gagal.
 */
async function kabarKontrabonLapangan(
  collectionNoteId: string,
  keputusan: 'DIKONFIRMASI' | 'DIBATALKAN',
  catatan: string | null | undefined,
  pelakuId: string,
): Promise<void> {
  try {
    const nota = await prisma.collectionNote.findUnique({
      where: { id: collectionNoteId },
      select: {
        docNo: true,
        source: true,
        salesmanId: true,
        storeId: true,
        amount: true,
        promisedDate: true,
        store: { select: { name: true } },
      },
    });
    if (!nota || nota.source !== 'FIELD' || nota.salesmanId === pelakuId) return;
    const data = { storeId: nota.storeId, collectionNoteId };
    const nilai = formatIDR(nota.amount.toString());
    if (keputusan === 'DIKONFIRMASI') {
      await kabariPengguna(nota.salesmanId, {
        jenis: JENIS_KABAR.KONTRABON_DIKONFIRMASI,
        judul: `Janji bayar ${nota.docNo} dikonfirmasi`,
        isi: `${nota.store.name} · ${nilai}, janji bayar ${formatDisplayDate(nota.promisedDate)}.`,
        data,
      });
    } else {
      const alasan = catatan?.trim() ? ` Alasan: ${catatan.trim()}` : '';
      await kabariPengguna(nota.salesmanId, {
        jenis: JENIS_KABAR.KONTRABON_DIBATALKAN,
        judul: `Janji bayar ${nota.docNo} dibatalkan`,
        isi: `${nota.store.name} · ${nilai}.${alasan}`,
        data,
      });
    }
  } catch (err) {
    console.error('[kabar] kontrabon lapangan gagal', collectionNoteId, err);
  }
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
  photoUrl?: string | null;
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
      photoUrl: input.photoUrl,
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
    revalidatePath(`/backoffice/kontrabon/${collectionNoteId}`);
    if (keputusan === 'BATAL') {
      void kabarKontrabonLapangan(collectionNoteId, 'DIBATALKAN', catatan, session.user.id);
    }
    return { ok: true };
  } catch (err) {
    console.error('tutupKontrabon gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Pasang foto lembar kontrabon yang sudah ditandatangani toko. */
export async function pasangFotoKontrabonAction(
  collectionNoteId: string,
  photoUrl: string,
): Promise<HasilAksiKontrabon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await pasangFotoKontrabon({
      collectionNoteId,
      photoUrl,
      olehUserId: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    revalidatePath(`/backoffice/kontrabon/${collectionNoteId}`);
    return { ok: true };
  } catch (err) {
    console.error('pasangFotoKontrabon gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Konfirmasi kantor atas janji bayar yang dicatat salesman di lapangan.
 *
 * Pemegang `receivables:manage` — pengelola penagihan, bukan pelapornya.
 * Salesman yang bisa mengonfirmasi janjinya sendiri membuat konfirmasi itu
 * tidak menyatakan apa-apa.
 */
export async function konfirmasiKontrabonAction(collectionNoteId: string): Promise<HasilAksiKontrabon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!bolehMengelola(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await konfirmasiKontrabon({ collectionNoteId, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    revalidatePath(`/backoffice/kontrabon/${collectionNoteId}`);
    revalidatePath(`/pwa/piutang/${hasil.storeId}`);
    void kabarKontrabonLapangan(collectionNoteId, 'DIKONFIRMASI', null, session.user.id);
    return { ok: true };
  } catch (err) {
    console.error('konfirmasiKontrabon gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export type HasilJanjiBayar = { ok: true; docNo: string } | { ok: false; kode: KodeAksiKontrabon };

/**
 * Catat janji bayar / tukar faktur dari lapangan.
 *
 * Izinnya sama dengan melapor BKM (`bolehMelapor`): sales yang menyaksikan
 * toko menandatangani lembarnya. Servernya memeriksa ulang bahwa SETIAP faktur
 * memang ia tagih — layar HP sudah menyaring, tapi kiriman dari antrean bisa
 * tiba setelah tokonya dirotasi ke sales lain.
 *
 * Tanggal serah adalah hari laporannya dibuat di HP, bukan hari kirimannya
 * sampai: janji yang dicatat tanpa sinyal kemarin tetap diserahkan kemarin.
 * Tanggal serah di masa depan ditolak.
 */
export async function catatJanjiBayarAction(input: {
  receivableIds: string[];
  tanggalSerah: string;
  janjiBayar: string;
  receivedBy: string;
  photoUrl: string | null;
  note?: string;
  /** Kunci kiriman dari HP: kiriman ulang dengan kunci sama tidak mencatat dua kali. */
  idempotencyKey?: string | null;
}): Promise<HasilJanjiBayar> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!bolehMelapor(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };

  const serah = tanggalWib(input.tanggalSerah);
  const janji = tanggalWib(input.janjiBayar);
  if (!serah || !janji) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };
  if (input.tanggalSerah > hariWib(new Date())) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await buatKontrabon({
      receivableIds: input.receivableIds,
      salesmanId: session.user.id,
      handoverDate: serah,
      promisedDate: janji,
      receivedBy: input.receivedBy,
      photoUrl: input.photoUrl,
      note: input.note,
      source: 'FIELD',
      penagihId: session.user.id,
      idempotencyKey: input.idempotencyKey,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    const nota = await prisma.collectionNote.findUnique({ where: { id: hasil.id }, select: { storeId: true } });
    if (nota) revalidatePath(`/pwa/piutang/${nota.storeId}`);
    return { ok: true, docNo: hasil.docNo };
  } catch (err) {
    console.error('catatJanjiBayar gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
