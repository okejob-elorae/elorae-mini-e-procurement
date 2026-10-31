import { prisma } from '@elorae/db';
import { daftarPiutang, ringkasPiutang, type BarisPiutang } from './queries';
import { daftarKerjaRetur, ringkasKerjaRetur } from './return-queries';
import { URUT_KEADAAN_TAMPIL, type KeadaanTampil } from './jatuh-tempo';
import { susunTindakan, type TindakanHariIni } from './tindakan-dasbor';

const angka = (v: unknown): number => Number(v ?? 0);

export type { TindakanHariIni };

/** `nama: null` = faktur tanpa salesman (impor lama, faktur manual). */
export type PiutangPerSales = { nama: string | null; nilai: number; jumlah: number };

export type Dasbor = {
  totalPiutang: number;
  /** Faktur yang sisanya masih di atas nol — yang lunas tidak dihitung. */
  jumlahPiutang: number;
  /** Lewat JANJI BAYAR kontrabon. */
  lewatTempo: number;
  nilaiLewatTempo: number;
  /** Lewat JATUH TEMPO faktur dan belum dikontrabon. */
  jatuhTempo: number;
  nilaiJatuhTempo: number;
  menungguVerifikasi: number;
  nilaiMenungguVerifikasi: number;
  /** Nilai yang ditahan retur, atas faktur berkeadaan `tertahan` — daftar `?keadaan=tertahan`. */
  tertahanRetur: number;
  /** Jumlah faktur itu — angka yang sama dengan pil "Tertahan retur" di Faktur & piutang. */
  fakturTertahan: number;
  /** Nota retur yang belum beres — daftar bawaan Retur & pencocokan ("Perlu dikerjakan"). */
  returPerluDikerjakan: number;
  returPerLangkah: { cek: number; jodoh: number; keputusan: number };
  bebanTerbuka: number;
  nilaiBebanTerbuka: number;
  tindakan: TindakanHariIni[];
  perSales: PiutangPerSales[];
  perKeadaan: { keadaan: KeadaanTampil; jumlah: number; nilai: number }[];
};

/**
 * Angka beranda.
 *
 * Semuanya diturunkan dari kueri yang sama dengan halaman-halamannya sendiri,
 * bukan dari agregat tersendiri. Beranda yang menghitung dengan caranya sendiri
 * akan menyebut angka berbeda dari halaman yang dituju tautannya — dan orang
 * akan berhenti mempercayai keduanya.
 *
 * `penontonId` = pengguna yang membuka beranda. BKM yang ia laporkan/catat
 * sendiri tidak boleh ia putuskan, jadi barisnya berbunyi lain dan turun ke
 * bawah daftar tindakan.
 */
export async function muatDasbor(penontonId = '', opsi?: { bolehMenghitung?: boolean }): Promise<Dasbor> {
  /*
   * Kartu "Penyimpanan foto" sudah tidak di sini: ukuran foto di basis data
   * bukan pekerjaan admin piutang. Angkanya tetap tersedia lewat
   * `pemakaianFoto()` (`lib/foto/pembersih.ts`) untuk layar pengaturan sistem.
   */
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
        salesmanId: true,
        createdById: true,
        store: { select: { name: true } },
        salesman: { select: { name: true } },
        createdBy: { select: { name: true } },
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
  const tertahan = piutang.filter((p) => p.keadaanTampil === 'tertahan');
  const ringkasRetur = ringkasKerjaRetur(retur);

  const tindakan = susunTindakan({
    piutang,
    klaimMenunggu: klaimMenunggu.map((k) => ({
      id: k.id,
      docNo: k.docNo,
      receivedAmount: angka(k.receivedAmount),
      createdAt: k.createdAt,
      storeName: k.store.name,
      salesmanId: k.salesmanId,
      createdById: k.createdById,
      // Dicatat kantor atas nama sales → yang disebut pencatatnya.
      pelapor: k.createdById === k.salesmanId ? (k.salesman?.name ?? null) : (k.createdBy?.name ?? null),
    })),
    retur,
    penontonId,
    bolehMenghitung: opsi?.bolehMenghitung ?? false,
    hariIni: new Date(),
  });

  const perSales = new Map<string, PiutangPerSales>();
  for (const p of piutang) {
    if (p.outstanding <= 0) continue;
    const kunci = p.salesmanName ?? '';
    const grup = perSales.get(kunci) ?? { nama: p.salesmanName, nilai: 0, jumlah: 0 };
    grup.nilai += p.outstanding;
    grup.jumlah += 1;
    perSales.set(kunci, grup);
  }

  return {
    totalPiutang: ringkas.total,
    jumlahPiutang: ringkas.jumlahPiutang,
    lewatTempo: ringkas.perKeadaanTampil.lewat.jumlah,
    nilaiLewatTempo: ringkas.perKeadaanTampil.lewat.nilai,
    jatuhTempo: ringkas.perKeadaanTampil.jatuh_tempo.jumlah,
    nilaiJatuhTempo: ringkas.perKeadaanTampil.jatuh_tempo.nilai,
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
     *
     * Hanya faktur berkeadaan `tertahan` — kartunya menaut ke daftar itu, jadi
     * angkanya harus sama dengan isinya (dan dengan baris "Tertahan retur" di
     * daftar tindakan). Faktur yang masih menunggu BKM lain dihitung di kartu
     * "Menunggu verifikasi".
     */
    tertahanRetur: tertahan.reduce((s, p) => s + (p.alasan.nilaiTertahan ?? 0), 0),
    fakturTertahan: tertahan.length,
    returPerluDikerjakan: ringkasRetur.perluDikerjakan,
    returPerLangkah: {
      cek: ringkasRetur.perLangkah.cek,
      jodoh: ringkasRetur.perLangkah.jodoh,
      keputusan: ringkasRetur.perLangkah.keputusan,
    },
    bebanTerbuka: beban.length,
    nilaiBebanTerbuka: beban.reduce((s, b) => s + angka(b.amount), 0),
    tindakan,
    perSales: [...perSales.values()].sort((a, b) => b.nilai - a.nilai),
    perKeadaan: URUT_KEADAAN_TAMPIL.map((k) => ({
      keadaan: k,
      jumlah: ringkas.perKeadaanTampil[k].jumlah,
      nilai: ringkas.perKeadaanTampil[k].nilai,
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
  /** Dibebankan ke sales tapi tidak menyebut orangnya — tuduhan tanpa alamat. */
  tanpaAlamat: boolean;
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
      bearerUserId: true,
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
    // Baris seperti ini tidak akan pernah muncul di layar siapa pun.
    tanpaAlamat: r.bearer === 'SALES' && r.bearerUserId === null,
    catatan: r.note,
    diputuskanOleh: r.decidedBy?.name ?? null,
    diputuskanPada: r.decidedAt?.toISOString() ?? null,
    dilunasiPada: r.settledAt?.toISOString() ?? null,
  }));
}

export type { BarisPiutang };
