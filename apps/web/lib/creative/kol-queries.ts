import { prisma, type Prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { feeBruto } from "./angka-konten";
import { angkaKolaborasi, jumlahAngkaKolaborasi, type AngkaKolaborasi } from "./angka-queries";
import { SEMUA_PLATFORM, tierKol, type Platform, type Tier } from "./aturan";
import { cariKembar, kelompokKembar, normalisasiHandle, type SebabKembar } from "./kembar";
import {
  BATAS_KELOMPOK_KEMBAR,
  bacaLabel,
  bacaProfilUkuran,
  hitungKolaborasiKol,
  kembarDalamTempelan,
  persenTepatWaktu,
  polaCariWa,
  punyaLabel,
  type BarisTempel,
  type HitunganKolaborasiKol,
  type ProfilUkuran,
} from "./kol-aturan";
import type { SaringKol } from "./kol-saring";
import type { JenisKerjaSama, StatusDraf, Tahap } from "./tahap";

/*
 * Kueri database KOL (2026-10-07). Klien hanya boleh `import type` dari sini.
 *
 * Views, GMV, biaya, dan ROAS SELALU dari `angkaKolaborasi` — satu-satunya
 * tempat angka itu dihitung. Tier, pengikut terbanyak, dan tahap kolaborasi
 * terakhir dihitung saat dibaca, tidak disimpan.
 *
 * Saringan tier/label/tahap terakhir dan urutan pengikut/ER/GMV berasal dari
 * nilai turunan, jadi daftar dibaca ringan seluruhnya, disaring dan diurut di
 * sini, lalu hanya halaman yang diminta yang dihitung angkanya (kecuali urut
 * GMV, yang memang butuh angka semua KOL yang lolos saringan).
 */

export type AkunRingkas = { id: string; platform: Platform; handle: string; followers: number; url: string | null };

export type BarisDaftarKol = {
  id: string;
  nama: string;
  akunUtama: AkunRingkas | null;
  akun: AkunRingkas[];
  tier: Tier;
  pengikut: number;
  er: number | null;
  niche: string | null;
  kota: string | null;
  label: string[];
  diblokir: boolean;
  alasanBlokir: string | null;
  tahapTerakhir: Tahap | null;
  kolaborasiTerakhirId: string | null;
  jumlahKolaborasi: number;
  views: number;
  gmv: number;
  kontakTerakhir: string | null;
  adaWa: boolean;
  dibuat: string;
};

export type HasilDaftarKol = { baris: BarisDaftarKol[]; total: number; halaman: number; ukuran: number };

const urutPlatform = (p: Platform) => SEMUA_PLATFORM.indexOf(p);

/** Akun dengan pengikut terbanyak; seri → urutan platform. */
function akunTerbesar<T extends { platform: Platform; followers: number }>(akun: readonly T[]): T | null {
  let hasil: T | null = null;
  for (const a of akun) {
    if (!hasil || a.followers > hasil.followers || (a.followers === hasil.followers && urutPlatform(a.platform) < urutPlatform(hasil.platform))) {
      hasil = a;
    }
  }
  return hasil;
}

function urutkanAkun<T extends { platform: Platform; followers: number }>(akun: readonly T[]): T[] {
  return [...akun].sort((a, b) => b.followers - a.followers || urutPlatform(a.platform) - urutPlatform(b.platform));
}

const angkaAtauNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function syaratCari(q: string): Prisma.KolWhereInput {
  const handle = normalisasiHandle(q) ?? q;
  const atau: Prisma.KolWhereInput[] = [
    { name: cariTeks(q) },
    { recipientName: cariTeks(q) },
    { niche: cariTeks(q) },
    { city: cariTeks(q) },
    { phone: cariTeks(q) },
    { accounts: { some: { handle: cariTeks(handle) } } },
  ];
  const wa = polaCariWa(q);
  if (wa) atau.push({ waNormal: { contains: wa } });
  return { OR: atau };
}

export async function daftarKolHalaman(s: SaringKol): Promise<HasilDaftarKol> {
  const dan: Prisma.KolWhereInput[] = [];
  const q = s.cari.trim();
  if (q) dan.push(syaratCari(q));
  if (s.platform) dan.push({ accounts: { some: { platform: s.platform } } });
  if (s.status === "DIBLOKIR") dan.push({ blockedAt: { not: null } });
  if (s.status === "BELUM") dan.push({ briefs: { none: {} } });
  // Saringan kasar di basis data; kecocokan label yang persis diputuskan di bawah.
  if (s.label.trim()) dan.push({ label: cariTeks(s.label.trim()) });

  const rows = await prisma.kol.findMany({
    where: dan.length ? { AND: dan } : {},
    select: {
      id: true,
      name: true,
      niche: true,
      city: true,
      label: true,
      phone: true,
      waNormal: true,
      blockedAt: true,
      blockReason: true,
      engagementRate: true,
      lastContactAt: true,
      createdAt: true,
      accounts: { select: { id: true, platform: true, handle: true, followers: true, url: true } },
      briefs: { select: { id: true, tahap: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });

  type Antara = Omit<BarisDaftarKol, "views" | "gmv"> & { _kolabIds: string[]; _dibuat: number; _kontak: number | null };
  let daftar: Antara[] = rows.map((k) => {
    const akun = urutkanAkun(k.accounts.map((a) => ({ ...a, platform: a.platform as Platform })));
    const utama = akunTerbesar(akun);
    const terakhir = k.briefs[0];
    return {
      id: k.id,
      nama: k.name,
      akunUtama: utama,
      akun,
      tier: tierKol(akun.map((a) => a.followers)),
      pengikut: utama?.followers ?? 0,
      er: angkaAtauNull(k.engagementRate),
      niche: k.niche,
      kota: k.city,
      label: bacaLabel(k.label),
      diblokir: k.blockedAt !== null,
      alasanBlokir: k.blockReason,
      tahapTerakhir: (terakhir?.tahap as Tahap | undefined) ?? null,
      kolaborasiTerakhirId: terakhir?.id ?? null,
      jumlahKolaborasi: k.briefs.length,
      kontakTerakhir: k.lastContactAt?.toISOString() ?? null,
      adaWa: Boolean(k.waNormal),
      dibuat: k.createdAt.toISOString(),
      _kolabIds: k.briefs.map((b) => b.id),
      _dibuat: k.createdAt.getTime(),
      _kontak: k.lastContactAt?.getTime() ?? null,
    };
  });

  if (s.tier) daftar = daftar.filter((k) => k.tier === s.tier);
  if (s.label.trim()) daftar = daftar.filter((k) => punyaLabel(k.label.join(","), s.label));
  if (s.status && s.status !== "BELUM" && s.status !== "DIBLOKIR") daftar = daftar.filter((k) => k.tahapTerakhir === s.status);

  const perKol = async (baris: readonly Antara[]): Promise<Map<string, AngkaKolaborasi>> => {
    const angka = await angkaKolaborasi(baris.flatMap((k) => k._kolabIds));
    return new Map(
      baris.map((k) => [k.id, jumlahAngkaKolaborasi(k._kolabIds.map((id) => angka.get(id)).filter((a): a is AngkaKolaborasi => Boolean(a)))]),
    );
  };

  let angkaKol: Map<string, AngkaKolaborasi> | null = null;
  const seri = (a: Antara, b: Antara) => b._dibuat - a._dibuat || a.id.localeCompare(b.id);
  const nullDiBelakang = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a);
  switch (s.urut) {
    case "nama":
      daftar.sort((a, b) => a.nama.localeCompare(b.nama, "id", { sensitivity: "base" }) || a.id.localeCompare(b.id));
      break;
    case "pengikut":
      daftar.sort((a, b) => b.pengikut - a.pengikut || seri(a, b));
      break;
    case "er":
      daftar.sort((a, b) => nullDiBelakang(a.er, b.er) || seri(a, b));
      break;
    case "kontak":
      daftar.sort((a, b) => nullDiBelakang(a._kontak, b._kontak) || seri(a, b));
      break;
    case "gmv": {
      angkaKol = await perKol(daftar);
      const g = (k: Antara) => angkaKol!.get(k.id)?.gmv ?? 0;
      daftar.sort((a, b) => g(b) - g(a) || seri(a, b));
      break;
    }
    default:
      daftar.sort(seri);
  }

  const total = daftar.length;
  const halamanTerakhir = Math.max(1, Math.ceil(total / s.ukuran));
  const halaman = Math.min(Math.max(1, s.halaman), halamanTerakhir);
  const potong = daftar.slice((halaman - 1) * s.ukuran, halaman * s.ukuran);
  const angka = angkaKol ?? (await perKol(potong));

  return {
    total,
    halaman,
    ukuran: s.ukuran,
    baris: potong.map(({ _kolabIds, _dibuat, _kontak, ...k }) => {
      void _kolabIds;
      void _dibuat;
      void _kontak;
      const a = angka.get(k.id);
      return { ...k, views: a?.angka.views ?? 0, gmv: a?.gmv ?? 0 };
    }),
  };
}

/* ───────────────────────── pilihan saringan ───────────────────────── */

export type PilihanSaringKol = { label: string[]; niche: string[]; jumlahSemua: number };

/** Label dan niche yang sudah dipakai (untuk saringan dan isian datalist). */
export async function pilihanSaringKol(): Promise<PilihanSaringKol> {
  const rows = await prisma.kol.findMany({ select: { label: true, niche: true } });
  const unik = (daftar: string[]) => {
    const per = new Map<string, string>();
    for (const x of daftar) if (!per.has(x.toLowerCase())) per.set(x.toLowerCase(), x);
    return [...per.values()].sort((a, b) => a.localeCompare(b, "id", { sensitivity: "base" }));
  };
  return {
    label: unik(rows.flatMap((r) => bacaLabel(r.label))),
    niche: unik(rows.map((r) => r.niche?.trim() ?? "").filter(Boolean)),
    jumlahSemua: rows.length,
  };
}

/* ───────────────────────────── formulir ───────────────────────────── */

export type DataFormKol = {
  id: string;
  name: string;
  recipientName: string | null;
  niche: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  rateCard: number | null;
  rateNote: string | null;
  note: string | null;
  label: string;
  engagementRate: number | null;
  avgViews: number | null;
  ukuran: ProfilUkuran;
  akun: AkunRingkas[];
};

const PILIH_FORM = {
  id: true,
  name: true,
  recipientName: true,
  niche: true,
  city: true,
  province: true,
  postalCode: true,
  address: true,
  phone: true,
  email: true,
  rateCard: true,
  rateNote: true,
  note: true,
  label: true,
  engagementRate: true,
  avgViews: true,
  sizeProfile: true,
} as const;

type BarisForm = Prisma.KolGetPayload<{ select: typeof PILIH_FORM }>;

function keDataForm(k: BarisForm, akun: AkunRingkas[]): DataFormKol {
  return {
    id: k.id,
    name: k.name,
    recipientName: k.recipientName,
    niche: k.niche,
    city: k.city,
    province: k.province,
    postalCode: k.postalCode,
    address: k.address,
    phone: k.phone,
    email: k.email,
    rateCard: angkaAtauNull(k.rateCard),
    rateNote: k.rateNote,
    note: k.note,
    label: bacaLabel(k.label).join(", "),
    engagementRate: angkaAtauNull(k.engagementRate),
    avgViews: k.avgViews,
    ukuran: bacaProfilUkuran(k.sizeProfile),
    akun,
  };
}

export async function dataFormKol(id: string): Promise<DataFormKol | null> {
  const k = await prisma.kol.findUnique({
    where: { id },
    select: { ...PILIH_FORM, accounts: { select: { id: true, platform: true, handle: true, followers: true, url: true } } },
  });
  if (!k) return null;
  return keDataForm(k, urutkanAkun(k.accounts.map((a) => ({ ...a, platform: a.platform as Platform }))));
}

/* ───────────────────────────── profil ───────────────────────────── */

export type RiwayatPengikut = { followers: number; recordedAt: string; source: string | null };

export type KolaborasiProfil = {
  id: string;
  docNo: string;
  campaign: { id: string; nama: string } | null;
  tahap: Tahap;
  jenis: JenisKerjaSama;
  /** Fee yang disepakati (neto bila gross-up, bruto bila dipotong). */
  fee: number;
  /** Biaya bruto fee termasuk PPh gross-up; null bila sama dengan fee (dipotong / tanpa termin). */
  feeBruto: number | null;
  plannedLiveAt: string | null;
  liveAtPertama: string | null;
  dibuat: string;
  views: number;
  gmv: number;
  roas: number | null;
  biaya: number;
};

export type KontenProfil = {
  id: string;
  kolaborasiId: string;
  docNo: string;
  platform: Platform;
  format: string;
  link: string | null;
  draftLink: string | null;
  draftStatus: StatusDraf | null;
  liveAt: string | null;
  plannedAt: string | null;
  angka: { views: number; likes: number; comments: number; shares: number; saves: number; recordedAt: string } | null;
};

export type ProfilKol = {
  form: DataFormKol;
  nama: string;
  tier: Tier;
  pengikut: number;
  diblokir: boolean;
  blockedAt: string | null;
  alasanBlokir: string | null;
  kontakTerakhir: string | null;
  dibuat: string;
  label: string[];
  akun: (AkunRingkas & { riwayat: RiwayatPengikut[] })[];
  kolaborasi: KolaborasiProfil[];
  konten: KontenProfil[];
  ringkas: HitunganKolaborasiKol & {
    views: number;
    gmv: number;
    roas: number | null;
    biaya: number;
    feeTerakhir: number | null;
    tepatWaktu: { tepat: number; dinilai: number; persen: number | null };
  };
};

export async function profilKol(id: string): Promise<ProfilKol | null> {
  const k = await prisma.kol.findUnique({
    where: { id },
    select: {
      ...PILIH_FORM,
      blockedAt: true,
      blockReason: true,
      lastContactAt: true,
      createdAt: true,
      accounts: {
        select: {
          id: true,
          platform: true,
          handle: true,
          followers: true,
          url: true,
          snapshots: { select: { followers: true, recordedAt: true, source: true }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }], take: 120 },
        },
      },
      briefs: {
        select: {
          id: true,
          docNo: true,
          tahap: true,
          jenis: true,
          fee: true,
          plannedLiveAt: true,
          createdAt: true,
          campaign: { select: { id: true, name: true } },
          kolContents: {
            select: {
              id: true,
              platform: true,
              format: true,
              link: true,
              draftLink: true,
              draftStatus: true,
              liveAt: true,
              plannedAt: true,
              createdAt: true,
              metrics: {
                select: { views: true, likes: true, comments: true, shares: true, saves: true, recordedAt: true },
                orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
                take: 1,
              },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
  if (!k) return null;

  const akunUrut = urutkanAkun(k.accounts.map((a) => ({ ...a, platform: a.platform as Platform })));
  const angka = await angkaKolaborasi(k.briefs.map((b) => b.id));
  const kolaborasi: KolaborasiProfil[] = k.briefs.map((b) => {
    const a = angka.get(b.id);
    const tayang = b.kolContents
      .filter((c) => c.link && c.liveAt)
      .map((c) => c.liveAt!.getTime())
      .sort((x, y) => x - y);
    return {
      id: b.id,
      docNo: b.docNo,
      campaign: b.campaign ? { id: b.campaign.id, nama: b.campaign.name } : null,
      tahap: b.tahap as Tahap,
      jenis: b.jenis as JenisKerjaSama,
      fee: Number(b.fee),
      feeBruto: a && a.biaya.pph > 0 ? feeBruto(a.biaya) : null,
      plannedLiveAt: b.plannedLiveAt?.toISOString() ?? null,
      liveAtPertama: tayang.length ? new Date(tayang[0]).toISOString() : null,
      dibuat: b.createdAt.toISOString(),
      views: a?.angka.views ?? 0,
      gmv: a?.gmv ?? 0,
      roas: a?.roas ?? null,
      biaya: a?.biaya.total ?? 0,
    };
  });
  const total = jumlahAngkaKolaborasi([...angka.values()]);
  const feeTerakhir = kolaborasi.find((c) => c.fee > 0)?.fee ?? null;

  const akunTanpaRiwayat: AkunRingkas[] = akunUrut.map((a) => ({
    id: a.id,
    platform: a.platform,
    handle: a.handle,
    followers: a.followers,
    url: a.url,
  }));

  return {
    form: keDataForm(k, akunTanpaRiwayat),
    nama: k.name,
    tier: tierKol(akunUrut.map((a) => a.followers)),
    pengikut: akunTerbesar(akunUrut)?.followers ?? 0,
    diblokir: k.blockedAt !== null,
    blockedAt: k.blockedAt?.toISOString() ?? null,
    alasanBlokir: k.blockedAt ? k.blockReason : null,
    kontakTerakhir: k.lastContactAt?.toISOString() ?? null,
    dibuat: k.createdAt.toISOString(),
    label: bacaLabel(k.label),
    akun: akunUrut.map((a, i) => ({
      ...akunTanpaRiwayat[i],
      riwayat: a.snapshots.map((s) => ({ followers: s.followers, recordedAt: s.recordedAt.toISOString(), source: s.source })),
    })),
    kolaborasi,
    konten: k.briefs.flatMap((b) =>
      b.kolContents.map((c) => ({
        id: c.id,
        kolaborasiId: b.id,
        docNo: b.docNo,
        platform: c.platform as Platform,
        format: String(c.format),
        link: c.link,
        draftLink: c.draftLink,
        draftStatus: (c.draftStatus as StatusDraf | null) ?? null,
        liveAt: c.liveAt?.toISOString() ?? null,
        plannedAt: c.plannedAt?.toISOString() ?? null,
        angka: c.metrics[0]
          ? {
              views: c.metrics[0].views,
              likes: c.metrics[0].likes,
              comments: c.metrics[0].comments,
              shares: c.metrics[0].shares,
              saves: c.metrics[0].saves,
              recordedAt: c.metrics[0].recordedAt.toISOString(),
            }
          : null,
      })),
    ),
    ringkas: {
      ...hitungKolaborasiKol(kolaborasi.map((c) => c.tahap)),
      views: total.angka.views,
      gmv: total.gmv,
      roas: total.roas,
      biaya: total.biaya.total,
      feeTerakhir,
      tepatWaktu: persenTepatWaktu(kolaborasi),
    },
  };
}

/* ───────────────────────────── kembar ───────────────────────────── */

export type AnggotaKembar = {
  id: string;
  nama: string;
  akun: { platform: Platform; handle: string; followers: number }[];
  waNormal: string | null;
  diblokir: boolean;
  jumlahKolaborasi: number;
  /** Pengiriman sampel yang sudah berangkat ke KOL ini. */
  jumlahKirim: number;
};

export type KelompokKembarKol = {
  sebab: SebabKembar[];
  /** Nomor WA atau handle yang sama — kepala kartu "NOMOR SAMA · …". */
  nomorSama: string | null;
  handleSama: string | null;
  anggota: AnggotaKembar[];
  kirimTotal: number;
};

/** "Cek kembar" atas semua KOL aktif, menurut nomor WA dan handle (lintas platform). */
export async function kelompokKembarKol(): Promise<{ kelompok: KelompokKembarKol[]; terpotong: boolean }> {
  const rows = await prisma.kol.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      waNormal: true,
      blockedAt: true,
      accounts: { select: { platform: true, handle: true, followers: true } },
      briefs: {
        select: { shipments: { where: { OR: [{ stockIssuedAt: { not: null } }, { sentAt: { not: null } }] }, select: { id: true } } },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const per = new Map(rows.map((r) => [r.id, r]));
  const kelompok = kelompokKembar(
    rows.map((r) => ({ id: r.id, nama: r.name, waNormal: r.waNormal, handles: r.accounts.map((a) => a.handle) })),
  );
  const hasil = kelompok.slice(0, BATAS_KELOMPOK_KEMBAR).map((g) => {
    const anggota = g.ids.map((id) => {
      const r = per.get(id)!;
      return {
        id,
        nama: r.name,
        akun: urutkanAkun(r.accounts.map((a) => ({ ...a, platform: a.platform as Platform }))),
        waNormal: r.waNormal,
        diblokir: r.blockedAt !== null,
        jumlahKolaborasi: r.briefs.length,
        jumlahKirim: r.briefs.reduce((s, b) => s + b.shipments.length, 0),
      };
    });
    const hitungWa = new Map<string, number>();
    const hitungHandle = new Map<string, number>();
    for (const a of anggota) {
      if (a.waNormal) hitungWa.set(a.waNormal, (hitungWa.get(a.waNormal) ?? 0) + 1);
      for (const h of new Set(a.akun.map((x) => normalisasiHandle(x.handle)).filter((x): x is string => Boolean(x)))) {
        hitungHandle.set(h, (hitungHandle.get(h) ?? 0) + 1);
      }
    }
    const sama = (m: Map<string, number>) => [...m.entries()].find(([, n]) => n > 1)?.[0] ?? null;
    return {
      sebab: g.sebab,
      nomorSama: sama(hitungWa),
      handleSama: sama(hitungHandle),
      anggota,
      kirimTotal: anggota.reduce((s, a) => s + a.jumlahKirim, 0),
    };
  });
  return { kelompok: hasil, terpotong: kelompok.length > BATAS_KELOMPOK_KEMBAR };
}

/* ─────────────────────────── tambah massal ─────────────────────────── */

export type CalonPerbarui = {
  id: string;
  nama: string;
  sebab: SebabKembar[];
  diblokir: boolean;
  /** Akun di platform tempelan dengan handle yang sama, bila sudah ada. */
  akunSama: { handle: string; followers: number } | null;
};

export type BarisPratinjau = BarisTempel & {
  kembar: CalonPerbarui[];
  /** Nomor baris sebelumnya di tempelan yang handle-nya sama, atau null. */
  kembarDalam: number | null;
};

/** Tandai baris tempelan yang kembar dengan KOL yang sudah ada (nomor WA atau handle). */
export async function pratinjauTempelan(baris: readonly BarisTempel[], platform: Platform): Promise<BarisPratinjau[]> {
  const rows = await prisma.kol.findMany({
    select: { id: true, name: true, waNormal: true, blockedAt: true, accounts: { select: { platform: true, handle: true, followers: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const calon = rows.map((r) => ({ id: r.id, nama: r.name, waNormal: r.waNormal, handles: r.accounts.map((a) => a.handle) }));
  const per = new Map(rows.map((r) => [r.id, r]));
  const dalam = kembarDalamTempelan(baris);
  return baris.map((b) => {
    const kembar = b.handle ? cariKembar({ waNormal: b.wa, handles: [b.handle] }, calon) : [];
    return {
      ...b,
      kembarDalam: dalam.get(b.nomor) ?? null,
      kembar: kembar.slice(0, 5).map((c) => {
        const r = per.get(c.id)!;
        const akun = r.accounts.find((a) => a.platform === platform && normalisasiHandle(a.handle) === b.handle);
        return {
          id: c.id,
          nama: c.nama,
          sebab: c.sebab,
          diblokir: r.blockedAt !== null,
          akunSama: akun ? { handle: akun.handle, followers: akun.followers } : null,
        };
      }),
    };
  });
}

/* ───────────────────────── catatan & riwayat ───────────────────────── */

export type ItemLinimasa =
  | {
      jenis: "MANUAL";
      id: string;
      waktu: string;
      oleh: string | null;
      isi: string;
      docNo: string | null;
      kolaborasiId: string | null;
    }
  | {
      jenis: "OTOMATIS";
      id: string;
      waktu: string;
      oleh: string | null;
      aksi: string;
      entityType: string;
      tahapDari: string | null;
      tahapKe: string | null;
      template: string | null;
      sebab: string | null;
      alasan: string | null;
      docNo: string | null;
      kolomBerubah: string[];
      pengikut: { akun: string; dari: number; ke: number }[];
    };

export const BATAS_LINIMASA = 200;

const objek = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") {
    try {
      return objek(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};
const teksAtauNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * Satu linimasa: catatan manual (`KolNote`) + riwayat otomatis (`AuditLog`).
 *
 * - Dengan `kolaborasiId`: catatan kolaborasi itu + jejak kolaborasi beserta
 *   pengiriman, konten, dan penjualannya.
 * - Hanya `kolId`: semua catatan KOL itu (termasuk catatan kolaborasinya) +
 *   jejak pada KOL-nya.
 */
export async function catatanDanRiwayat(input: { kolId?: string | null; kolaborasiId?: string | null }): Promise<ItemLinimasa[]> {
  if (!input.kolId && !input.kolaborasiId) return [];

  let syaratJejak: Prisma.AuditLogWhereInput;
  if (input.kolaborasiId) {
    const c = await prisma.kolBrief.findUnique({
      where: { id: input.kolaborasiId },
      select: { id: true, shipments: { select: { id: true } }, kolContents: { select: { id: true } }, sales: { select: { id: true } } },
    });
    if (!c) return [];
    syaratJejak = {
      OR: [
        { entityType: "KolBrief", entityId: c.id },
        ...(c.shipments.length ? [{ entityType: "KolShipment", entityId: { in: c.shipments.map((x) => x.id) } }] : []),
        ...(c.kolContents.length ? [{ entityType: "KolContent", entityId: { in: c.kolContents.map((x) => x.id) } }] : []),
        ...(c.sales.length ? [{ entityType: "KolSale", entityId: { in: c.sales.map((x) => x.id) } }] : []),
      ],
    };
  } else {
    syaratJejak = { entityType: "Kol", entityId: input.kolId! };
  }

  const [catatan, jejak] = await Promise.all([
    prisma.kolNote.findMany({
      where: input.kolaborasiId ? { collabId: input.kolaborasiId } : { kolId: input.kolId! },
      select: { id: true, body: true, createdAt: true, collabId: true, createdBy: { select: { name: true } }, collab: { select: { docNo: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: BATAS_LINIMASA,
    }),
    prisma.auditLog.findMany({
      where: syaratJejak,
      select: { id: true, action: true, entityType: true, changes: true, metadata: true, reason: true, createdAt: true, user: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: BATAS_LINIMASA,
    }),
  ]);

  const manual: ItemLinimasa[] = catatan.map((n) => ({
    jenis: "MANUAL",
    id: n.id,
    waktu: n.createdAt.toISOString(),
    oleh: n.createdBy?.name ?? null,
    isi: n.body,
    docNo: n.collab?.docNo ?? null,
    kolaborasiId: n.collabId,
  }));
  const otomatis: ItemLinimasa[] = jejak.map((j) => {
    const ch = objek(j.changes);
    const sebelum = objek(ch.before);
    const sesudah = objek(ch.after);
    const meta = objek(j.metadata);
    const pengikut = Array.isArray(meta.pengikutBerubah)
      ? (meta.pengikutBerubah as unknown[]).flatMap((p) => {
          const o = objek(p);
          return typeof o.akun === "string" && typeof o.dari === "number" && typeof o.ke === "number"
            ? [{ akun: o.akun, dari: o.dari, ke: o.ke }]
            : [];
        })
      : [];
    return {
      jenis: "OTOMATIS",
      id: j.id,
      waktu: j.createdAt.toISOString(),
      oleh: j.user?.name ?? null,
      aksi: j.action,
      entityType: j.entityType,
      tahapDari: teksAtauNull(sebelum.tahap),
      tahapKe: teksAtauNull(sesudah.tahap),
      template: teksAtauNull(meta.template),
      sebab: teksAtauNull(meta.sebab),
      alasan: j.reason?.trim() || null,
      docNo: teksAtauNull(meta.docNo),
      kolomBerubah: j.action === "KOL_UPDATED" ? Object.keys(sesudah) : [],
      pengikut,
    };
  });
  return [...manual, ...otomatis].sort((a, b) => b.waktu.localeCompare(a.waktu) || b.id.localeCompare(a.id)).slice(0, BATAS_LINIMASA);
}
