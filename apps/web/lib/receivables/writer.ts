import { prisma, Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { hitungSisaPiutang, type StatusKlaim } from './rules';
import { PILIH_POTONGAN, potonganRetur } from './deductions';
import { catatJejak, JEJAK } from './jejak';
import { giroMenahanVerifikasi, STATUS_GIRO } from './giro';

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
              deductions: { select: PILIH_POTONGAN },
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
      status: link.paymentClaim.status as StatusKlaim,
      nilaiFaktur: angka(link.paymentClaim.invoiceAmount),
      potonganRetur: potonganRetur(link.paymentClaim.deductions),
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

export type HasilKoreksi =
  | { ok: true; piutangDihitungUlang: number }
  | {
      ok: false;
      alasan: 'TIDAK_DITEMUKAN' | 'SUDAH_DIBATALKAN' | 'ALASAN_WAJIB' | 'RETUR_BEDA_TOKO';
    };

/**
 * Batalkan klaim yang salah catat.
 *
 * BUKAN penolakan. Menolak berarti keuangan melihat dan uangnya tidak ada;
 * membatalkan berarti klaimnya sendiri keliru — salah faktur, salah nominal,
 * salah tautan retur. Sebelum ini hanya penolakan yang ada, jadi membetulkan
 * salah ketik menuntut seseorang mencatat pernyataan palsu tentang rekening.
 *
 * Barisnya TIDAK dihapus: ia satu-satunya tempat kekeliruan dan koreksinya
 * sama-sama terlihat. Piutangnya dihitung ulang, jadi yang sempat ditahan atau
 * dilepas oleh klaim ini kembali seperti semula.
 */
export async function batalkanKlaim(input: {
  paymentClaimId: string;
  alasan: string;
  olehUserId: string;
}): Promise<HasilKoreksi> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const klaim = await tx.paymentClaim.findUnique({
      where: { id: input.paymentClaimId },
      select: { id: true, docNo: true, status: true, verifyNote: true },
    });
    if (!klaim) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (klaim.status === 'DIBATALKAN') {
      return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
    }

    await tx.paymentClaim.update({
      where: { id: klaim.id },
      data: {
        status: 'DIBATALKAN',
        verifiedById: input.olehUserId,
        verifiedAt: new Date(),
        verifyNote: input.alasan.trim(),
      },
    });

    const links = await tx.paymentClaimReceivable.findMany({
      where: { paymentClaimId: klaim.id },
      select: { receivableId: true },
    });
    for (const l of links) await hitungUlangPiutang(tx, l.receivableId);

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KLAIM_DIBATALKAN,
      entityType: 'PaymentClaim',
      entityId: klaim.id,
      changes: { before: { status: klaim.status }, after: { status: 'DIBATALKAN' } },
      metadata: { docNo: klaim.docNo, piutangDihitungUlang: links.length },
      reason: input.alasan,
    });

    return { ok: true as const, piutangDihitungUlang: links.length };
  });
}

/**
 * Tautkan ulang sebuah potongan ke nota retur — atau lepaskan tautannya.
 *
 * Tanpa ini, potongan yang menunjuk nota retur yang sudah tidak ada menahan
 * uang SELAMANYA dan tidak ada satu layar pun yang bisa membetulkannya.
 * Penjagaannya benar — uangnya ditahan, bukan lepas — tapi tanpa pintu keluar
 * ia berubah jadi jebakan.
 *
 * Mengubah tautan mengubah berapa yang ditahan, jadi piutangnya dihitung ulang
 * dan alasannya wajib.
 */
