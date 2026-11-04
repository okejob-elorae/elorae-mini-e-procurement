import { Prisma } from '@elorae/db';
import { catatJejak, JEJAK } from './jejak';

/**
 * Laporan pengganti: BKM atau nota retur baru yang dilaporkan ulang dari
 * laporan yang ditarik, dibatalkan, atau ditolak.
 *
 * Tautannya kolom UNIK (`replacesClaimId`, `replacesReturnId`), jadi satu
 * laporan lama hanya bisa punya satu pengganti — uang atau barang yang sama
 * tidak bisa dilaporkan ulang dua kali. Pemeriksaan di sini memberi penolakan
 * yang bisa dibaca; batasan unik tetap penjaga terakhirnya.
 */

export type AlasanPengganti =
  | 'PENGGANTI_TIDAK_DITEMUKAN'
  | 'PENGGANTI_MASIH_BERLAKU'
  | 'PENGGANTI_BUKAN_MILIK'
  | 'SUDAH_DIGANTI';

type Klien = Prisma.TransactionClient;
type Periksa = { ok: true; nomor: string } | { ok: false; alasan: AlasanPengganti };

/**
 * `lintasPelapor`: kantor boleh membuat pengganti untuk laporan sales siapa pun;
 * sales hanya untuk laporannya sendiri.
 */
export async function periksaKlaimLama(
  tx: Klien,
  input: { lamaId: string; salesmanId: string; lintasPelapor?: boolean },
): Promise<Periksa> {
  const lama = await tx.paymentClaim.findUnique({
    where: { id: input.lamaId },
    select: { docNo: true, status: true, salesmanId: true },
  });
  if (!lama) return { ok: false, alasan: 'PENGGANTI_TIDAK_DITEMUKAN' };
  if (!input.lintasPelapor && lama.salesmanId !== input.salesmanId) return { ok: false, alasan: 'PENGGANTI_BUKAN_MILIK' };
  // Yang masih berlaku (menunggu atau terverifikasi) belum boleh diganti: dua
  // laporan hidup untuk uang yang sama.
  if (lama.status !== 'DIBATALKAN' && lama.status !== 'DITOLAK') return { ok: false, alasan: 'PENGGANTI_MASIH_BERLAKU' };
  const sudah = await tx.paymentClaim.findUnique({ where: { replacesClaimId: input.lamaId }, select: { id: true } });
  if (sudah) return { ok: false, alasan: 'SUDAH_DIGANTI' };
  return { ok: true, nomor: lama.docNo };
}

export async function periksaReturLama(
  tx: Klien,
  input: { lamaId: string; salesmanId: string | null; lintasPelapor?: boolean },
): Promise<Periksa> {
  const lama = await tx.storeReturn.findUnique({
    where: { id: input.lamaId },
    select: { noNrt: true, status: true, salesmanId: true },
  });
  if (!lama) return { ok: false, alasan: 'PENGGANTI_TIDAK_DITEMUKAN' };
  if (!input.lintasPelapor && lama.salesmanId !== input.salesmanId) return { ok: false, alasan: 'PENGGANTI_BUKAN_MILIK' };
  if (lama.status !== 'BATAL') return { ok: false, alasan: 'PENGGANTI_MASIH_BERLAKU' };
  const sudah = await tx.storeReturn.findUnique({ where: { replacesReturnId: input.lamaId }, select: { id: true } });
  if (sudah) return { ok: false, alasan: 'SUDAH_DIGANTI' };
  return { ok: true, nomor: lama.noNrt };
}

/** Jejak di dokumen LAMA: "diganti oleh …". Dokumen baru membawa kolom tautannya sendiri. */
export async function catatDiganti(
  tx: Klien,
  input: { jenis: 'bkm' | 'retur'; lamaId: string; baruId: string; nomorBaru: string; olehUserId: string },
): Promise<void> {
  await catatJejak(tx, {
    userId: input.olehUserId,
    action: input.jenis === 'bkm' ? JEJAK.KLAIM_DIGANTI : JEJAK.RETUR_DIGANTI,
    entityType: input.jenis === 'bkm' ? 'PaymentClaim' : 'StoreReturn',
    entityId: input.lamaId,
    metadata: input.jenis === 'bkm'
      ? { digantiOleh: input.baruId, docNoBaru: input.nomorBaru }
      : { digantiOleh: input.baruId, noNrtBaru: input.nomorBaru },
  });
}

/** Bentrok pada kolom tautan pengganti — dua pengganti yang dibuat bersamaan. */
export function bentrokPengganti(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const meta = JSON.stringify((err as { meta?: unknown }).meta ?? {});
  return meta.includes('replacesClaimId') || meta.includes('replacesReturnId');
}
