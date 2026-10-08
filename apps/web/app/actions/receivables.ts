'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { bolehMelapor, bolehMemverifikasi } from '@/lib/receivables/izin';
import { batalkanKlaim, putuskanKlaim, tautkanUlangPotongan } from '@/lib/receivables/writer';
import { batalkanKlaimSendiri, mintaKoreksi, type AlasanKoreksi } from '@/lib/receivables/koreksi';
import { fanOutAdminNotification } from '@/lib/notifications/admin-fanout';
import { tanggalWib as tanggalGiro } from '@/lib/receivables/giro';
import { JENIS_KABAR, kabariPengguna } from '@/lib/notifications/kabar-pengguna';
import { formatIDR } from '@/lib/sales-orders/format';
import { ambilTokoTetap } from '@/lib/pwa/peran';
import { tokoTerkunci } from '@/lib/salesman/queries';
import { daftarPiutang } from '@/lib/receivables/queries';
import { bacaTautanPotongan, kaitKlaimBerubah } from '@/lib/finance/lapangan/kait';
import {
  buatKlaimPembayaran,
  type AlasanGagalKlaim,
  type BarisPelunasan,
  type BarisPotongan,
} from '@/lib/receivables/claim-writer';

/**
 * Kabar ke sales yang melaporkan BKM bahwa laporannya sudah diputuskan keuangan.
 *
 * Tanpa ini, sales baru tahu klaimnya ditolak saat toko ditagih ulang — terlambat untuk
 * membetulkan apa pun. Dipanggil SESUDAH transaksinya selesai dan tidak pernah melempar:
 * keputusan uang sudah tersimpan, dan kabar yang gagal tidak boleh membuatnya tampak gagal.
 * Penerimanya `salesmanId` — pelapor yang sama yang daftar "BKM saya" di HP-nya pakai.
 */
async function kabarKeputusanKlaim(
  paymentClaimId: string,
  keputusan: 'TERVERIFIKASI' | 'DITOLAK' | 'DIBATALKAN',
  catatan: string | null | undefined,
  pelakuId: string,
): Promise<void> {
  try {
    const klaim = await prisma.paymentClaim.findUnique({
      where: { id: paymentClaimId },
      select: { docNo: true, salesmanId: true, receivedAmount: true, store: { select: { name: true } } },
    });
    if (!klaim || klaim.salesmanId === pelakuId) return;
    const alasan = catatan?.trim() ? ` Alasan: ${catatan.trim()}` : '';
    const kabar =
      keputusan === 'TERVERIFIKASI'
        ? {
            jenis: JENIS_KABAR.PELUNASAN_TERVERIFIKASI,
            judul: `Pelunasan ${klaim.docNo} terverifikasi`,
            isi: `${klaim.store.name} · ${formatIDR(klaim.receivedAmount.toString())} sudah diakui.`,
          }
        : keputusan === 'DITOLAK'
          ? {
              jenis: JENIS_KABAR.PELUNASAN_DITOLAK,
              judul: `Pelunasan ${klaim.docNo} ditolak`,
              isi: `${klaim.store.name} · ${formatIDR(klaim.receivedAmount.toString())}.${alasan}`,
            }
          : {
              jenis: JENIS_KABAR.PELUNASAN_DIBATALKAN,
              judul: `Pelunasan ${klaim.docNo} dibatalkan`,
              isi: `${klaim.store.name} · ${formatIDR(klaim.receivedAmount.toString())}.${alasan}`,
            };
    await kabariPengguna(klaim.salesmanId, { ...kabar, data: { claimId: paymentClaimId } });
  } catch (err) {
    console.error('[kabar] keputusan klaim gagal', paymentClaimId, err);
  }
}

