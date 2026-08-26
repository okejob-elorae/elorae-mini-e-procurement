import { prisma } from '@elorae/db';
import { daftarPiutang, ringkasPiutang, type BarisPiutang } from './queries';
import { daftarKerjaRetur, ringkasKerjaRetur } from './return-queries';
import { selisihHari, type KeadaanPiutang } from './rules';

const angka = (v: unknown): number => Number(v ?? 0);

export type TindakanHariIni = {
  jenis: 'lewat' | 'klaim' | 'tertahan' | 'cek' | 'keputusan' | 'jodoh';
  /** Makin besar makin mendesak. Dipakai mengurutkan, tidak ditampilkan. */
  risiko: number;
  judul: string;
  tautan: string;
  nilai: number;
  /** Bahan kalimat; kalimatnya dirakit di klien supaya ikut berganti bahasa. */
  konteks: { toko?: string; hari?: number; doc?: string };
};

export type PiutangPerSales = { nama: string; nilai: number; jumlah: number };

export type Dasbor = {
  totalPiutang: number;
  jumlahPiutang: number;
  lewatTempo: number;
  nilaiLewatTempo: number;
  menungguVerifikasi: number;
  nilaiMenungguVerifikasi: number;
  tertahanRetur: number;
  returPerluDikerjakan: number;
  bebanTerbuka: number;
  nilaiBebanTerbuka: number;
  tindakan: TindakanHariIni[];
  perSales: PiutangPerSales[];
  perKeadaan: { keadaan: KeadaanPiutang; jumlah: number; nilai: number }[];
};

/**
 * Angka beranda.
 *
 * Semuanya diturunkan dari kueri yang sama dengan halaman-halamannya sendiri,
 * bukan dari agregat tersendiri. Beranda yang menghitung dengan caranya sendiri
 * akan menyebut angka berbeda dari halaman yang dituju tautannya — dan orang
 * akan berhenti mempercayai keduanya.
 */
