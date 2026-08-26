import { prisma, Prisma } from '@elorae/db';
import { hitungSisaPiutang, returTertahan, type PotonganRetur } from './rules';

/**
 * Penulis piutang — satu-satunya tempat kolom `outstanding` boleh berubah.
 *
 * Aturannya: sisa TIDAK PERNAH diketik dan TIDAK PERNAH dikurangi bertahap.
 * Setiap kali ada yang menyentuh sebuah piutang — klaim diverifikasi, ditolak,
 * dibatalkan, atau returnya berubah — nilainya dihitung ulang dari nol.
 *
 * Pengurangan bertahap terlihat lebih hemat, tapi menyimpang begitu satu klaim
 * dibatalkan atau sebuah retur berubah, dan penyimpangan itu tidak terlihat
 * sampai ada yang menagih ke tempat yang salah.
 */

type Klien = typeof prisma | Prisma.TransactionClient;

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Retur belum punya tabelnya sendiri sampai Tahap 4, jadi setiap potongan yang
 * menunjuk ke sebuah nota retur dianggap belum dihitung gudang — tertahan
 * penuh. Arahnya sengaja aman: piutang terlihat lebih besar dari seharusnya.
 * Kebalikannya akan menghapus utang yang belum dibayar.
 */
function potonganDari(
  deductions: { amount: unknown; storeReturnId: string | null }[],
): PotonganRetur[] {
  return deductions
    .filter((d) => d.storeReturnId !== null)
    .map((d) => ({ nilaiKlaim: angka(d.amount), nilaiFisik: null, bebanTerbuka: true }));
}

/**
 * Hitung ulang satu piutang dan simpan hasilnya.
 *
 * Mengembalikan sisa yang baru supaya pemanggil bisa melaporkannya tanpa
 * membaca ulang dari database.
 */
export async function hitungUlangPiutang(client: Klien, receivableId: string): Promise<number> {
  const piutang = await client.receivable.findUnique({
    where: { id: receivableId },
    select: {
      amount: true,
      claimLinks: {
        select: {
          settledAmount: true,
          paymentClaim: {
            select: {
              status: true,
              invoiceAmount: true,
              deductions: { select: { amount: true, storeReturnId: true } },
            },
          },
        },
      },
    },
  });
  if (!piutang) return 0;

  const sisa = hitungSisaPiutang(
    angka(piutang.amount),
    piutang.claimLinks.map((link) => ({
      status: link.paymentClaim.status as 'DIKIRIM' | 'TERVERIFIKASI' | 'DITOLAK',
      nilaiFaktur: angka(link.paymentClaim.invoiceAmount),
      potonganRetur: potonganDari(link.paymentClaim.deductions),
      nilaiDilunasiPiutangIni: angka(link.settledAmount),
    })),
  );

  await client.receivable.update({
    where: { id: receivableId },
    data: {
      outstanding: new Prisma.Decimal(sisa),
      // Tanggal lunas ikut dibersihkan kalau sisanya kembali > 0 — misalnya
      // ketika sebuah klaim dibatalkan setelah sempat terverifikasi.
      settledAt: sisa === 0 ? new Date() : null,
    },
  });

  return sisa;
}

/** Hitung ulang setiap piutang yang disentuh sebuah klaim. */
export async function hitungUlangDariKlaim(client: Klien, paymentClaimId: string): Promise<void> {
  const links = await client.paymentClaimReceivable.findMany({
    where: { paymentClaimId },
    select: { receivableId: true },
  });
  for (const link of links) {
    await hitungUlangPiutang(client, link.receivableId);
  }
}

export type HasilVerifikasi =
  | { ok: true; sisaBaru: number[] }
  | { ok: false; alasan: 'TIDAK_DITEMUKAN' | 'SUDAH_DIPUTUSKAN' | 'ALASAN_WAJIB' };

/**
 * Verifikasi atau tolak sebuah klaim pembayaran.
 *
 * Inilah satu-satunya pintu tempat piutang boleh berkurang. Seluruh perubahan
 * berjalan dalam satu transaksi: kalau perhitungan ulang gagal, status klaim
 * ikut batal — supaya tidak pernah ada klaim yang tercatat terverifikasi
 * sementara piutangnya masih penuh.
 */
export async function putuskanKlaim(input: {
  paymentClaimId: string;
  keputusan: 'TERVERIFIKASI' | 'DITOLAK';
  olehUserId: string;
  catatan?: string | null;
}): Promise<HasilVerifikasi> {
  // Menolak tanpa alasan membuat sales tidak tahu harus membetulkan apa, dan
  // itu persis kebocoran informasi yang program ini dibuat untuk menutup.
  if (input.keputusan === 'DITOLAK' && !input.catatan?.trim()) {
    return { ok: false, alasan: 'ALASAN_WAJIB' };
  }

  return prisma.$transaction(async (tx) => {
    const klaim = await tx.paymentClaim.findUnique({
      where: { id: input.paymentClaimId },
      select: { id: true, status: true },
    });
    if (!klaim) return { ok: false, alasan: 'TIDAK_DITEMUKAN' as const };
    if (klaim.status !== 'DIKIRIM') return { ok: false, alasan: 'SUDAH_DIPUTUSKAN' as const };

    await tx.paymentClaim.update({
      where: { id: klaim.id },
      data: {
        status: input.keputusan,
        verifiedById: input.olehUserId,
        verifiedAt: new Date(),
        verifyNote: input.catatan?.trim() || null,
      },
    });

    const links = await tx.paymentClaimReceivable.findMany({
      where: { paymentClaimId: klaim.id },
      select: { receivableId: true },
    });
    const sisaBaru: number[] = [];
    for (const link of links) {
      sisaBaru.push(await hitungUlangPiutang(tx, link.receivableId));
    }

    return { ok: true as const, sisaBaru };
  });
}