/**
 * Kabar ke sales pelapor BKM giro: bilyetnya cair (piutang berkurang) atau
 * ditolak bank (tagih ulang). Jenisnya sendiri, bukan PELUNASAN_*: yang ia
 * tunggu adalah bilyet di tangan toko, dan kalimatnya harus menyebut nomor giro
 * itu. Sama seperti kabar klaim: sesudah transaksi, tidak pernah melempar.
 */
async function kabarGiro(
  paymentClaimId: string,
  hasil: 'CAIR' | 'DITOLAK',
  catatan: string | null | undefined,
  pelakuId: string,
): Promise<void> {
  try {
    const klaim = await prisma.paymentClaim.findUnique({
      where: { id: paymentClaimId },
      select: {
        docNo: true,
        salesmanId: true,
        receivedAmount: true,
        giroNo: true,
        store: { select: { name: true } },
      },
    });
    if (!klaim || klaim.salesmanId === pelakuId) return;
    const nilai = formatIDR(klaim.receivedAmount.toString());
    const giro = klaim.giroNo ?? klaim.docNo;
    const kabar =
      hasil === 'CAIR'
        ? {
            jenis: JENIS_KABAR.GIRO_CAIR,
            judul: `Giro ${giro} cair`,
            isi: `${klaim.store.name} · ${nilai}. ${klaim.docNo} terverifikasi, piutangnya sudah berkurang.`,
          }
        : {
            jenis: JENIS_KABAR.GIRO_DITOLAK,
            judul: `Giro ${giro} ditolak bank`,
            isi:
              `${klaim.store.name} · ${nilai}. Piutangnya tetap terbuka — tagih ulang toko.` +
              (catatan?.trim() ? ` Alasan: ${catatan.trim()}` : ''),
          };
    await kabariPengguna(klaim.salesmanId, { ...kabar, data: { claimId: paymentClaimId } });
  } catch (err) {
    console.error('[kabar] giro gagal', paymentClaimId, err);
  }
}