export async function muatDasbor(): Promise<Dasbor> {
  const [piutang, retur, klaimMenunggu, beban] = await Promise.all([
    daftarPiutang(),
    daftarKerjaRetur(),
    prisma.paymentClaim.findMany({
      where: { status: 'DIKIRIM' },
      select: {
        id: true,
        docNo: true,
        receivedAmount: true,
        createdAt: true,
        store: { select: { name: true } },
      },
    }),
    prisma.returnCharge.findMany({
      where: { status: 'TERBUKA' },
      select: {
        id: true,
        amount: true,
        storeReturnId: true,
        store: { select: { name: true } },
      },
    }),
  ]);

  const ringkas = ringkasPiutang(piutang);
  const ringkasRetur = ringkasKerjaRetur(retur);
  const hariIni = new Date();

  const tindakan: TindakanHariIni[] = [];

  for (const p of piutang) {
    if (p.keadaan === 'lewat') {
      const hari = p.alasan.hariTerlambat ?? Math.max(0, selisihHari(new Date(p.dueDate), hariIni));
      tindakan.push({
        jenis: 'lewat',
        // Makin lama lewat makin mendesak, dan nilainya ikut menimbang — sepuluh
        // hari atas sepuluh juta lebih genting dari sepuluh hari atas seratus ribu.
        risiko: 1000 + hari * 10 + Math.log10(Math.max(p.outstanding, 1)),
        judul: p.invoiceNo,
        tautan: '/backoffice/piutang',
        nilai: p.outstanding,
        konteks: { toko: p.storeName, hari },
      });
    } else if (p.keadaan === 'tertahan') {
      tindakan.push({
        jenis: 'tertahan',
        risiko: 800 + Math.log10(Math.max(p.alasan.nilaiTertahan ?? 1, 1)),
        judul: p.invoiceNo,
        tautan: '/backoffice/retur-toko',
        nilai: p.alasan.nilaiTertahan ?? 0,
        konteks: { toko: p.storeName },
      });
    }
  }

  for (const k of klaimMenunggu) {
    const hari = Math.max(0, selisihHari(k.createdAt, hariIni));
    tindakan.push({
      jenis: 'klaim',
      // Klaim yang menunggu lama adalah uang yang mungkin sudah di rekening
      // tapi belum diakui — dan sales yang merasa laporannya diabaikan.
      risiko: 900 + hari * 10,
      judul: k.docNo,
      tautan: `/backoffice/pelunasan/${k.id}`,
      nilai: angka(k.receivedAmount),
      konteks: { toko: k.store.name, hari },
    });
  }

  for (const r of retur) {
    if (r.langkah === 'beres' || r.langkah === 'batal') continue;
    tindakan.push({
      jenis: r.langkah,
      risiko: r.langkah === 'keputusan' ? 950 : r.langkah === 'jodoh' ? 700 : 600,
      judul: r.nomor,
      tautan: r.jenis === 'NRT' ? `/backoffice/retur-toko/${r.id}` : '/backoffice/retur-toko',
      nilai: r.langkah === 'keputusan' ? r.selisih : (r.nilaiKlaim ?? r.nilaiFisik ?? 0),
      konteks: { toko: r.storeName ?? undefined },
    });
  }

  tindakan.sort((a, b) => b.risiko - a.risiko);

  const perSales = new Map<string, PiutangPerSales>();
  for (const p of piutang) {
    if (p.outstanding <= 0) continue;
    const nama = p.salesmanName ?? '—';
    const grup = perSales.get(nama) ?? { nama, nilai: 0, jumlah: 0 };
    grup.nilai += p.outstanding;
    grup.jumlah += 1;
    perSales.set(nama, grup);
  }

  const URUT: KeadaanPiutang[] = ['lewat', 'tertahan', 'klaim', 'tt', 'belum', 'lunas'];

  return {
    totalPiutang: ringkas.total,
    jumlahPiutang: ringkas.jumlahPiutang,
    lewatTempo: ringkas.perKeadaan.lewat.jumlah,
    nilaiLewatTempo: ringkas.perKeadaan.lewat.nilai,
    menungguVerifikasi: klaimMenunggu.length,
    nilaiMenungguVerifikasi: klaimMenunggu.reduce((s, k) => s + angka(k.receivedAmount), 0),
    /*
     * Dihitung dari PIUTANG, bukan dari nota returnya.
     *
     * Yang benar-benar menahan uang adalah potongan pada BKM, dan sebuah
     * potongan bisa menunjuk nota retur yang sudah tidak ada — ia tetap ditahan
     * penuh, tapi tidak punya baris di daftar kerja retur untuk dihitung.
     * Mengambil angkanya dari sana membuat kartu ini menulis nol sementara
     * daftar di bawahnya pada layar yang sama menyebut angka lain.
     */
    tertahanRetur: piutang.reduce((s, p) => s + (p.alasan.nilaiTertahan ?? 0), 0),
    returPerluDikerjakan: ringkasRetur.perluDikerjakan,
    bebanTerbuka: beban.length,
    nilaiBebanTerbuka: beban.reduce((s, b) => s + angka(b.amount), 0),
    // Dua puluh teratas. Daftar tindakan yang panjangnya ratusan bukan daftar
    // tindakan lagi — ia jadi laporan, dan tidak ada yang mengerjakannya.
    tindakan: tindakan.slice(0, 20),
    perSales: [...perSales.values()].sort((a, b) => b.nilai - a.nilai),
    perKeadaan: URUT.map((k) => ({
      keadaan: k,
      jumlah: ringkas.perKeadaan[k].jumlah,
      nilai: ringkas.perKeadaan[k].nilai,
    })),
  };
}

export type BarisBeban = {
  id: string;
  storeReturnId: string | null;
  noNrt: string | null;
  storeName: string | null;
  nilai: number;
  status: 'TERBUKA' | 'DITETAPKAN' | 'LUNAS';
  penanggung: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN' | null;
  penanggungNama: string | null;
  catatan: string | null;
  diputuskanOleh: string | null;
  diputuskanPada: string | null;
  dilunasiPada: string | null;
};

/** Daftar beban selisih retur, lintas toko. */
export async function daftarBeban(): Promise<BarisBeban[]> {
  const rows = await prisma.returnCharge.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      storeReturnId: true,
      amount: true,
      status: true,
      bearer: true,
      note: true,
      decidedAt: true,
      settledAt: true,
      store: { select: { name: true } },
      storeReturn: { select: { noNrt: true } },
      bearerUser: { select: { name: true } },
      decidedBy: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    storeReturnId: r.storeReturnId,
    noNrt: r.storeReturn?.noNrt ?? null,
    storeName: r.store?.name ?? null,
    nilai: angka(r.amount),
    status: r.status as BarisBeban['status'],
    penanggung: r.bearer as BarisBeban['penanggung'],
    penanggungNama: r.bearerUser?.name ?? null,
    catatan: r.note,
    diputuskanOleh: r.decidedBy?.name ?? null,
    diputuskanPada: r.decidedAt?.toISOString() ?? null,
    dilunasiPada: r.settledAt?.toISOString() ?? null,
  }));
}

export type { BarisPiutang };