export async function tautkanUlangPotongan(input: {
  deductionId: string;
  storeReturnId: string | null;
  alasan: string;
  olehUserId: string;
}): Promise<HasilKoreksi> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return prisma.$transaction(async (tx) => {
    const potongan = await tx.paymentClaimDeduction.findUnique({
      where: { id: input.deductionId },
      select: {
        id: true,
        name: true,
        storeReturnId: true,
        paymentClaim: { select: { id: true, docNo: true, storeId: true } },
      },
    });
    if (!potongan) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    if (input.storeReturnId) {
      const retur = await tx.storeReturn.findUnique({
        where: { id: input.storeReturnId },
        select: { storeId: true },
      });
      // Nota retur toko lain tidak boleh memotong pembayaran toko ini — itu
      // memindahkan pengurang dari satu tagihan ke tagihan lain.
      if (!retur) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      if (retur.storeId !== potongan.paymentClaim.storeId) {
        return { ok: false as const, alasan: 'RETUR_BEDA_TOKO' as const };
      }
    }

    await tx.paymentClaimDeduction.update({
      where: { id: potongan.id },
      data: { storeReturnId: input.storeReturnId },
    });

    const links = await tx.paymentClaimReceivable.findMany({
      where: { paymentClaimId: potongan.paymentClaim.id },
      select: { receivableId: true },
    });
    for (const l of links) await hitungUlangPiutang(tx, l.receivableId);

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.POTONGAN_DITAUTKAN,
      entityType: 'PaymentClaimDeduction',
      entityId: potongan.id,
      changes: {
        before: { storeReturnId: potongan.storeReturnId },
        after: { storeReturnId: input.storeReturnId },
      },
      metadata: { docNo: potongan.paymentClaim.docNo, potongan: potongan.name },
      reason: input.alasan,
    });

    return { ok: true as const, piutangDihitungUlang: links.length };
  });
}

export type HasilVerifikasi =
  | { ok: true; sisaBaru: number[] }
  | {
      ok: false;
      alasan:
        | 'TIDAK_DITEMUKAN'
        | 'SUDAH_DIPUTUSKAN'
        | 'ALASAN_WAJIB'
        | 'GIRO_BELUM_CAIR'
        | 'BUKAN_GIRO_MENUNGGU';
    };

/**
 * Verifikasi atau tolak sebuah klaim pembayaran.
 *
 * Inilah satu-satunya pintu tempat piutang boleh berkurang. Seluruh perubahan
 * berjalan dalam satu transaksi: kalau perhitungan ulang gagal, status klaim
 * ikut batal — supaya tidak pernah ada klaim yang tercatat terverifikasi
 * sementara piutangnya masih penuh.
 *
 * Giro lewat pintu yang SAMA, tidak di sebelahnya. Klaim giro yang masih
 * menunggu tidak bisa diverifikasi biasa: bilyetnya ada, uangnya belum —
 * Aturan 1 berlaku lagi. Yang membukanya hanya `giro: 'CAIR'`, yang menyetel
 * status giro dan memverifikasi klaim dalam transaksi ini juga, sehingga tidak
 * pernah ada giro yang tercatat cair sementara piutangnya masih penuh.
 */
