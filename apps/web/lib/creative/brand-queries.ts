import { prisma, Prisma, sqlId } from "@elorae/db";
import { labelBrand, type JenisBrand, type LabelBrand, type PengaturanBrand } from "./brand-collab";
import { PER_HALAMAN_BRAND, type ParamBrand } from "./brand-param";
import { bacaPengaturanBrand } from "./brand-pengaturan";
import { polaCari } from "./performa";

/*
 * Kueri riwayat brand KOL — KHUSUS SERVER (klien hanya `import type`).
 *
 * Direktori brand dikelompokkan di SQL (satu baris per brand, halaman
 * dipotong di SQL) dan satu salinan untuk MariaDB dan PostgreSQL (`sqlId`).
 * `relationMode = "prisma"`: baris yang menunjuk KOL yang sudah terhapus
 * dilewati lewat JOIN, bukan merobohkan halaman.
 */

const I = sqlId;

export type BarisBrandKol = {
  id: string;
  brandHandle: string;
  brandName: string | null;
  label: LabelBrand | null;
  jenis: JenisBrand;
  platform: string;
  postUrl: string | null;
  /** ISO. */
  postedAt: string | null;
  views: number | null;
  sumber: "EKSTENSI" | "MANUAL";
};

/** Batas baris di tab Brand profil KOL — yang lebih lama tetap ada di direktori Brand. */
export const BATAS_BRAND_PROFIL = 300;

/** Riwayat brand satu KOL (tab Brand di profil KOL), terbaru dulu. */
export async function brandKol(
  kolId: string,
  opsi: { pengaturan?: PengaturanBrand } = {},
): Promise<{ baris: BarisBrandKol[]; total: number }> {
  const pengaturan = opsi.pengaturan ?? (await bacaPengaturanBrand());
  const [baris, total] = await Promise.all([
    prisma.kolBrandCollab.findMany({
      where: { kolId },
      orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
      take: BATAS_BRAND_PROFIL,
      select: { id: true, brandHandle: true, brandName: true, jenis: true, platform: true, postUrl: true, postedAt: true, views: true, sumber: true },
    }),
    prisma.kolBrandCollab.count({ where: { kolId } }),
  ]);
  return {
    total,
    baris: baris.map((b) => ({
      id: b.id,
      brandHandle: b.brandHandle,
      brandName: b.brandName ?? pengaturan.kompetitor.find((k) => k.handle === b.brandHandle)?.nama ?? null,
      label: labelBrand(b.brandHandle, pengaturan),
      jenis: b.jenis as JenisBrand,
      platform: b.platform,
      postUrl: b.postUrl,
      postedAt: b.postedAt?.toISOString() ?? null,
      views: b.views,
      sumber: b.sumber === "MANUAL" ? "MANUAL" : "EKSTENSI",
    })),
  };
}

/* ─────────────────────────── Direktori brand ─────────────────────────── */

export type BarisDirektoriBrand = {
  brandHandle: string;
  nama: string | null;
  label: LabelBrand | null;
  kol: number;
  posting: number;
  /** ISO — posting terakhir yang tanggalnya diketahui. */
  terakhir: string | null;
};

export type HasilDirektoriBrand = { baris: BarisDirektoriBrand[]; total: number; halaman: number; perHalaman: number };

const angkaSql = (x: unknown): number => (x === null || x === undefined ? 0 : Number(x));
const isoSql = (x: unknown): string | null => (x === null || x === undefined ? null : new Date(x as string | Date).toISOString());

