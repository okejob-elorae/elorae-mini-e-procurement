import { prisma } from '@elorae/db';
import { keadaanRetur, type KeadaanRetur } from './rules';

const angka = (v: unknown): number => Number(v ?? 0);

export type BarisRetur = {
  id: string;
  docNo: string;
  storeName: string;
  salesmanName: string | null;
  claimDate: string;
  nilaiKlaim: number;
  nilaiFisik: number | null;
  selisih: number;
  bearer: 'TOKO' | 'SALES' | 'PERUSAHAAN' | null;
  bearerReason: string | null;
  countedByName: string | null;
  decidedByName: string | null;
  status: 'DIAJUKAN' | 'DIHITUNG' | 'SELESAI' | 'BATAL';
  keadaan: KeadaanRetur;
  /** Berapa potongan pembayaran yang menunjuk nota ini. */
  jumlahPotongan: number;
  /** Nilai yang sudah dipotong toko dari pembayaran atas dasar nota ini. */
  nilaiDipotong: number;
};

/**
 * Daftar nota retur dengan kedua sisinya.
 *
 * `selisih` positif berarti gudang menerima kurang dari yang diklaim — itulah
 * yang ditahan dari piutang sampai ada yang ditetapkan menanggungnya. Selisih
 * negatif (gudang menerima lebih) dinolkan: itu bukan utang toko, dan
 * menampilkannya sebagai angka merah akan menyuruh orang menagih yang tidak ada.
 */
export async function daftarRetur(opts?: {
  keadaan?: KeadaanRetur;
}): Promise<BarisRetur[]> {
  const rows = await prisma.storeReturn.findMany({
    orderBy: [{ claimDate: 'desc' }],
    select: {
      id: true,
      docNo: true,
      claimDate: true,
      claimedAmount: true,
      countedAmount: true,
      bearer: true,
      bearerReason: true,
      status: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      countedBy: { select: { name: true } },
      decidedBy: { select: { name: true } },
      deductions: { select: { amount: true } },
    },
  });

  const baris = rows.map((r) => {
    const nilaiKlaim = angka(r.claimedAmount);
    const nilaiFisik = r.countedAmount === null ? null : angka(r.countedAmount);
    return {
      id: r.id,
      docNo: r.docNo,
      storeName: r.store.name,
      salesmanName: r.salesman?.name ?? null,
      claimDate: r.claimDate.toISOString(),
      nilaiKlaim,
      nilaiFisik,
      selisih: nilaiFisik === null ? 0 : Math.max(0, nilaiKlaim - nilaiFisik),
      bearer: r.bearer as BarisRetur['bearer'],
      bearerReason: r.bearerReason,
      countedByName: r.countedBy?.name ?? null,
      decidedByName: r.decidedBy?.name ?? null,
      status: r.status as BarisRetur['status'],
      keadaan: keadaanRetur({
        status: r.status as BarisRetur['status'],
        nilaiKlaim,
        nilaiFisik,
        bebanDiputuskan: r.bearer !== null,
      }),
      jumlahPotongan: r.deductions.length,
      nilaiDipotong: r.deductions.reduce((sum, d) => sum + angka(d.amount), 0),
    };
  });

  return opts?.keadaan ? baris.filter((b) => b.keadaan === opts.keadaan) : baris;
}

export type RingkasanRetur = {
  jumlah: number;
  /** Nilai yang masih ditahan dari piutang oleh retur yang belum tuntas. */
  nilaiTertahan: number;
  perKeadaan: Record<KeadaanRetur, number>;
};

/**
 * Ringkasan untuk kepala halaman.
 *
 * `nilaiTertahan` dihitung dari yang benar-benar SUDAH DIPOTONG toko, bukan dari
 * nilai klaim notanya. Nota retur yang belum dipakai memotong pembayaran mana
 * pun tidak menahan apa-apa — uangnya belum berkurang.
 */
export function ringkasRetur(baris: BarisRetur[]): RingkasanRetur {
  const perKeadaan: Record<KeadaanRetur, number> = {
    menunggu: 0,
    selisih: 0,
    beres: 0,
    batal: 0,
  };
  let nilaiTertahan = 0;
  for (const b of baris) {
    perKeadaan[b.keadaan] += 1;
    if (b.keadaan === 'menunggu') {
      nilaiTertahan += b.nilaiDipotong;
    } else if (b.keadaan === 'selisih' && b.nilaiKlaim > 0) {
      // Sebagian nota mungkin belum dipotong; yang ditahan hanya porsi dari
      // yang sudah dipotong, sama seperti prorata di `bahanPotonganRetur`.
      nilaiTertahan += b.nilaiDipotong * (b.selisih / b.nilaiKlaim);
    } else if (b.keadaan === 'batal') {
      nilaiTertahan += b.nilaiDipotong;
    }
  }
  return { jumlah: baris.length, nilaiTertahan, perKeadaan };
}

/** Toko yang bisa dibuatkan nota retur — semua toko aktif. */
export async function tokoUntukRetur(): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}
