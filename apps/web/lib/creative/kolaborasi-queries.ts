import { prisma, type Prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { PERMISSIONS } from "@/lib/rbac";
import type { AmbangKreatif } from "./ambang";
import { angkaKolaborasi, jumlahAngkaKolaborasi, type AngkaKolaborasi } from "./angka-queries";
import type { Platform } from "./aturan";
import {
  BATAS_PAPAN,
  TAHAP_KELUAR,
  UKURAN_HALAMAN_KOLABORASI,
  type ParamKolaborasi,
} from "./kolaborasi-param";
import {
  JALUR_KELUAR,
  SEMUA_TAHAP,
  TAHAP_BERJALAN,
  tahapAktif,
  type JenisKerjaSama,
  type StatusBayar,
  type StatusDraf,
  type Tahap,
} from "./tahap";
import { tenggatKolaborasi, umurHari, type DataTenggat, type Tenggat } from "./tenggat";

/*
 * Kueri daftar, papan, dan rincian Kolaborasi — KHUSUS SERVER. Klien hanya
 * `import type`. Angka hasil (views, GMV, biaya, ROAS) selalu dari
 * `angkaKolaborasi`; tenggat dari `tenggatKolaborasi` + ambang Pengaturan.
 */

const angka = (v: unknown): number => Number(v ?? 0);
const hari = (d: Date | null | undefined): string | null => (d ? formatDateOnlyJakarta(d) : null);

/** Saringan dasar (tanpa tahap): angka di chip dihitung dari sini, jadi selalu sama dengan daftarnya. */
export function whereDasarKolaborasi(p: Pick<ParamKolaborasi, "campaign" | "platform" | "pic" | "cari">): Prisma.KolBriefWhereInput {
  const dan: Prisma.KolBriefWhereInput[] = [];
  if (p.campaign) dan.push({ campaignId: p.campaign });
  if (p.platform) dan.push({ kol: { accounts: { some: { platform: p.platform } } } });
  if (p.pic) dan.push({ picId: p.pic });
  const q = p.cari.trim();
  if (q) {
    const handle = q.replace(/^@/, "");
    dan.push({
      OR: [
        { docNo: cariTeks(q) },
        { kol: { name: cariTeks(q) } },
        { kol: { accounts: { some: { handle: cariTeks(handle) } } } },
      ],
    });
  }
  return dan.length ? { AND: dan } : {};
}

function whereTahap(t: ParamKolaborasi["tahap"]): Prisma.KolBriefWhereInput {
  if (!t) return {};
  if (t === TAHAP_KELUAR) return { tahap: { in: [...JALUR_KELUAR] } };
  return { tahap: t };
}

const pilihBaris = {
  id: true,
  docNo: true,
  tahap: true,
  tahapAt: true,
  dealAt: true,
  lastContactAt: true,
  liveAt: true,
  fee: true,
  payStatus: true,
  jenis: true,
  kol: {
    select: {
      id: true,
      name: true,
      city: true,
      blockedAt: true,
      accounts: { select: { platform: true, handle: true, followers: true }, orderBy: { followers: "desc" as const } },
    },
  },
  campaign: { select: { id: true, name: true } },
  pic: { select: { id: true, name: true, email: true } },
  shipments: {
    select: { id: true, sentAt: true, receivedAt: true, trackingNo: true, courier: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
  kolContents: {
    select: {
      id: true,
      link: true,
      liveAt: true,
      draftStatus: true,
      draftAt: true,
      metrics: { select: { recordedAt: true }, orderBy: { recordedAt: "desc" as const }, take: 1 },
    },
  },
} satisfies Prisma.KolBriefSelect;

type BarisDb = Prisma.KolBriefGetPayload<{ select: typeof pilihBaris }>;

function dataTenggat(b: BarisDb): DataTenggat {
  return {
    tahap: b.tahap as Tahap,
    tahapAt: formatDateOnlyJakarta(b.tahapAt),
    dealAt: hari(b.dealAt),
    lastContactAt: hari(b.lastContactAt),
    liveAt: hari(b.liveAt),
    fee: angka(b.fee),
    payStatus: b.payStatus as StatusBayar,
    pengiriman: b.shipments.map((s) => ({
      id: s.id,
      sentAt: hari(s.sentAt),
      receivedAt: hari(s.receivedAt),
      trackingNo: s.trackingNo,
    })),
    konten: b.kolContents.map((k) => ({
      id: k.id,
      link: k.link,
      liveAt: hari(k.liveAt),
      draftStatus: k.draftStatus as StatusDraf | null,
      draftAt: hari(k.draftAt),
      angkaTerakhirHari: k.metrics[0] ? formatDateOnlyJakarta(k.metrics[0].recordedAt) : null,
    })),
  };
}

export type KolRingkas = {
  id: string;
  name: string;
  handle: string | null;
  platform: Platform | null;
  city: string | null;
  diblokir: boolean;
};

export type BarisKolaborasi = {
  id: string;
  docNo: string;
  tahap: Tahap;
  tahapAt: string;
  /** Hari sejak masuk tahap ini (WIB). */
  umurHari: number;
  /** Lebih lama dari ambang "sorot merah" dan masih berjalan. */
  umurMerah: boolean;
  kol: KolRingkas;
  campaign: { id: string; name: string } | null;
  pic: { id: string; name: string } | null;
  jenis: JenisKerjaSama;
  fee: number;
  /** Tenggat berikutnya (paling awal); yang lewat selalu lebih dulu. */
  tenggat: Tenggat | null;
  jumlahTenggatLewat: number;
  resi: { courier: string | null; trackingNo: string } | null;
  views: number;
  gmv: number;
};

function keBaris(b: BarisDb, a: AngkaKolaborasi | undefined, hariIni: string, ambang: AmbangKreatif): BarisKolaborasi {
  const tahap = b.tahap as Tahap;
  const umur = umurHari(formatDateOnlyJakarta(b.tahapAt), hariIni);
  const tenggat = tenggatKolaborasi(dataTenggat(b), ambang, hariIni);
  const akun = b.kol.accounts[0];
  const resi = b.shipments.find((s) => s.trackingNo?.trim());
  return {
    id: b.id,
    docNo: b.docNo,
    tahap,
    tahapAt: b.tahapAt.toISOString(),
    umurHari: umur,
    umurMerah: tahapAktif(tahap) && umur > ambang.umurTahapMerahHari,
    kol: {
      id: b.kol.id,
      name: b.kol.name,
      handle: akun?.handle ?? null,
      platform: (akun?.platform as Platform | undefined) ?? null,
      city: b.kol.city,
      diblokir: b.kol.blockedAt !== null,
    },
    campaign: b.campaign,
    pic: b.pic ? { id: b.pic.id, name: b.pic.name || b.pic.email } : null,
    jenis: b.jenis as JenisKerjaSama,
    fee: angka(b.fee),
    tenggat: tenggat[0] ?? null,
    jumlahTenggatLewat: tenggat.filter((t) => t.lewat).length,
    resi: resi ? { courier: resi.courier, trackingNo: resi.trackingNo!.trim() } : null,
    views: a?.angka.views ?? 0,
    gmv: a?.gmv ?? 0,
  };
}

export type JumlahTahap = {
  semua: number;
  keluar: number;
  perTahap: Record<Tahap, number>;
};

export type DaftarKolaborasi = {
  baris: BarisKolaborasi[];
  /** Jumlah baris yang cocok dengan saringan + tahap terpilih (sebelum dipotong halaman/papan). */
  total: number;
  halaman: number;
  ukuran: number;
  jumlah: JumlahTahap;
  /** Papan memotong di `BATAS_PAPAN`; true bila ada kartu yang tidak dimuat. */
  terpotong: boolean;
};

async function hitungPerTahap(dasar: Prisma.KolBriefWhereInput): Promise<JumlahTahap> {
  const grup = await prisma.kolBrief.groupBy({ by: ["tahap"], where: dasar, _count: { _all: true } });
  const perTahap = Object.fromEntries(SEMUA_TAHAP.map((t) => [t, 0])) as Record<Tahap, number>;
  for (const g of grup) perTahap[g.tahap as Tahap] = g._count._all;
  return {
    semua: SEMUA_TAHAP.reduce((s, t) => s + perTahap[t], 0),
    keluar: JALUR_KELUAR.reduce((s, t) => s + perTahap[t], 0),
    perTahap,
  };
}

/**
 * Daftar (tabel) atau papan kolaborasi menurut alamat.
 *
 * Tabel: urut terakhir diubah, 25 per halaman, disaring tahap. Papan: semua
 * kolaborasi yang masih berjalan (tanpa saringan tahap), yang paling lama di
 * tahapnya di atas, paling banyak `BATAS_PAPAN` kartu.
 */
export async function daftarKolaborasi(
  p: ParamKolaborasi,
  opsi: { hariIni: string; ambang: AmbangKreatif },
): Promise<DaftarKolaborasi> {
  const dasar = whereDasarKolaborasi(p);
  const papan = p.tampilan === "papan";
  const where: Prisma.KolBriefWhereInput = papan
    ? { AND: [dasar, { tahap: { in: [...TAHAP_BERJALAN] } }] }
    : { AND: [dasar, whereTahap(p.tahap)] };

  const [jumlah, total] = await Promise.all([hitungPerTahap(dasar), prisma.kolBrief.count({ where })]);
  const ukuran = papan ? BATAS_PAPAN : UKURAN_HALAMAN_KOLABORASI;
  const halamanMaks = Math.max(1, Math.ceil(total / ukuran));
  const halaman = papan ? 1 : Math.min(Math.max(1, p.halaman), halamanMaks);

  const rows = await prisma.kolBrief.findMany({
    where,
    orderBy: papan ? [{ tahapAt: "asc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (halaman - 1) * ukuran,
    take: ukuran,
    select: pilihBaris,
  });
  const a = await angkaKolaborasi(rows.map((r) => r.id));
  return {
    baris: rows.map((r) => keBaris(r, a.get(r.id), opsi.hariIni, opsi.ambang)),
    total,
    halaman,
    ukuran,
    jumlah,
    terpotong: papan && total > rows.length,
  };
}

/* ─────────────────────── Ringkasan riwayat KOL ─────────────────────── */

export type RiwayatKol = {
  kol: {
    id: string;
    name: string;
    diblokir: boolean;
    blockReason: string | null;
    rateCard: number | null;
    rateNote: string | null;
  };
  jumlahKolaborasi: number;
  jumlahKonten: number;
  views: number;
  gmv: number;
  roas: number | null;
  feeTerakhir: { fee: number; tanggal: string } | null;
  /** Hari WIB kolaborasi terakhir dibuat. */
  terakhir: string | null;
  ghosting: number;
  ditolak: number;
};

/**
 * Ringkasan riwayat satu KOL, tepat saat memutuskan mengajaknya lagi
 * (KOL Manager §3.11): berapa kali kerja sama, hasilnya, fee terakhir, dan
 * berapa kali menghilang atau menolak.
 */
export async function ringkasRiwayatKol(kolId: string): Promise<RiwayatKol | null> {
  const kol = await prisma.kol.findUnique({
    where: { id: kolId },
    select: { id: true, name: true, blockedAt: true, blockReason: true, rateCard: true, rateNote: true },
  });
  if (!kol) return null;
  const kolab = await prisma.kolBrief.findMany({
    where: { kolId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, tahap: true, fee: true, createdAt: true, dealAt: true },
  });
  const a = await angkaKolaborasi(kolab.map((k) => k.id));
  const total = jumlahAngkaKolaborasi(a.values());
  const berfee = kolab.find((k) => angka(k.fee) > 0);
  return {
    kol: {
      id: kol.id,
      name: kol.name,
      diblokir: kol.blockedAt !== null,
      blockReason: kol.blockReason,
      rateCard: kol.rateCard == null ? null : angka(kol.rateCard),
      rateNote: kol.rateNote,
    },
    jumlahKolaborasi: kolab.length,
    jumlahKonten: total.jumlahKonten,
    views: total.angka.views,
    gmv: total.gmv,
    roas: total.roas,
    feeTerakhir: berfee ? { fee: angka(berfee.fee), tanggal: formatDateOnlyJakarta(berfee.dealAt ?? berfee.createdAt) } : null,
    terakhir: kolab[0] ? formatDateOnlyJakarta(kolab[0].createdAt) : null,
    ghosting: kolab.filter((k) => k.tahap === "GHOSTING").length,
    ditolak: kolab.filter((k) => k.tahap === "DITOLAK").length,
  };
}

/* ─────────────────────── Pencarian & pilihan ─────────────────────── */

export type HasilCariKol = {
  id: string;
  name: string;
  handle: string | null;
  platform: Platform | null;
  followers: number;
  city: string | null;
  diblokir: boolean;
};

/** Autocomplete KOL (minimal 2 huruf, 12 hasil): nama atau username di platform mana pun. */
export async function cariKolUntukKolaborasi(q: string): Promise<HasilCariKol[]> {
  const kata = q.trim();
  if (kata.length < 2) return [];
  const handle = kata.replace(/^@/, "");
  const rows = await prisma.kol.findMany({
    where: { OR: [{ name: cariTeks(kata) }, { accounts: { some: { handle: cariTeks(handle) } } }] },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 12,
    select: {
      id: true,
      name: true,
      city: true,
      blockedAt: true,
      accounts: { select: { platform: true, handle: true, followers: true }, orderBy: { followers: "desc" } },
    },
  });
  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    handle: k.accounts[0]?.handle ?? null,
    platform: (k.accounts[0]?.platform as Platform | undefined) ?? null,
    followers: k.accounts[0]?.followers ?? 0,
    city: k.city,
    diblokir: k.blockedAt !== null,
  }));
}

export type PilihanPengguna = { id: string; name: string };

/** Calon PIC: pengguna yang bisa membuka Kreatif (peran sistem atau pemegang izin creative). */
export async function pilihanPic(): Promise<PilihanPengguna[]> {
  const izin = await prisma.permission.findMany({
    where: { code: { in: [PERMISSIONS.CREATIVE_VIEW, PERMISSIONS.CREATIVE_MANAGE] } },
    select: { id: true },
  });
  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { roleDefinition: { isSystem: true } },
        ...(izin.length ? [{ roleDefinition: { permissions: { some: { permissionId: { in: izin.map((i) => i.id) } } } } }] : []),
      ],
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true },
  });
  return rows.map((u) => ({ id: u.id, name: u.name || u.email }));
}

