import { prisma } from '@elorae/db';
import { kontenTerlambat, tierKol, type StatusBrief, type StatusKonten, type Tier } from './aturan';

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
};

export async function daftarKol(opts?: { hanyaAktif?: boolean; cari?: string }): Promise<BarisKol[]> {
  const rows = await prisma.kol.findMany({
    where: {
      ...(opts?.hanyaAktif ? { isActive: true } : {}),
      ...(opts?.cari?.trim()
        ? {
            OR: [
              { name: { contains: opts.cari.trim(), mode: 'insensitive' as const } },
              { niche: { contains: opts.cari.trim(), mode: 'insensitive' as const } },
              { accounts: { some: { handle: { contains: opts.cari.trim(), mode: 'insensitive' as const } } } },
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
  }));
}

export type BarisBrief = {
  id: string;
  docNo: string;
  kolNama: string;
  campaign: string;
  status: StatusBrief;
  fee: number;
  /** Fee yang BOLEH dihitung sebagai beban. Nol selama kontennya belum tayang. */
  bebanDiakui: number;
  dueDate: string | null;
  jumlahDeliverable: number;
  jumlahBarang: number;
  barangSudahBerangkat: boolean;
};

export async function daftarBrief(opts?: { status?: StatusBrief; kolId?: string }): Promise<BarisBrief[]> {
  const rows = await prisma.kolBrief.findMany({
    where: {
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.kolId ? { kolId: opts.kolId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      docNo: true,
      campaign: true,
      status: true,
      fee: true,
      dueDate: true,
      stockIssuedAt: true,
      kol: { select: { name: true } },
      deliverables: { select: { qty: true } },
      items: { select: { qty: true } },
    },
  });

  return rows.map((b) => {
    const status = b.status as StatusBrief;
    const fee = angka(b.fee);
    return {
      id: b.id,
      docNo: b.docNo,
      kolNama: b.kol.name,
      campaign: b.campaign,
      status,
      fee,
      // Aturan 1 diterapkan di kueri, bukan di layar: setiap pembaca daftar ini
      // mendapat angka yang sama tanpa harus mengingat aturannya.
      bebanDiakui: status === 'TAYANG' || status === 'SELESAI' ? fee : 0,
      dueDate: b.dueDate?.toISOString() ?? null,
      jumlahDeliverable: b.deliverables.reduce((s, d) => s + d.qty, 0),
      jumlahBarang: b.items.reduce((s, i) => s + i.qty, 0),
      barangSudahBerangkat: b.stockIssuedAt !== null,
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
  itemNama: string | null;
  assigneeNama: string | null;
  briefDocNo: string | null;
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
      item: { select: { nameId: true } },
      assignee: { select: { name: true } },
      brief: { select: { docNo: true } },
    },
  });

  const sekarang = new Date();
  return rows.map((k) => ({
    id: k.id,
    title: k.title,
    platform: String(k.platform),
    format: String(k.format),
    status: k.status as StatusKonten,
    scheduledAt: k.scheduledAt?.toISOString() ?? null,
    publishedAt: k.publishedAt?.toISOString() ?? null,
    postUrl: k.postUrl,
    itemNama: k.item?.nameId ?? null,
    assigneeNama: k.assignee?.name ?? null,
    briefDocNo: k.brief?.docNo ?? null,
    terlambat: kontenTerlambat(k.status as StatusKonten, k.scheduledAt, sekarang),
  }));
}

export type RingkasanKreatif = {
  kontenTerjadwal: number;
  kontenTerlambat: number;
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
  const berjalan: StatusBrief[] = ['DIKIRIM', 'DISETUJUI', 'KONTEN_DITERIMA'];
  return {
    kontenTerjadwal: konten.filter((k) => k.status === 'DIJADWALKAN').length,
    kontenTerlambat: konten.filter((k) => k.terlambat).length,
    briefBerjalan: brief.filter((b) => berjalan.includes(b.status)).length,
    bebanDiakui: brief.reduce((s, b) => s + b.bebanDiakui, 0),
    feeBelumDiakui: brief
      .filter((b) => b.status !== 'BATAL')
      .reduce((s, b) => s + (b.fee - b.bebanDiakui), 0),
  };
}
