import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { hitungUlangPiutang } from './writer';

/**
 * Penulis nota retur toko — dua sisi.
 *
 * NRT adalah klaim toko: "kami kembalikan barang senilai sekian". NRI adalah
 * hitungan gudang: "yang sampai senilai sekian". Aturan yang dijaga seluruh
 * berkas ini adalah **retur diakui sebesar fisik, bukan sebesar klaim** —
 * selama gudang belum menghitung, seluruh klaimnya ditahan; setelah dihitung,
 * yang ditahan tinggal selisihnya sampai ada yang ditetapkan menanggungnya.
 *
 * Tidak ada satu pun jalur di sini yang menulis kolom `outstanding` sendiri.
 * Setiap perubahan memicu perhitungan ulang piutang yang tersentuh, karena
 * nilai retur adalah bahan langsung dari perhitungan itu.
 */

type Klien = Prisma.TransactionClient;

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Nomor NRT berikutnya dalam tahun berjalan.
 *
 * Sama seperti kontrabon: penjagaan sesungguhnya terhadap nomor kembar adalah
 * batasan `@unique`, bukan hitungan di sini.
 */
async function nomorBerikutnya(tx: Klien, tahun: number): Promise<string> {
  const depan = `NRT/${tahun}/`;
  const terakhir = await tx.storeReturn.findFirst({
    where: { docNo: { startsWith: depan } },
    orderBy: { docNo: 'desc' },
    select: { docNo: true },
  });
  const urutan = terakhir ? Number(terakhir.docNo.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

/**
 * Hitung ulang setiap piutang yang tersentuh oleh sebuah nota retur.
 *
 * Jalurnya panjang dan itu memang bentuk datanya: nota retur → potongan yang
 * menunjuknya → klaim pembayaran → piutang yang dilunasi klaim itu. Mengubah
 * hitungan gudang mengubah berapa yang diakui pada setiap piutang di rantai itu.
 */
async function hitungUlangTersentuh(tx: Klien, storeReturnId: string): Promise<number> {
  const potongan = await tx.paymentClaimDeduction.findMany({
    where: { storeReturnId },
    select: { paymentClaimId: true },
  });
  if (potongan.length === 0) return 0;

  const links = await tx.paymentClaimReceivable.findMany({
    where: { paymentClaimId: { in: [...new Set(potongan.map((p) => p.paymentClaimId))] } },
    select: { receivableId: true },
  });
  const ids = [...new Set(links.map((l) => l.receivableId))];
  for (const id of ids) {
    await hitungUlangPiutang(tx, id);
  }
  return ids.length;
}

export type AlasanGagalRetur =
  | 'TIDAK_DITEMUKAN'
  | 'NILAI_TIDAK_VALID'
  | 'SUDAH_DIBATALKAN'
  | 'SUDAH_DIHITUNG'
  | 'BELUM_DIHITUNG'
  | 'TIDAK_ADA_SELISIH'
  | 'SUDAH_DIPUTUSKAN'
  | 'ALASAN_WAJIB'
  | 'NOMOR_BENTROK';

/** Catat klaim retur dari toko (NRT). Gudang belum menghitung apa pun. */
export async function catatReturToko(input: {
  storeId: string;
  salesmanId?: string | null;
  claimDate: Date;
  claimedAmount: number;
  note?: string | null;
}): Promise<{ ok: true; id: string; docNo: string } | { ok: false; alasan: AlasanGagalRetur }> {
  // Nilai nol atau negatif bukan retur; ia akan lolos jadi baris yang menahan
  // nol rupiah selamanya dan tak pernah bisa dituntaskan siapa pun.
  if (!(input.claimedAmount > 0)) return { ok: false, alasan: 'NILAI_TIDAK_VALID' };

  try {
    return await runSerializable(async (tx) => {
      const docNo = await nomorBerikutnya(tx, input.claimDate.getFullYear());
      const nota = await tx.storeReturn.create({
        data: {
          docNo,
          storeId: input.storeId,
          salesmanId: input.salesmanId ?? null,
          claimDate: input.claimDate,
          claimedAmount: new Prisma.Decimal(input.claimedAmount),
          note: input.note?.trim() || null,
          status: 'DIAJUKAN',
        },
        select: { id: true, docNo: true },
      });
      return { ok: true as const, id: nota.id, docNo: nota.docNo };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_BENTROK' };
    }
    throw err;
  }
}

/**
 * Catat hitungan fisik gudang (NRI).
 *
 * Sekali saja: menghitung ulang sebuah nota yang sudah dihitung berarti
 * menimpa angka yang mungkin sudah dipakai memutuskan beban. Yang salah
 * dibatalkan, lalu dicatat ulang sebagai nota baru.
 */
export async function catatHitunganGudang(input: {
  storeReturnId: string;
  countedAmount: number;
  olehUserId: string;
  note?: string | null;
}): Promise<{ ok: true; piutangDihitungUlang: number } | { ok: false; alasan: AlasanGagalRetur }> {
  // Nol sah — artinya tidak ada barang yang sampai, dan itu berbeda dari belum
  // dihitung. Negatif tidak sah.
  if (!(input.countedAmount >= 0)) return { ok: false, alasan: 'NILAI_TIDAK_VALID' };

  return runSerializable(async (tx) => {
    const nota = await tx.storeReturn.findUnique({
      where: { id: input.storeReturnId },
      select: { id: true, status: true, countedAmount: true, note: true },
    });
    if (!nota) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nota.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
    if (nota.countedAmount !== null) {
      return { ok: false as const, alasan: 'SUDAH_DIHITUNG' as const };
    }

    await tx.storeReturn.update({
      where: { id: nota.id },
      data: {
        countedAmount: new Prisma.Decimal(input.countedAmount),
        countedAt: new Date(),
        countedById: input.olehUserId,
        status: 'DIHITUNG',
        note: input.note?.trim() ? [nota.note, input.note.trim()].filter(Boolean).join('\n') : nota.note,
      },
    });

    return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, nota.id) };
  });
}

/**
 * Tetapkan siapa menanggung selisih antara klaim toko dan hitungan gudang.
 *
 * Inilah yang melepas faktur. Sebelum ada yang menanggung, selisihnya menggantung
 * di piutang dan tidak ada seorang pun yang bertanggung jawab atasnya — keadaan
 * yang bisa bertahan berbulan-bulan justru karena tidak ada yang merasa ditagih.
 */
export async function putuskanBebanSelisih(input: {
  storeReturnId: string;
  bearer: 'TOKO' | 'SALES' | 'PERUSAHAAN';
  alasan: string;
  olehUserId: string;
}): Promise<{ ok: true; piutangDihitungUlang: number } | { ok: false; alasan: AlasanGagalRetur }> {
  // Beban selalu jatuh ke seseorang yang nyata — toko, sales, atau perusahaan
  // yang menghapusbukukannya. Tanpa alasan tertulis, keputusan itu tidak bisa
  // dipertanggungjawabkan ke siapa pun yang dibebani.
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const nota = await tx.storeReturn.findUnique({
      where: { id: input.storeReturnId },
      select: { id: true, status: true, claimedAmount: true, countedAmount: true, bearer: true },
    });
    if (!nota) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nota.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
    if (nota.countedAmount === null) return { ok: false as const, alasan: 'BELUM_DIHITUNG' as const };
    if (nota.bearer !== null) return { ok: false as const, alasan: 'SUDAH_DIPUTUSKAN' as const };
    // Gudang menerima sama banyak atau lebih: tidak ada yang perlu dibebankan,
    // dan mencatat beban di sini akan menuduh seseorang atas kerugian nol.
    if (angka(nota.claimedAmount) - angka(nota.countedAmount) <= 0) {
      return { ok: false as const, alasan: 'TIDAK_ADA_SELISIH' as const };
    }

    await tx.storeReturn.update({
      where: { id: nota.id },
      data: {
        bearer: input.bearer,
        bearerReason: input.alasan.trim(),
        decidedAt: new Date(),
        decidedById: input.olehUserId,
        status: 'SELESAI',
      },
    });

    return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, nota.id) };
  });
}

/**
 * Batalkan nota retur.
 *
 * Potongan yang menunjuk nota ini TIDAK ikut terhapus — kalau toko sudah
 * memotong pembayarannya, uang itu tetap kurang dan tetap harus ditagih.
 * Pembacanya memperlakukan nota batal sebagai fisik nol, jadi potongannya
 * ditahan penuh dan muncul di layar piutang sampai ada yang membetulkannya.
 */
export async function batalkanRetur(input: {
  storeReturnId: string;
  alasan: string;
}): Promise<{ ok: true; piutangDihitungUlang: number } | { ok: false; alasan: AlasanGagalRetur }> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const nota = await tx.storeReturn.findUnique({
      where: { id: input.storeReturnId },
      select: { id: true, status: true, note: true },
    });
    if (!nota) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nota.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };

    await tx.storeReturn.update({
      where: { id: nota.id },
      data: {
        status: 'BATAL',
        note: [nota.note, input.alasan.trim()].filter(Boolean).join('\n'),
      },
    });

    return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, nota.id) };
  });
}