/* ─────────────────────────── Rincian ─────────────────────────── */

export type DetailKolaborasi = BarisKolaborasi & {
  commissionPct: number | null;
  boostCost: number;
  payStatus: StatusBayar;
  paidAmount: number;
  paidAt: string | null;
  plannedLiveAt: string | null;
  outreachAt: string | null;
  dealAt: string | null;
  lastContactAt: string | null;
  liveAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  briefText: string | null;
  doList: string | null;
  dontList: string | null;
  kolLengkap: {
    phone: string | null;
    waNormal: string | null;
    recipientName: string | null;
    address: string | null;
    province: string | null;
    postalCode: string | null;
    blockReason: string | null;
  };
  campaignLengkap: { id: string; name: string; brief: string | null; arsip: boolean } | null;
  deliverables: { id: string; platform: Platform; format: string; qty: number; dueDate: string | null }[];
  rencanaSampel: { id: string; itemId: string; itemName: string; variantSku: string | null; qty: number }[];
  angka: AngkaKolaborasi | null;
  semuaTenggat: Tenggat[];
  jumlah: { pengiriman: number; konten: number; penjualan: number; catatan: number };
};

export async function detailKolaborasi(
  id: string,
  opsi: { hariIni: string; ambang: AmbangKreatif },
): Promise<DetailKolaborasi | null> {
  const b = await prisma.kolBrief.findUnique({
    where: { id },
    select: {
      ...pilihBaris,
      commissionPct: true,
      boostCost: true,
      paidAmount: true,
      paidAt: true,
      plannedLiveAt: true,
      outreachAt: true,
      cancelReason: true,
      createdAt: true,
      briefText: true,
      doList: true,
      dontList: true,
      createdBy: { select: { name: true, email: true } },
      campaign: { select: { id: true, name: true, brief: true, archivedAt: true } },
      kol: {
        select: {
          ...pilihBaris.kol.select,
          phone: true,
          waNormal: true,
          recipientName: true,
          address: true,
          province: true,
          postalCode: true,
          blockReason: true,
        },
      },
      deliverables: { select: { id: true, platform: true, format: true, qty: true, dueDate: true } },
      items: { select: { id: true, itemId: true, itemName: true, variantSku: true, qty: true } },
      _count: { select: { shipments: true, kolContents: true, sales: true, notes: true } },
    },
  });
  if (!b) return null;
  const a = (await angkaKolaborasi([b.id])).get(b.id);
  const dasar = keBaris(
    { ...b, campaign: b.campaign ? { id: b.campaign.id, name: b.campaign.name } : null } as unknown as BarisDb,
    a,
    opsi.hariIni,
    opsi.ambang,
  );
  return {
    ...dasar,
    commissionPct: b.commissionPct == null ? null : angka(b.commissionPct),
    boostCost: angka(b.boostCost),
    payStatus: b.payStatus as StatusBayar,
    paidAmount: angka(b.paidAmount),
    paidAt: hari(b.paidAt),
    plannedLiveAt: hari(b.plannedLiveAt),
    outreachAt: hari(b.outreachAt),
    dealAt: hari(b.dealAt),
    lastContactAt: hari(b.lastContactAt),
    liveAt: hari(b.liveAt),
    cancelReason: b.cancelReason,
    createdAt: b.createdAt.toISOString(),
    createdBy: b.createdBy ? b.createdBy.name || b.createdBy.email : null,
    briefText: b.briefText,
    doList: b.doList,
    dontList: b.dontList,
    kolLengkap: {
      phone: b.kol.phone,
      waNormal: b.kol.waNormal,
      recipientName: b.kol.recipientName,
      address: b.kol.address,
      province: b.kol.province,
      postalCode: b.kol.postalCode,
      blockReason: b.kol.blockReason,
    },
    campaignLengkap: b.campaign
      ? { id: b.campaign.id, name: b.campaign.name, brief: b.campaign.brief, arsip: b.campaign.archivedAt !== null }
      : null,
    deliverables: b.deliverables.map((d) => ({
      id: d.id,
      platform: d.platform as Platform,
      format: String(d.format),
      qty: d.qty,
      dueDate: hari(d.dueDate),
    })),
    rencanaSampel: b.items,
    angka: a ?? null,
    semuaTenggat: tenggatKolaborasi(dataTenggat(b as unknown as BarisDb), opsi.ambang, opsi.hariIni),
    jumlah: {
      pengiriman: b._count.shipments,
      konten: b._count.kolContents,
      penjualan: b._count.sales,
      catatan: b._count.notes,
    },
  };
}
