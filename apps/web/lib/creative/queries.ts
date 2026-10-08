import { prisma } from '@elorae/db';
import { cariTeks } from "@/lib/db/cari-teks";
import { nilaiBebanDiakui, tierKol, type StatusKonten, type Tier } from './aturan';
import { kontenTelat } from './rencana-konten';
import { hariIniWib } from '@/lib/tanggal-isian';
import { isJalurKeluar, tahapAktif, type Tahap } from './tahap';

/**
 * Kueri creative marketing.
 *
 * Tier dan keterlambatan DIHITUNG di sini dari sumbernya, tidak disimpan. Angka
 * turunan yang disimpan akan basi tanpa ada yang memperbaruinya — pola yang
 * sama dengan sisa piutang dan stok titipan di modul sebelah.
 */

const angka = (v: unknown): number => Number(v ?? 0);

export type BarisKol = {
  id: string;
  name: string;
  niche: string | null;
  city: string | null;
  phone: string | null;
  isActive: boolean;
  rateCard: number | null;
  tier: Tier;
  akun: { platform: string; handle: string; followers: number; url: string | null }[];
  jumlahBrief: number;
  /** "Jangan diajak lagi" — kolaborasi baru dengannya ditolak (`kolDiblokir`). */
  diblokir: boolean;
  alasanBlokir: string | null;
};

export async function daftarKol(opts?: { hanyaAktif?: boolean; cari?: string }): Promise<BarisKol[]> {
  const rows = await prisma.kol.findMany({
    where: {
      ...(opts?.hanyaAktif ? { isActive: true } : {}),
      ...(opts?.cari?.trim()
        ? {
            OR: [
              { name: cariTeks(opts.cari.trim()) },
              { niche: cariTeks(opts.cari.trim()) },
              { accounts: { some: { handle: cariTeks(opts.cari.trim()) } } },
            ],
          }
        : {}),
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      niche: true,
      city: true,
      phone: true,
      isActive: true,
      rateCard: true,
      blockedAt: true,
      blockReason: true,
      accounts: { select: { platform: true, handle: true, followers: true, url: true } },
      _count: { select: { briefs: true } },
    },
  });

  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    niche: k.niche,
    city: k.city,
    phone: k.phone,
    isActive: k.isActive,
    rateCard: k.rateCard ? angka(k.rateCard) : null,
    tier: tierKol(k.accounts.map((a) => a.followers)),
    akun: k.accounts.map((a) => ({ ...a, platform: String(a.platform) })),
    jumlahBrief: k._count.briefs,
    diblokir: k.blockedAt !== null,
    alasanBlokir: k.blockReason,
  }));
}

export type BarisBrief = {
  id: string;
  docNo: string;
  kolNama: string;
  campaignId: string | null;
  campaignNama: string | null;
  tahap: Tahap;
  fee: number;
  /**
   * Fee yang BOLEH dihitung sebagai beban. Nol selama kontennya belum tayang;
   * sesudahnya Σ BRUTO termin yang tidak batal (termasuk PPh gross-up — sama
   * dengan jurnal `KOL_FEE`), atau fee bila belum ada termin.
   */
  bebanDiakui: number;
  dueDate: string | null;
  jumlahDeliverable: number;
  /** Jumlah barang dalam RENCANA sampel (bukan yang sudah dikirim). */
  jumlahBarang: number;
  /** Ada pengiriman sampel yang stoknya sudah keluar. */
  barangSudahBerangkat: boolean;
};

/**
 * Daftar kolaborasi ringkas (tabel `KolBrief`). Dipakai pemilih "kaitkan ke
 * kolaborasi" di rencana konten dan angka ringkas; daftar Kolaborasi lengkap
 * punya kuerinya sendiri.
 */
