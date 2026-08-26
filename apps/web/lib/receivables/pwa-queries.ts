import { prisma } from '@elorae/db';
import { daftarPiutang, type BarisPiutang } from './queries';
import type { StatusKlaim } from './rules';
import { daftarKerjaRetur } from './return-queries';

const angka = (v: unknown): number => Number(v ?? 0);

export type TokoLapangan = {
  storeId: string;
  storeName: string;
  jumlahFaktur: number;
  sisa: number;
  /** Keadaan paling mendesak di toko ini — itulah yang dibaca sales duluan. */
  keadaan: BarisPiutang['keadaan'];
  alasan: BarisPiutang['alasan'];
  /** Nomor kontrabon atau BKM yang menempel pada keadaan itu. */
  doc: string | null;
};

/**
 * Ringkasan per toko untuk layar sales.
 *
 * Diringkas ke SATU kalimat per toko, bukan daftar faktur. Sales membacanya
 * sambil berdiri di depan toko — yang ia butuhkan adalah apakah boleh menagih
 * dan kalau tidak, kenapa. Rinciannya ada satu ketukan di bawah.
 */
const URUT: BarisPiutang['keadaan'][] = ['lewat', 'tertahan', 'klaim', 'tt', 'belum', 'lunas'];

export async function tokoLapangan(salesmanId: string): Promise<TokoLapangan[]> {
  const piutang = await daftarPiutang({ salesmanId });

  const peta = new Map<string, TokoLapangan>();
  for (const p of piutang) {
    const grup = peta.get(p.storeId) ?? {
      storeId: p.storeId,
      storeName: p.storeName,
      jumlahFaktur: 0,
      sisa: 0,
      keadaan: 'lunas' as BarisPiutang['keadaan'],
      alasan: {},
      doc: null,
    };
    grup.jumlahFaktur += 1;
    grup.sisa += p.outstanding;
    // Keadaan yang lebih mendesak menang. Urutannya sama dengan urutan
    // pemeriksaan keadaan faktur, jadi layar sales dan layar kantor tidak
    // pernah menyebut satu toko dengan dua cerita berbeda.
    if (URUT.indexOf(p.keadaan) < URUT.indexOf(grup.keadaan)) {
      grup.keadaan = p.keadaan;
      grup.alasan = p.alasan;
      grup.doc = p.alasan.noKontrabon ?? p.alasan.noKlaim ?? null;
    }
    peta.set(p.storeId, grup);
  }

  return [...peta.values()].sort(
    (a, b) => URUT.indexOf(a.keadaan) - URUT.indexOf(b.keadaan) || b.sisa - a.sisa,
  );
}

/** Faktur satu toko, untuk layar rincian sales. */
export async function fakturToko(
  salesmanId: string,
  storeId: string,
): Promise<{ storeName: string; baris: BarisPiutang[] } | null> {
  const semua = await daftarPiutang({ salesmanId });
  const baris = semua.filter((p) => p.storeId === storeId);
  if (baris.length === 0) return null;
  return { storeName: baris[0].storeName, baris };
}

export type KlaimSaya = {
  id: string;
  docNo: string;
  storeName: string;
  tanggal: string;
  nilaiDiterima: number;
  status: StatusKlaim;
  catatan: string | null;
};

/** BKM yang pernah dilaporkan sales ini. */
export async function klaimSaya(salesmanId: string): Promise<KlaimSaya[]> {
  const rows = await prisma.paymentClaim.findMany({
    where: { salesmanId },
    orderBy: [{ createdAt: 'desc' }],
    take: 50,
    select: {
      id: true,
      docNo: true,
      claimedTransferAt: true,
      receivedAmount: true,
      status: true,
      verifyNote: true,
      store: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    storeName: r.store.name,
    tanggal: r.claimedTransferAt.toISOString(),
    nilaiDiterima: angka(r.receivedAmount),
    status: r.status as KlaimSaya['status'],
    catatan: r.verifyNote,
  }));
}

export type ReturSaya = {
  id: string;
  noNrt: string;
  storeName: string;
  tanggal: string;
  nilaiKlaim: number;
  langkah: string;
  adaFoto: boolean;
};

/** Nota retur yang pernah dicatat sales ini. */
export async function returSaya(salesmanId: string): Promise<ReturSaya[]> {
  const kerja = await daftarKerjaRetur();
  const rows = await prisma.storeReturn.findMany({
    where: { salesmanId },
    orderBy: [{ claimDate: 'desc' }],
    take: 50,
    select: { id: true },
  });
  const milikSaya = new Set(rows.map((r) => r.id));

  return kerja
    .filter((k) => k.jenis === 'NRT' && milikSaya.has(k.id))
    .map((k) => ({
      id: k.id,
      noNrt: k.nomor,
      storeName: k.storeName ?? '—',
      tanggal: k.tanggal,
      nilaiKlaim: k.nilaiKlaim ?? 0,
      langkah: k.langkah,
      adaFoto: k.adaFoto,
    }));
}

export type BebanSaya = {
  id: string;
  noNrt: string | null;
  storeName: string | null;
  nilai: number;
  status: 'DITETAPKAN' | 'LUNAS';
  catatan: string | null;
  diputuskanPada: string | null;
};

/**
 * Beban selisih yang ditanggung sales ini.
 *
 * Hanya yang sudah DITETAPKAN ke orangnya — beban yang masih terbuka belum
 * jadi tanggungan siapa pun, dan menampilkannya di sini akan menuduh sales
 * atas sesuatu yang belum diputuskan.
 */
export async function bebanSaya(userId: string): Promise<BebanSaya[]> {
  const rows = await prisma.returnCharge.findMany({
    where: { bearerUserId: userId, status: { in: ['DITETAPKAN', 'LUNAS'] } },
    orderBy: [{ status: 'asc' }, { decidedAt: 'desc' }],
    select: {
      id: true,
      amount: true,
      status: true,
      note: true,
      decidedAt: true,
      store: { select: { name: true } },
      storeReturn: { select: { noNrt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    noNrt: r.storeReturn?.noNrt ?? null,
    storeName: r.store?.name ?? null,
    nilai: angka(r.amount),
    status: r.status as BebanSaya['status'],
    catatan: r.note,
    diputuskanPada: r.decidedAt?.toISOString() ?? null,
  }));
}

/** Nota retur yang menunggu dicek gudang — layar anak gudang. */
export async function menungguGudang() {
  const kerja = await daftarKerjaRetur();
  return kerja
    .filter((k) => k.langkah === 'cek')
    .map((k) => ({
      id: k.id,
      noNrt: k.nomor,
      storeName: k.storeName ?? '—',
      tanggal: k.tanggal,
      nilaiKlaim: k.nilaiKlaim ?? 0,
      caraKirim: k.caraKirim,
      adaFoto: k.adaFoto,
    }));
}
