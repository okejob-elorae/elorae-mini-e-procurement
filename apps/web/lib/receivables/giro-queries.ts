import { prisma, type Prisma } from '@elorae/db';
import { fanOutAdminNotification } from '@/lib/notifications/admin-fanout';
import { formatIDR } from '@/lib/sales-orders/format';
import {
  giroKedaluwarsa,
  hariWib,
  kelompokGiro,
  ringkasGiro,
  STATUS_GIRO,
  tanggalWib,
  type KelompokGiro,
  type StatusGiro,
} from './giro';

/**
 * Kueri giro: daftar kerja keuangan dan pengingat harian.
 *
 * "Menunggu" = giro yang klaimnya masih DIKIRIM. Klaim giro yang ditolak atau
 * dibatalkan lewat jalur biasa (laporannya salah catat) keluar dari daftar ini
 * walau status giro-nya belum pernah disentuh: tidak ada lagi yang menunggu
 * bilyet itu cair.
 */

const angka = (v: unknown): number => Number(v ?? 0);

/** Riwayat keputusan giro yang ikut tampil di bawah daftar tunggu. */
const HARI_RIWAYAT = 30;
const BATAS_RIWAYAT = 50;

export type BarisGiro = {
  id: string;
  docNo: string;
  storeName: string;
  salesmanName: string | null;
  giroNo: string;
  giroBank: string;
  tanggalTerbit: Date | null;
  tanggalEfektif: Date | null;
  /** Nilai uang giro = yang diterima pada BKM-nya (faktur − potongan). */
  nilai: number;
  giroStatus: StatusGiro;
  /** Hanya untuk giro yang masih menunggu. */
  kelompok: KelompokGiro | null;
  /** Masa berlaku 70 hari sudah lewat — bilyetnya tidak bisa lagi diunjukkan. */
  kedaluwarsa: boolean;
  /** Kapan keputusannya diambil: tanggal cair, atau tanggal ditolak. */
  diputuskanPada: Date | null;
  catatan: string | null;
};

const PILIH = {
  id: true,
  docNo: true,
  giroNo: true,
  giroBank: true,
  giroIssueDate: true,
  giroEffectiveDate: true,
  giroStatus: true,
  giroSettledAt: true,
  receivedAmount: true,
  verifiedAt: true,
  verifyNote: true,
  store: { select: { name: true } },
  salesman: { select: { name: true } },
} satisfies Prisma.PaymentClaimSelect;

type BarisDb = Prisma.PaymentClaimGetPayload<{ select: typeof PILIH }>;

function keBaris(r: BarisDb, sekarang: Date): BarisGiro {
  const status = (r.giroStatus ?? STATUS_GIRO.MENUNGGU) as StatusGiro;
  const menunggu = status === STATUS_GIRO.MENUNGGU;
  return {
    id: r.id,
    docNo: r.docNo,
    storeName: r.store.name,
    salesmanName: r.salesman?.name ?? null,
    giroNo: r.giroNo ?? '—',
    giroBank: r.giroBank ?? '—',
    tanggalTerbit: r.giroIssueDate,
    tanggalEfektif: r.giroEffectiveDate,
    nilai: angka(r.receivedAmount),
    giroStatus: status,
    kelompok: menunggu && r.giroEffectiveDate ? kelompokGiro(r.giroEffectiveDate, sekarang) : null,
    kedaluwarsa: menunggu && r.giroIssueDate ? giroKedaluwarsa(r.giroIssueDate, sekarang) : false,
    diputuskanPada: status === STATUS_GIRO.CAIR ? r.giroSettledAt : menunggu ? null : r.verifiedAt,
    catatan: r.verifyNote,
  };
}

/** Giro yang masih menunggu cair, urut tanggal efektif — yang paling mendesak di atas. */
export async function giroMenunggu(opts?: {
  sekarang?: Date;
  /** Hanya klaim tertentu. Tes WAJIB memakainya — basis datanya dipakai bersama. */
  claimIds?: string[];
}): Promise<BarisGiro[]> {
  const sekarang = opts?.sekarang ?? new Date();
  const rows = await prisma.paymentClaim.findMany({
    where: {
      giroStatus: STATUS_GIRO.MENUNGGU,
      status: 'DIKIRIM',
      ...(opts?.claimIds ? { id: { in: opts.claimIds } } : {}),
    },
    orderBy: [{ giroEffectiveDate: 'asc' }, { createdAt: 'asc' }],
    select: PILIH,
  });
  return rows.map((r) => keBaris(r, sekarang));
}