export async function daftarBrief(opts?: { tahap?: Tahap; kolId?: string }): Promise<BarisBrief[]> {
  const rows = await prisma.kolBrief.findMany({
    where: {
      ...(opts?.tahap ? { tahap: opts.tahap } : {}),
      ...(opts?.kolId ? { kolId: opts.kolId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      docNo: true,
      tahap: true,
      fee: true,
      dueDate: true,
      stockIssuedAt: true,
      campaignId: true,
      campaign: { select: { name: true } },
      kol: { select: { name: true } },
      deliverables: { select: { qty: true } },
      items: { select: { qty: true } },
      shipments: { where: { stockIssuedAt: { not: null } }, select: { id: true }, take: 1 },
      terms: { where: { status: { not: 'BATAL' } }, select: { bruto: true } },
    },
  });

  return rows.map((b) => {
    const tahap = b.tahap as Tahap;
    const fee = angka(b.fee);
    // Beban dibaca dari termin (bruto, seperti jurnal), bukan dari kolom fee yang
    // untuk gross-up adalah neto.
    const brutoTermin = b.terms.length ? Math.round(b.terms.reduce((s, t) => s + Math.round(angka(t.bruto) * 100), 0)) / 100 : fee;
    return {
      id: b.id,
      docNo: b.docNo,
      kolNama: b.kol.name,
      campaignId: b.campaignId,
      campaignNama: b.campaign?.name ?? null,
      tahap,
      fee,
      // Aturan 1 diterapkan di kueri, bukan di layar: setiap pembaca daftar ini
      // mendapat angka yang sama tanpa harus mengingat aturannya.
      bebanDiakui: nilaiBebanDiakui(tahap, brutoTermin),
      dueDate: b.dueDate?.toISOString() ?? null,
      jumlahDeliverable: b.deliverables.reduce((s, d) => s + d.qty, 0),
      jumlahBarang: b.items.reduce((s, i) => s + i.qty, 0),
      barangSudahBerangkat: b.stockIssuedAt !== null || b.shipments.length > 0,
    };
  });
}

export type BarisKonten = {
  id: string;
  title: string;
  platform: string;
  format: string;
  status: StatusKonten;
  scheduledAt: string | null;
  publishedAt: string | null;
  postUrl: string | null;
  imageUrl: string | null;
  itemNama: string | null;
  assigneeNama: string | null;
  briefDocNo: string | null;
  briefId: string | null;
  caption: string | null;
  terlambat: boolean;
};

export async function daftarKonten(opts?: {
  status?: StatusKonten;
  platform?: string;
  dari?: Date;
  sampai?: Date;
}): Promise<BarisKonten[]> {
  const rows = await prisma.contentPlan.findMany({
    where: {
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.platform ? { platform: opts.platform as never } : {}),
      ...(opts?.dari || opts?.sampai
        ? {
            scheduledAt: {
              ...(opts.dari ? { gte: opts.dari } : {}),
              ...(opts.sampai ? { lte: opts.sampai } : {}),
            },
          }
        : {}),
    },
    // Yang belum berjadwal jatuh ke bawah, bukan hilang: `nulls: 'last'`.
    orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      platform: true,
      format: true,
      status: true,
      scheduledAt: true,
      publishedAt: true,
      postUrl: true,
      imageUrl: true,
      caption: true,
      briefId: true,
      item: { select: { nameId: true } },
      assignee: { select: { name: true } },
      brief: { select: { docNo: true } },
    },
  });

  // Lewat jadwal menurut HARI WIB (bug G): jadwal hari ini belum terlambat.
  const hariIni = hariIniWib();
  return rows.map((k) => ({
    id: k.id,
    title: k.title,
    platform: String(k.platform),
    format: String(k.format),
    status: k.status as StatusKonten,
    scheduledAt: k.scheduledAt?.toISOString() ?? null,
    publishedAt: k.publishedAt?.toISOString() ?? null,
    postUrl: k.postUrl,
    imageUrl: k.imageUrl,
    itemNama: k.item?.nameId ?? null,
    assigneeNama: k.assignee?.name ?? null,
    briefDocNo: k.brief?.docNo ?? null,
    briefId: k.briefId,
    caption: k.caption,
    terlambat: kontenTelat(k.status as StatusKonten, k.scheduledAt, hariIni),
  }));
}

export type RingkasanKreatif = {
  kontenTerjadwal: number;
  kontenTerlambat: number;
  /** Kolaborasi yang masih berjalan (bukan SELESAI, bukan jalur keluar). */
  briefBerjalan: number;
  /** Total fee yang SUDAH boleh dihitung sebagai beban — bukan yang dijanjikan. */
  bebanDiakui: number;
  /** Yang masih dijanjikan tapi belum tayang. Ditampilkan TERPISAH, tidak dijumlah. */
  feeBelumDiakui: number;
};

/**
 * Angka ringkas untuk kepala halaman.
 *
 * Beban yang diakui dan fee yang baru dijanjikan sengaja DIPISAH, tidak
 * dijumlahkan jadi satu "total anggaran". Menjumlahkannya membuat marketing
 * terbaca sudah menghabiskan uang yang belum keluar — dan itu persis kesalahan
 * yang Aturan 1 ada untuk mencegah.
 */
export async function ringkasKreatif(): Promise<RingkasanKreatif> {
  const [konten, brief] = await Promise.all([daftarKonten(), daftarBrief()]);
  return {
    kontenTerjadwal: konten.filter((k) => k.status === 'DIJADWALKAN').length,
    kontenTerlambat: konten.filter((k) => k.terlambat).length,
    briefBerjalan: brief.filter((b) => tahapAktif(b.tahap)).length,
    bebanDiakui: brief.reduce((s, b) => s + b.bebanDiakui, 0),
    // Kolaborasi yang keluar jalur tidak menjanjikan apa pun lagi.
    feeBelumDiakui: brief
      .filter((b) => !isJalurKeluar(b.tahap))
      // Yang sudah diakui keluar seluruhnya dari "dijanjikan" (beban memakai
      // bruto, fee memakai angka yang disepakati — keduanya tidak dikurangkan).
      .reduce((s, b) => s + (b.bebanDiakui > 0 ? 0 : b.fee), 0),
  };
}
