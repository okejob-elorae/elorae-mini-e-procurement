import { prisma } from '@elorae/db';
import { giliranRetur, langkahRetur, type LangkahRetur } from './rules';

const angka = (v: unknown): number => Number(v ?? 0);

export type CaraKirim = 'SALES' | 'TOKO' | 'EKSPEDISI';
export type StatusBeban = 'TERBUKA' | 'DITETAPKAN' | 'LUNAS';
export type Penanggung = 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN';

/**
 * Satu baris daftar kerja retur.
 *
 * Dua jenis baris hidup di daftar yang sama: nota toko (NRT) dan penerimaan
 * gudang yang belum berpasangan. Menggabungkannya disengaja — kalau dipisah jadi
 * dua halaman, penerimaan yatim tidak pernah dilihat siapa pun, karena tidak ada
 * yang tahu ia ada sampai notanya muncul.
 *
 * `langkah` dan `giliran` dibawa sebagai kata, bukan kalimat jadi, supaya
 * kalimatnya ikut berganti bahasa bersama sisa aplikasi.
 */
export type BarisKerjaRetur = {
  jenis: 'NRT' | 'GUDANG_YATIM';
  id: string;
  nomor: string;
  nomorPasangan: string | null;
  storeId: string | null;
  storeName: string | null;
  salesmanName: string | null;
  tanggal: string;
  caraKirim: CaraKirim;
  adaFoto: boolean;
  nilaiKlaim: number | null;
  nilaiFisik: number | null;
  selisih: number;
  langkah: LangkahRetur;
  giliran: 'gudang' | 'keuangan' | 'tidak_ada';
  bebanId: string | null;
  bebanStatus: StatusBeban | null;
  penanggung: Penanggung | null;
  jumlahPotongan: number;
  nilaiDipotong: number;
};

const PILIH_NRT = {
  id: true,
  noNrt: true,
  storeId: true,
  claimDate: true,
  deliveryMethod: true,
  claimedAmount: true,
  photoUrl: true,
  status: true,
  store: { select: { name: true } },
  salesman: { select: { name: true } },
  warehouseReturn: { select: { noNri: true, physicalAmount: true, status: true } },
  charges: { select: { id: true, status: true, bearer: true, amount: true } },
  deductions: { select: { amount: true } },
} as const;

function dariNrt(r: {
  id: string;
  noNrt: string;
  storeId: string;
  claimDate: Date;
  deliveryMethod: string;
  claimedAmount: unknown;
  photoUrl: string | null;
  status: string;
  store: { name: string };
  salesman: { name: string | null } | null;
  warehouseReturn: { noNri: string; physicalAmount: unknown; status: string } | null;
  charges: { id: string; status: string; bearer: string | null; amount: unknown }[];
  deductions: { amount: unknown }[];
}): BarisKerjaRetur {
  const nri = r.warehouseReturn;
  // Hitungan yang masih draft dianggap belum ada — sama seperti di pembaca
  // potongan. Angka yang masih bisa berubah tidak melepas apa pun.
  const final = nri !== null && nri.status === 'FINAL';
  const nilaiKlaim = angka(r.claimedAmount);
  const nilaiFisik = final ? angka(nri.physicalAmount) : null;
  const beban = r.charges[0] ?? null;
  const bebanDiputuskan = r.charges.some((c) => c.status !== 'TERBUKA');

  const langkah = langkahRetur({
    dibatalkan: r.status === 'BATAL',
    adaNotaToko: true,
    adaHitunganFinal: final,
    nilaiKlaim,
    nilaiFisik,
    bebanDiputuskan,
  });

  return {
    jenis: 'NRT',
    id: r.id,
    nomor: r.noNrt,
    nomorPasangan: nri?.noNri ?? null,
    storeId: r.storeId,
    storeName: r.store.name,
    salesmanName: r.salesman?.name ?? null,
    tanggal: r.claimDate.toISOString(),
    caraKirim: r.deliveryMethod as CaraKirim,
    adaFoto: Boolean(r.photoUrl),
    nilaiKlaim,
    nilaiFisik,
    selisih: nilaiFisik === null ? 0 : Math.max(0, nilaiKlaim - nilaiFisik),
    langkah,
    giliran: giliranRetur(langkah),
    bebanId: beban?.id ?? null,
    bebanStatus: (beban?.status as StatusBeban) ?? null,
    penanggung: (beban?.bearer as Penanggung) ?? null,
    jumlahPotongan: r.deductions.length,
    nilaiDipotong: r.deductions.reduce((s, d) => s + angka(d.amount), 0),
  };
}