/** Syarat saringan direktori (dipakai juga untuk menghitung totalnya). */
function syaratDirektori(p: ParamBrand, pg: PengaturanBrand): Prisma.Sql {
  const bagian: Prisma.Sql[] = [];
  const handle = Prisma.sql`b.${I("brandHandle")}`;
  if (p.saring === "kompetitor") {
    const h = pg.kompetitor.map((k) => k.handle);
    bagian.push(h.length ? Prisma.sql`${handle} IN (${Prisma.join(h)})` : Prisma.sql`1 = 0`);
  }
  if (p.saring === "elorae") {
    bagian.push(pg.akunElorae.length ? Prisma.sql`${handle} IN (${Prisma.join(pg.akunElorae)})` : Prisma.sql`1 = 0`);
  }
  const pola = polaCari(p.cari);
  if (pola) {
    // Nama kompetitor yang diatur di Pengaturan ikut dicari.
    const namaCocok = pg.kompetitor.filter((k) => k.nama.toLowerCase().includes(p.cari.trim().toLowerCase())).map((k) => k.handle);
    const atau: Prisma.Sql[] = [Prisma.sql`LOWER(${handle}) LIKE ${pola}`, Prisma.sql`LOWER(COALESCE(b.${I("brandName")}, '')) LIKE ${pola}`];
    if (namaCocok.length) atau.push(Prisma.sql`${handle} IN (${Prisma.join(namaCocok)})`);
    bagian.push(Prisma.sql`(${Prisma.join(atau, " OR ")})`);
  }
  return bagian.length ? Prisma.join(bagian, " AND ") : Prisma.sql`1 = 1`;
}

const DARI_BRAND = Prisma.sql`FROM ${I("KolBrandCollab")} b JOIN ${I("Kol")} k ON k.${I("id")} = b.${I("kolId")}`;