/** Giro yang baru diputuskan — cair atau ditolak bank — dalam 30 hari terakhir. */
export async function giroBaruDiputuskan(opts?: { sekarang?: Date }): Promise<BarisGiro[]> {
  const sekarang = opts?.sekarang ?? new Date();
  const sejak = new Date(sekarang.getTime() - HARI_RIWAYAT * 24 * 60 * 60 * 1000);
  const rows = await prisma.paymentClaim.findMany({
    where: {
      giroStatus: { in: [STATUS_GIRO.CAIR, STATUS_GIRO.DITOLAK] },
      verifiedAt: { gte: sejak },
    },
    orderBy: [{ verifiedAt: 'desc' }],
    take: BATAS_RIWAYAT,
    select: PILIH,
  });
  return rows.map((r) => keBaris(r, sekarang));
}

/** Kategori `AdminNotification` pengingat harian. Dipetakan ke izin di `admin-fanout.ts`. */
export const KATEGORI_GIRO_JATUH_TEMPO = 'GIRO_JATUH_TEMPO';

export type HasilPengingatGiro =
  | { dibuat: false; alasan: 'TIDAK_ADA' | 'SUDAH_HARI_INI' }
  | { dibuat: true; id: string; jumlah: number; nilai: number };

/**
 * Pengingat pagi: giro yang efektif hari ini atau sudah lewat dan belum cair.
 *
 * SATU catatan per hari, bukan satu per giro — sepuluh ping untuk sepuluh
 * bilyet di laci yang sama membuat loncengnya diabaikan. Isinya menyebut
 * jumlah dan nilai; rinciannya di Daftar giro.
 *
 * Tidak ditulis dua kali dalam sehari: proses web bisa dimulai ulang tepat di
 * jam jadwalnya, dan pengingat kembar hanya menambah yang harus dibaca.
 * Dipanggil di luar transaksi apa pun — pengirimannya lewat FCM.
 */
export async function ingatkanGiroJatuhTempo(opts?: {
  sekarang?: Date;
  /** Hanya klaim tertentu. Tes WAJIB memakainya — basis datanya dipakai bersama. */
  claimIds?: string[];
}): Promise<HasilPengingatGiro> {
  const sekarang = opts?.sekarang ?? new Date();
  const hari = hariWib(sekarang);

  const menunggu = await giroMenunggu({ sekarang, claimIds: opts?.claimIds });
  const mendesak = menunggu.filter(
    (g): g is BarisGiro & { tanggalEfektif: Date } =>
      g.tanggalEfektif !== null && (g.kelompok === 'LEWAT' || g.kelompok === 'HARI_INI'),
  );
  if (mendesak.length === 0) return { dibuat: false, alasan: 'TIDAK_ADA' };

  const awalHari = tanggalWib(hari) ?? sekarang;
  const sudah = await prisma.adminNotification.findFirst({
    where: { category: KATEGORI_GIRO_JATUH_TEMPO, createdAt: { gte: awalHari } },
    select: { id: true },
  });
  if (sudah) return { dibuat: false, alasan: 'SUDAH_HARI_INI' };

  const r = ringkasGiro(mendesak, sekarang);
  const jumlah = r.LEWAT.jumlah + r.HARI_INI.jumlah;
  const nilai = r.LEWAT.nilai + r.HARI_INI.nilai;
  const bagian = [
    r.HARI_INI.jumlah > 0 ? `${r.HARI_INI.jumlah} giro efektif hari ini (${formatIDR(r.HARI_INI.nilai)})` : null,
    r.LEWAT.jumlah > 0 ? `${r.LEWAT.jumlah} giro lewat tanggal efektif (${formatIDR(r.LEWAT.nilai)})` : null,
  ].filter(Boolean);
  const kedaluwarsa = mendesak.filter((g) => g.kedaluwarsa).length;

  const catatan = await prisma.adminNotification.create({
    data: {
      // Sama dengan bawaannya di jadwal sungguhan; ditulis terang supaya
      // penjagaan "sekali sehari" di atas membaca jam yang sama dengan yang
      // ditulis di sini.
      createdAt: sekarang,
      category: KATEGORI_GIRO_JATUH_TEMPO,
      severity: r.LEWAT.jumlah > 0 ? 'WARNING' : 'INFO',
      title: `${jumlah} giro perlu disetor · ${formatIDR(nilai)}`,
      message:
        `${bagian.join('; ')}. Setorkan ke bank, lalu tandai cair atau ditolak di Daftar giro — ` +
        'piutangnya belum berkurang sampai giro dinyatakan cair.' +
        (kedaluwarsa > 0
          ? ` ${kedaluwarsa} di antaranya sudah lewat masa berlaku 70 hari: minta toko mengganti bilyetnya.`
          : ''),
      metadata: {
        hari,
        jumlah,
        nilai,
        lewat: r.LEWAT.jumlah,
        hariIni: r.HARI_INI.jumlah,
        href: '/backoffice/pelunasan/giro',
      },
    },
  });

  void fanOutAdminNotification(catatan);
  return { dibuat: true, id: catatan.id, jumlah, nilai };
}