/**
 * Daftar kerja retur — nota toko dan penerimaan gudang yatim dalam satu daftar.
 */
export async function daftarKerjaRetur(): Promise<BarisKerjaRetur[]> {
  const [nrt, yatim] = await Promise.all([
    prisma.storeReturn.findMany({ orderBy: [{ claimDate: 'desc' }], select: PILIH_NRT }),
    prisma.warehouseReturn.findMany({
      where: { storeReturnId: null },
      orderBy: [{ receivedAt: 'desc' }],
      select: {
        id: true,
        noNri: true,
        storeId: true,
        receivedAt: true,
        deliveryMethod: true,
        physicalAmount: true,
        store: { select: { name: true } },
      },
    }),
  ]);

  const baris: BarisKerjaRetur[] = [
    ...nrt.map(dariNrt),
    ...yatim.map((r) => ({
      jenis: 'GUDANG_YATIM' as const,
      id: r.id,
      nomor: r.noNri,
      nomorPasangan: null,
      storeId: r.storeId,
      storeName: r.store?.name ?? null,
      salesmanName: null,
      tanggal: r.receivedAt.toISOString(),
      caraKirim: r.deliveryMethod as CaraKirim,
      adaFoto: false,
      nilaiKlaim: null,
      nilaiFisik: angka(r.physicalAmount),
      selisih: 0,
      langkah: 'jodoh' as const,
      giliran: 'keuangan' as const,
      bebanId: null,
      bebanStatus: null,
      penanggung: null,
      jumlahPotongan: 0,
      nilaiDipotong: 0,
    })),
  ];

  // Yang perlu dikerjakan naik ke atas; sisanya menurut tanggal.
  const prioritas: Record<LangkahRetur, number> = {
    keputusan: 0,
    cek: 1,
    jodoh: 2,
    beres: 3,
    batal: 4,
  };
  return baris.sort(
    (a, b) => prioritas[a.langkah] - prioritas[b.langkah] || b.tanggal.localeCompare(a.tanggal),
  );
}

export type RingkasanKerjaRetur = {
  perLangkah: Record<LangkahRetur, number>;
  perluDikerjakan: number;
  /** Nilai yang masih ditahan dari piutang oleh retur yang belum tuntas. */
  nilaiTertahan: number;
};

/**
 * Ringkasan kepala halaman.
 *
 * `nilaiTertahan` dihitung dari yang benar-benar SUDAH DIPOTONG toko, bukan dari
 * nilai klaim notanya. Nota yang belum dipakai memotong pembayaran mana pun
 * tidak menahan apa-apa — uangnya belum berkurang.
 */
export function ringkasKerjaRetur(baris: BarisKerjaRetur[]): RingkasanKerjaRetur {
  const perLangkah: Record<LangkahRetur, number> = {
    keputusan: 0,
    cek: 0,
    jodoh: 0,
    beres: 0,
    batal: 0,
  };
  let nilaiTertahan = 0;
  for (const b of baris) {
    perLangkah[b.langkah] += 1;
    if (b.langkah === 'cek' || b.langkah === 'batal') {
      nilaiTertahan += b.nilaiDipotong;
    } else if (b.langkah === 'keputusan' && (b.nilaiKlaim ?? 0) > 0) {
      // Sebagian nota mungkin belum dipotong penuh; yang ditahan hanya porsi
      // dari yang sudah dipotong — prorata yang sama seperti di aturannya.
      nilaiTertahan += b.nilaiDipotong * (b.selisih / (b.nilaiKlaim ?? 1));
    }
  }
  return {
    perLangkah,
    perluDikerjakan: perLangkah.keputusan + perLangkah.cek + perLangkah.jodoh,
    nilaiTertahan,
  };
}