/** Satu halaman direktori brand: jumlah KOL, jumlah posting, posting terakhir. Terbaru dulu. */
export async function daftarBrand(p: ParamBrand, opsi: { pengaturan?: PengaturanBrand; perHalaman?: number } = {}): Promise<HasilDirektoriBrand> {
  const pg = opsi.pengaturan ?? (await bacaPengaturanBrand());
  const perHalaman = opsi.perHalaman ?? PER_HALAMAN_BRAND;
  const where = syaratDirektori(p, pg);
  const [r] = await prisma.$queryRaw<{ total: unknown }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT b.${I("brandHandle")}) AS ${I("total")} ${DARI_BRAND} WHERE ${where}
  `);
  const total = angkaSql(r?.total);
  const halamanTerakhir = Math.max(1, Math.ceil(total / perHalaman));
  const halaman = Math.min(p.halaman, halamanTerakhir);
  const mentah = total
    ? await prisma.$queryRaw<{ brandHandle: string; nama: string | null; kol: unknown; posting: unknown; terakhir: unknown }[]>(Prisma.sql`
        SELECT v.* FROM (
          SELECT
            b.${I("brandHandle")} AS ${I("brandHandle")},
            MAX(b.${I("brandName")}) AS ${I("nama")},
            COUNT(DISTINCT b.${I("kolId")}) AS ${I("kol")},
            COUNT(*) AS ${I("posting")},
            MAX(COALESCE(b.${I("postedAt")}, b.${I("createdAt")})) AS ${I("terakhir")}
          ${DARI_BRAND}
          WHERE ${where}
          GROUP BY b.${I("brandHandle")}
        ) v
        ORDER BY (v.${I("terakhir")}) IS NULL, v.${I("terakhir")} DESC, v.${I("brandHandle")} ASC
        LIMIT ${perHalaman} OFFSET ${(halaman - 1) * perHalaman}
      `)
    : [];
  return {
    total,
    halaman,
    perHalaman,
    baris: mentah.map((x) => ({
      brandHandle: x.brandHandle,
      nama: pg.kompetitor.find((k) => k.handle === x.brandHandle)?.nama || x.nama || null,
      label: labelBrand(x.brandHandle, pg),
      kol: angkaSql(x.kol),
      posting: angkaSql(x.posting),
      terakhir: isoSql(x.terakhir),
    })),
  };
}

export type BarisKolBrand = {
  kolId: string;
  nama: string;
  diblokir: boolean;
  posting: number;
  berbayar: number;
  kolaborasi: number;
  tag: number;
  /** Jumlah views posting-posting itu pada bacaan terakhirnya. */
  views: number;
  /** ISO. */
  terakhir: string | null;
};

export type HasilKolBrand = {
  brand: { brandHandle: string; nama: string | null; label: LabelBrand | null; posting: number };
  baris: BarisKolBrand[];
  total: number;
  halaman: number;
  perHalaman: number;
};

/** KOL-KOL yang pernah menandai satu brand, posting terakhir dulu. */
export async function kolUntukBrand(
  brandHandle: string,
  halamanDiminta: number,
  opsi: { pengaturan?: PengaturanBrand; perHalaman?: number } = {},
): Promise<HasilKolBrand> {
  const pg = opsi.pengaturan ?? (await bacaPengaturanBrand());
  const perHalaman = opsi.perHalaman ?? PER_HALAMAN_BRAND;
  const where = Prisma.sql`b.${I("brandHandle")} = ${brandHandle}`;
  const [r] = await prisma.$queryRaw<{ total: unknown; posting: unknown; nama: string | null }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT b.${I("kolId")}) AS ${I("total")}, COUNT(*) AS ${I("posting")}, MAX(b.${I("brandName")}) AS ${I("nama")}
    ${DARI_BRAND} WHERE ${where}
  `);
  const total = angkaSql(r?.total);
  const halamanTerakhir = Math.max(1, Math.ceil(total / perHalaman));
  const halaman = Math.min(Math.max(1, halamanDiminta), halamanTerakhir);
  const jumlahJenis = (j: JenisBrand) => Prisma.sql`SUM(CASE WHEN b.${I("jenis")} = ${Prisma.raw(`'${j}'`)} THEN 1 ELSE 0 END)`;
  const mentah = total
    ? await prisma.$queryRaw<
        { kolId: string; nama: string; blockedAt: unknown; posting: unknown; berbayar: unknown; kolaborasi: unknown; tag: unknown; views: unknown; terakhir: unknown }[]
      >(Prisma.sql`
        SELECT v.* FROM (
          SELECT
            k.${I("id")} AS ${I("kolId")},
            k.${I("name")} AS ${I("nama")},
            k.${I("blockedAt")} AS ${I("blockedAt")},
            COUNT(*) AS ${I("posting")},
            ${jumlahJenis("BERBAYAR")} AS ${I("berbayar")},
            ${jumlahJenis("KOLABORASI")} AS ${I("kolaborasi")},
            ${jumlahJenis("TAG")} AS ${I("tag")},
            COALESCE(SUM(b.${I("views")}), 0) AS ${I("views")},
            MAX(COALESCE(b.${I("postedAt")}, b.${I("createdAt")})) AS ${I("terakhir")}
          ${DARI_BRAND}
          WHERE ${where}
          GROUP BY k.${I("id")}, k.${I("name")}, k.${I("blockedAt")}
        ) v
        ORDER BY (v.${I("terakhir")}) IS NULL, v.${I("terakhir")} DESC, v.${I("kolId")} ASC
        LIMIT ${perHalaman} OFFSET ${(halaman - 1) * perHalaman}
      `)
    : [];
  return {
    brand: {
      brandHandle,
      nama: pg.kompetitor.find((k) => k.handle === brandHandle)?.nama || r?.nama || null,
      label: labelBrand(brandHandle, pg),
      posting: angkaSql(r?.posting),
    },
    total,
    halaman,
    perHalaman,
    baris: mentah.map((x) => ({
      kolId: x.kolId,
      nama: x.nama,
      diblokir: x.blockedAt !== null && x.blockedAt !== undefined,
      posting: angkaSql(x.posting),
      berbayar: angkaSql(x.berbayar),
      kolaborasi: angkaSql(x.kolaborasi),
      tag: angkaSql(x.tag),
      views: angkaSql(x.views),
      terakhir: isoSql(x.terakhir),
    })),
  };
}