export type HasilAksiKlaim =
  | { ok: true }
  | {
      ok: false;
      kode:
        | 'TANPA_AKSES'
        | 'TIDAK_DITEMUKAN'
        | 'SUDAH_DIPUTUSKAN'
        | 'ALASAN_WAJIB'
        | 'GIRO_BELUM_CAIR'
        | 'BUKAN_GIRO_MENUNGGU'
        | 'PEMERIKSA_SAMA'
        | 'MELEBIHI_SISA'
        | 'RETUR_DITAHAN'
        | 'RETUR_TERPAKAI'
        | 'GAGAL';
    };

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
    // Jurnal pelunasan (dan retur yang dipotongnya) — sesudah commit, tidak pernah menggagalkan verifikasi.
    await kaitKlaimBerubah([paymentClaimId], session.user.id);
    revalidatePath('/backoffice/pelunasan');
    revalidatePath('/backoffice/pelunasan/giro');
    revalidatePath('/backoffice/piutang');
    void kabarKeputusanKlaim(paymentClaimId, keputusan, catatan, session.user.id);
    return { ok: true };
  } catch (err) {
    console.error('verifikasiKlaim gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Hasil kliring bilyet giro: cair, atau ditolak bank.
 *
 * Cair = giro berubah jadi uang, dan klaimnya diverifikasi DALAM transaksi yang
 * sama lewat pintu verifikasi biasa — di situlah piutang berkurang. Ditolak =
 * klaimnya ditolak dengan alasan dari bank, piutangnya tetap terbuka.
 *
 * Izinnya sama dengan verifikasi klaim: menyatakan giro cair sama dengan
 * menyatakan uangnya ada di rekening.
 */
export async function putuskanGiroAction(
  paymentClaimId: string,
  hasil: 'CAIR' | 'DITOLAK',
  catatan?: string,
): Promise<HasilAksiKlaim> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!bolehMemverifikasi(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const keputusan = await putuskanKlaim({
      paymentClaimId,
      keputusan: hasil === 'CAIR' ? 'TERVERIFIKASI' : 'DITOLAK',
      olehUserId: session.user.id,
      catatan,
      giro: hasil,
    });
    if (!keputusan.ok) return { ok: false, kode: keputusan.alasan };
    await kaitKlaimBerubah([paymentClaimId], session.user.id);
    revalidatePath('/backoffice/pelunasan');
    revalidatePath('/backoffice/pelunasan/giro');
    revalidatePath(`/backoffice/pelunasan/${paymentClaimId}`);
    revalidatePath('/backoffice/piutang');
    revalidatePath('/pwa/bkm');
    void kabarGiro(paymentClaimId, hasil, catatan, session.user.id);
    return { ok: true };
  } catch (err) {
    console.error('putuskanGiro gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export type KodeAksiKlaimBaru =
  | 'TANPA_AKSES'
  | 'TANGGAL_TIDAK_VALID'
  | 'TOKO_TIDAK_DIIZINKAN'
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
 * Bolehkah pelapor lapangan (bukan kantor) melaporkan BKM ini.
 *
 * - SPG TIDAK menagih — ia mencatat jualan di toko tetapnya, uangnya diterima
 *   kasir toko. `TANPA_AKSES`.
 * - Selama kunci "hanya toko sendiri" menyala: setiap faktur yang dilunasi harus
 *   ia tagih menurut aturan daftar tagihan HP-nya (`daftarPiutang({ penagihId })`:
 *   toko yang ia pegang, faktur yang ia jual selama tokonya belum berpemegang,
 *   dan faktur di tugas tagih terbuka miliknya). Aturan itu dipakai ULANG, bukan
 *   disalin: menolak faktur yang tampil di layarnya membuat laporannya mustahil,
 *   dan menerima yang tidak tampil membuka toko orang lain.
 *   `TOKO_TIDAK_DIIZINKAN`.
 * - Kunci mati: seperti sebelumnya.
 *
 * Kiriman ulang BKM miliknya sendiri yang SUDAH tercatat (kunci kiriman sama)
 * dilewatkan ke penulis, yang mengembalikannya: jawaban pertama bisa hilang di
 * jalan lalu kuncinya dinyalakan sebelum HP mengirim ulang, dan menolaknya
 * sekarang membuat HP menandai gagal laporan yang sudah ada di kantor.
 */
async function pelaporBolehMelaporkan(
  userId: string,
  input: { pelunasan: BarisPelunasan[]; idempotencyKey?: string | null },
): Promise<{ ok: true } | { ok: false; kode: 'TANPA_AKSES' | 'TOKO_TIDAK_DIIZINKAN' }> {
  const kunci = input.idempotencyKey?.trim();
  if (kunci) {
    const ada = await prisma.paymentClaim.findUnique({
      where: { idempotencyKey: kunci },
      select: { salesmanId: true },
    });
    if (ada?.salesmanId === userId) return { ok: true };
  }

  if (await ambilTokoTetap(userId)) return { ok: false, kode: 'TANPA_AKSES' };
  if (!(await tokoTerkunci())) return { ok: true };

  // Hanya baris yang melunasi sesuatu — baris bernilai nol dibuang penulisnya.
  const ids = [...new Set(input.pelunasan.filter((p) => p.nilai > 0).map((p) => p.receivableId))];
  if (ids.length === 0) return { ok: true }; // penulis menolaknya sebagai TANPA_PIUTANG
  const ditagih = new Set((await daftarPiutang({ penagihId: userId, receivableIds: ids })).map((p) => p.id));
  return ids.every((id) => ditagih.has(id)) ? { ok: true } : { ok: false, kode: 'TOKO_TIDAK_DIIZINKAN' };
}

/**
 * Catat klaim pembayaran (BKM).
 *
 * Boleh dilakukan sales lapangan, bukan hanya admin kantor: sales yang
 * menyaksikan transfernya. Yang TIDAK boleh ia lakukan adalah memverifikasinya
 * — itu jalur lain dengan izin lain. Kalau pelapor bisa mengesahkan laporannya
 * sendiri, seluruh Aturan 1 runtuh.
 *
 * Faktur MANA yang boleh ia laporkan ditetapkan server (`pelaporBolehMelaporkan`),
 * bukan isian HP; antrean luring memanggil aksi yang sama, dan kedua penolakannya
 * final di sana (`nasibLaporan` → `terminal`). Kantor (`receivables:manage`)
 * tidak melewati pemeriksaan itu.
 */
export async function buatKlaimAction(input: {
  storeId: string;
  claimedTransferAt: string;
  method: string;
  pelunasan: BarisPelunasan[];
  potongan?: BarisPotongan[];
  transferPhotoUrl?: string | null;
  breakdownPhotoUrl?: string | null;
  /** Dari antrean offline HP: kiriman ulang dengan kunci sama tidak mencatat dua kali. */
  idempotencyKey?: string | null;
  /** Rincian bilyet, wajib kalau cara bayarnya giro. Tanggal "YYYY-MM-DD" (WIB). */
  giro?: { nomor: string; bank: string; tanggalTerbit: string; tanggalEfektif: string } | null;
  /** BKM ditolak/dibatalkan yang digantikan laporan ini ("Laporkan ulang" / "Buat ulang"). */
  menggantikanId?: string | null;
}): Promise<HasilKlaimBaru> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!bolehMelapor(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };

  const tanggal = tanggalWib(input.claimedTransferAt);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const kantor = hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE);
    if (!kantor) {
      const boleh = await pelaporBolehMelaporkan(session.user.id, input);
      if (!boleh.ok) return { ok: false, kode: boleh.kode };
    }

    const hasil = await buatKlaimPembayaran({
      ...input,
      claimedTransferAt: tanggal,
      salesmanId: session.user.id,
      createdById: session.user.id,
      // Tanggal yang tidak terbaca menjadi null dan ditolak penulis sebagai
      // "tanggal giro wajib" — satu aturan, di satu tempat.
      giro: input.giro
        ? {
            nomor: input.giro.nomor,
            bank: input.giro.bank,
            tanggalTerbit: tanggalGiro(input.giro.tanggalTerbit),
            tanggalEfektif: tanggalGiro(input.giro.tanggalEfektif),
          }
        : null,
      // Ditentukan server dari hak akses, SESUDAH isian dari HP: kantor boleh
      // mengganti BKM siapa pun, sales hanya miliknya sendiri.
      lintasPelapor: kantor,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    revalidatePath('/backoffice/pelunasan');
    revalidatePath('/backoffice/pelunasan/giro');
    revalidatePath('/backoffice/piutang');
    revalidatePath('/pwa/bkm');
    return { ok: true, docNo: hasil.docNo };
  } catch (err) {
    console.error('buatKlaim gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export type KodeKoreksi =
  | 'TANPA_AKSES'
  | 'TIDAK_DITEMUKAN'
  | 'SUDAH_DIBATALKAN'
  | 'ALASAN_WAJIB'
  | 'RETUR_BEDA_TOKO'
  | 'RETUR_TERPAKAI'
  | 'GAGAL';

export type HasilKoreksiAksi = { ok: true } | { ok: false; kode: KodeKoreksi };

/**
 * Batalkan BKM yang salah catat.
 *
 * Dibatasi ke `journals:manage` sama seperti verifikasi: membatalkan mengubah
 * sisa piutang, jadi ia keputusan keuangan. Satu-satunya jalan pelapor sendiri
 * adalah `tarikKlaimSendiriAction`, dan hanya selama BKM-nya belum diputuskan.
 */
export async function batalkanKlaimAction(
  paymentClaimId: string,
  alasan: string,
): Promise<HasilKoreksiAksi> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    const hasil = await batalkanKlaim({ paymentClaimId, alasan, olehUserId: session.user.id });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    // BKM yang sudah terverifikasi lalu dibatalkan: jurnalnya dibalik (generasi baru), tidak dihapus.
    await kaitKlaimBerubah([paymentClaimId], session.user.id);
    revalidatePath('/backoffice/pelunasan');
    revalidatePath('/backoffice/pelunasan/giro');
    revalidatePath(`/backoffice/pelunasan/${paymentClaimId}`);
    revalidatePath('/backoffice/piutang');
    void kabarKeputusanKlaim(paymentClaimId, 'DIBATALKAN', alasan, session.user.id);
    return { ok: true };
  } catch (err) {
    console.error('batalkanKlaim gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Tautkan ulang potongan ke nota retur, atau lepaskan tautannya. */
export async function tautkanUlangPotonganAction(
  deductionId: string,
  storeReturnId: string | null,
  alasan: string,
): Promise<HasilKoreksiAksi> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }

  try {
    // Dibaca sebelum penulis menimpanya: nota retur LAMA juga perlu diselaraskan jurnalnya.
    const sebelum = await bacaTautanPotongan(deductionId);
    const hasil = await tautkanUlangPotongan({
      deductionId,
      storeReturnId,
      alasan,
      olehUserId: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    if (sebelum) {
      await kaitKlaimBerubah([sebelum.paymentClaimId], session.user.id, {
        nrtIds: [sebelum.storeReturnId, storeReturnId].filter((x): x is string => Boolean(x)),
      });
    }
    revalidatePath('/backoffice/pelunasan');
    revalidatePath('/backoffice/piutang');
    return { ok: true };
  } catch (err) {
    console.error('tautkanUlangPotongan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export type HasilTarikKlaim = { ok: true } | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' | AlasanKoreksi };

/**
 * Sales menarik BKM-nya sendiri dari HP — salah pilih toko, salah faktur.
 *
 * Hanya selama keuangan belum memutuskan (`batalkanKlaimSendiri`). Barisnya
 * tidak dihapus dan keuangan diberi tahu: penarikan tidak pernah diam-diam.
 */
export async function tarikKlaimSendiriAction(paymentClaimId: string, alasan: string): Promise<HasilTarikKlaim> {
  const session = await auth();
  if (!session?.user?.id || !bolehMelapor(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const hasil = await batalkanKlaimSendiri({ paymentClaimId, salesmanId: session.user.id, alasan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan as AlasanKoreksi };
    void fanOutAdminNotification(hasil.notifikasi);
    revalidatePath('/pwa/bkm');
    revalidatePath('/backoffice/pelunasan');
    revalidatePath(`/backoffice/pelunasan/${paymentClaimId}`);
    revalidatePath('/backoffice/piutang');
    return { ok: true };
  } catch (err) {
    console.error('tarikKlaimSendiri gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export type HasilMintaKoreksiAksi = { ok: true } | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' | AlasanKoreksi };

/**
 * Sales meminta kantor membetulkan laporannya yang SUDAH diproses — BKM
 * terverifikasi, atau nota retur yang sudah dihitung gudang. Tercatat di jejak
 * dokumennya dan kantor diberi tahu; keputusannya tetap di kantor.
 */
export async function mintaKoreksiAction(jenis: 'bkm' | 'retur', id: string, alasan: string): Promise<HasilMintaKoreksiAksi> {
  const session = await auth();
  if (!session?.user?.id || !bolehMelapor(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const hasil = await mintaKoreksi({ jenis, id, salesmanId: session.user.id, alasan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan as AlasanKoreksi };
    void fanOutAdminNotification(hasil.notifikasi);
    revalidatePath(jenis === 'bkm' ? '/pwa/bkm' : '/pwa/retur');
    revalidatePath(jenis === 'bkm' ? `/backoffice/pelunasan/${id}` : `/backoffice/retur-toko/${id}`);
    return { ok: true };
  } catch (err) {
    console.error('mintaKoreksi gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