export type RincianRetur = {
  baris: BarisKerjaRetur;
  note: string | null;
  photoUrl: string | null;
  barangKlaim: { itemName: string; qty: number; price: number; amount: number }[];
  barangFisik: {
    itemName: string;
    qtyClaim: number;
    qty: number;
    price: number;
    amount: number;
    condition: string;
  }[];
  gudang: {
    id: string;
    noNri: string;
    olehNama: string | null;
    diterimaPada: string;
    catatan: string | null;
  } | null;
  beban: {
    id: string;
    amount: number;
    status: StatusBeban;
    penanggung: Penanggung | null;
    catatan: string | null;
    diputuskanOleh: string | null;
    diputuskanPada: string | null;
  } | null;
  potongan: { docNo: string; amount: number; status: string }[];
};

/** Satu nota retur toko, kedua sisinya, siap dibandingkan per barang. */
export async function rincianRetur(storeReturnId: string): Promise<RincianRetur | null> {
  const r = await prisma.storeReturn.findUnique({
    where: { id: storeReturnId },
    select: {
      ...PILIH_NRT,
      note: true,
      items: { select: { itemName: true, qty: true, price: true, amount: true } },
      warehouseReturn: {
        select: {
          id: true,
          noNri: true,
          physicalAmount: true,
          status: true,
          receivedAt: true,
          note: true,
          warehouseUser: { select: { name: true } },
          items: {
            select: {
              itemName: true,
              qtyClaim: true,
              qty: true,
              price: true,
              amount: true,
              condition: true,
            },
          },
        },
      },
      charges: {
        select: {
          id: true,
          amount: true,
          status: true,
          bearer: true,
          note: true,
          decidedAt: true,
          decidedBy: { select: { name: true } },
        },
      },
      deductions: {
        select: {
          amount: true,
          paymentClaim: { select: { docNo: true, status: true } },
        },
      },
    },
  });
  if (!r) return null;

  const nri = r.warehouseReturn;
  const beban = r.charges[0] ?? null;

  return {
    baris: dariNrt({
      ...r,
      warehouseReturn: nri
        ? { noNri: nri.noNri, physicalAmount: nri.physicalAmount, status: nri.status }
        : null,
    }),
    note: r.note,
    photoUrl: r.photoUrl,
    barangKlaim: r.items.map((i) => ({
      itemName: i.itemName,
      qty: i.qty,
      price: angka(i.price),
      amount: angka(i.amount),
    })),
    barangFisik: (nri?.items ?? []).map((i) => ({
      itemName: i.itemName,
      qtyClaim: i.qtyClaim,
      qty: i.qty,
      price: angka(i.price),
      amount: angka(i.amount),
      condition: i.condition,
    })),
    gudang: nri
      ? {
          id: nri.id,
          noNri: nri.noNri,
          olehNama: nri.warehouseUser?.name ?? null,
          diterimaPada: nri.receivedAt.toISOString(),
          catatan: nri.note,
        }
      : null,
    beban: beban
      ? {
          id: beban.id,
          amount: angka(beban.amount),
          status: beban.status as StatusBeban,
          penanggung: (beban.bearer as Penanggung) ?? null,
          catatan: beban.note,
          diputuskanOleh: beban.decidedBy?.name ?? null,
          diputuskanPada: beban.decidedAt?.toISOString() ?? null,
        }
      : null,
    potongan: r.deductions.map((d) => ({
      docNo: d.paymentClaim.docNo,
      amount: angka(d.amount),
      status: d.paymentClaim.status,
    })),
  };
}

/** Nota toko yang masih menunggu hitungan gudang — calon pasangan bagi yatim. */
export async function notaBelumBerpasangan(storeId?: string | null) {
  return prisma.storeReturn.findMany({
    where: {
      status: { not: 'BATAL' },
      warehouseReturn: null,
      ...(storeId ? { storeId } : {}),
    },
    orderBy: { claimDate: 'desc' },
    select: {
      id: true,
      noNrt: true,
      claimedAmount: true,
      claimDate: true,
      store: { select: { id: true, name: true } },
    },
  });
}

/** Toko aktif, untuk memilih saat mencatat nota retur. */
export async function tokoUntukRetur(): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}