export async function putuskanKlaim(input: {
  paymentClaimId: string;
  keputusan: 'TERVERIFIKASI' | 'DITOLAK';
  olehUserId: string;
  catatan?: string | null;
  /**
   * Hasil kliring bilyet giro. `CAIR` hanya bersama `TERVERIFIKASI`,
   * `DITOLAK` hanya bersama `DITOLAK`.
   */
  giro?: 'CAIR' | 'DITOLAK';
}): Promise<HasilVerifikasi> {
  if (
    (input.giro === 'CAIR' && input.keputusan !== 'TERVERIFIKASI') ||
    (input.giro === 'DITOLAK' && input.keputusan !== 'DITOLAK')
  ) {
    // Kesalahan pemanggil, bukan masukan pengguna — tidak ada tombol yang bisa
    // menyusun pasangan ini.
    throw new Error(`putuskanKlaim: giro ${input.giro} tidak cocok dengan ${input.keputusan}`);
  }
  // Menolak tanpa alasan membuat sales tidak tahu harus membetulkan apa, dan
  // itu persis kebocoran informasi yang program ini dibuat untuk menutup.
  if (input.keputusan === 'DITOLAK' && !input.catatan?.trim()) {
    return { ok: false, alasan: 'ALASAN_WAJIB' };
  }

  return runSerializable(async (tx) => {
    const klaim = await tx.paymentClaim.findUnique({
      where: { id: input.paymentClaimId },
      select: { id: true, docNo: true, status: true, verifyNote: true, giroStatus: true },
    });
    if (!klaim) return { ok: false, alasan: 'TIDAK_DITEMUKAN' as const };
    if (klaim.status !== 'DIKIRIM') return { ok: false, alasan: 'SUDAH_DIPUTUSKAN' as const };

    if (input.giro) {
      if (klaim.giroStatus !== STATUS_GIRO.MENUNGGU) {
        return { ok: false, alasan: 'BUKAN_GIRO_MENUNGGU' as const };
      }
    } else if (input.keputusan === 'TERVERIFIKASI' && giroMenahanVerifikasi(klaim.giroStatus)) {
      return { ok: false, alasan: 'GIRO_BELUM_CAIR' as const };
    }

    const sekarang = new Date();
    // Compare-and-swap pada status: sales bisa menarik BKM-nya sendiri tepat saat
    // ini (`batalkanKlaimSendiri`). `updateMany` Prisma memilih id dulu lalu
    // memperbarui menurut id saja — syarat status TIDAK diperiksa ulang saat
    // menulis — jadi penjaga ini hanya utuh karena transaksinya serializable:
    // basis data sendiri yang menolak salah satu dari dua penulis bersamaan.
    const ubah = await tx.paymentClaim.updateMany({
      where: { id: klaim.id, status: 'DIKIRIM' },
      data: {
        status: input.keputusan,
        verifiedById: input.olehUserId,
        verifiedAt: sekarang,
        verifyNote: input.catatan?.trim() || null,
        ...(input.giro
          ? {
              giroStatus: input.giro,
              ...(input.giro === 'CAIR' ? { giroSettledAt: sekarang } : {}),
            }
          : {}),
      },
    });
    if (ubah.count === 0) return { ok: false, alasan: 'SUDAH_DIPUTUSKAN' as const };

    const links = await tx.paymentClaimReceivable.findMany({
      where: { paymentClaimId: klaim.id },
      select: { receivableId: true },
    });
    const sisaBaru: number[] = [];
    for (const link of links) {
      sisaBaru.push(await hitungUlangPiutang(tx, link.receivableId));
    }

    /*
     * Keputusan ini bisa dibalik lewat basis data, dan barisnya hanya menyimpan
     * keadaan terakhir. Pasangan sebelum/sesudah di sini adalah satu-satunya
     * tempat keputusan yang tergantikan masih bisa dibaca.
     */
    await catatJejak(tx, {
      userId: input.olehUserId,
      action:
        input.keputusan === 'TERVERIFIKASI' ? JEJAK.KLAIM_DIVERIFIKASI : JEJAK.KLAIM_DITOLAK,
      entityType: 'PaymentClaim',
      entityId: klaim.id,
      changes: {
        before: {
          status: klaim.status,
          verifyNote: klaim.verifyNote,
          ...(input.giro ? { giroStatus: klaim.giroStatus } : {}),
        },
        after: {
          status: input.keputusan,
          verifyNote: input.catatan?.trim() || null,
          ...(input.giro ? { giroStatus: input.giro } : {}),
        },
      },
      // `giro` membedakan keputusan kliring dari keputusan atas mutasi rekening
      // biasa — keduanya keputusan klaim yang sama, lewat pintu yang sama.
      metadata: {
        docNo: klaim.docNo,
        piutangDihitungUlang: links.length,
        ...(input.giro ? { giro: input.giro } : {}),
      },
      reason: input.catatan,
    });

    return { ok: true as const, sisaBaru };
  });
}
