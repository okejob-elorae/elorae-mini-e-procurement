import { prisma, Prisma, sqlId } from "@elorae/db";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { JEJAK } from "@/lib/receivables/jejak";
import { engagementRate, type AngkaKonten } from "./angka-konten";
import { SUMBER_DETEKSI_TAG } from "./brand-collab";
import { handleDariLink } from "./pantau-muatan";
import { PER_HALAMAN_PERFORMA, polaCari, statusVideo, type ParamPerforma, type StatusVideo } from "./performa";

/*
 * Kueri Kreatif → Performa video — KHUSUS SERVER (klien hanya `import type`).
 *
 * Skala sampai puluhan ribu video (10.000 KOL dan afiliasi): saring, urut, dan
 * potong halaman terjadi di SQL, bukan di memori. Angka yang mewakili video
 * adalah bacaan TERBARU-nya (angka tidak pernah ditimpa — setiap bacaan baris
 * `KolContentMetric` baru); "naik" = views terbaru dikurangi views bacaan
 * sebelumnya. SQL-nya satu salinan untuk MariaDB dan PostgreSQL (`sqlId`).
 *
 * ER per baris memakai rumus tunggal `engagementRate` (`angka-konten.ts`).
 * Hanya URUTAN berdasarkan ER dan rata-rata ER di ringkasan yang dihitung SQL,
 * dengan rumus yang sama: (like + komentar + share + save) ÷ views × 100,
 * video tanpa views dilewati — `performa-queries.test.ts` mencocokkan
 * keduanya dengan `engagementRate`.
 */

const I = sqlId;

export type BarisPerforma = {
  kontenId: string;
  kolaborasiId: string;
  kolId: string;
  nama: string;
  handle: string | null;
  afiliasi: boolean;
  link: string;
  /** ISO. */
  tayangAt: string | null;
  angka: AngkaKonten | null;
  er: number | null;
  /** Views terbaru − views bacaan sebelumnya; null bila belum ada dua bacaan. */
  naik: number | null;
  /** ISO — waktu bacaan terbaru. */
  dicekAt: string | null;
  /** Sumber bacaan terbaru: "ekstensi", atau lainnya (isian tangan). */
  sumber: string | null;
  status: StatusVideo;
  /** Kode galat cek terakhir yang gagal. */
  alasanGagal: string | null;
  /** Masuk sendiri karena menandai Elorae (dibuat pembacaan ekstensi, sumber `DETEKSI_TAG`). */
  terdeteksi: boolean;
};

export type RingkasanPerforma = {
  video: number;
  totalViews: number;
  /** Rata-rata ER per video (yang punya views), persen. */
  rataEr: number | null;
  /** Video yang bacaan terbarunya hari ini (WIB). */
  dicekHariIni: number;
};

export type HasilPerforma = {
  baris: BarisPerforma[];
  total: number;
  halaman: number;
  perHalaman: number;
  ringkasan: RingkasanPerforma;
};

/** FROM + JOIN bersama: konten → kolaborasi → KOL, plus bacaan terbaru (`m`). */
const DARI = Prisma.sql`
  FROM ${I("KolContent")} c
  JOIN ${I("KolBrief")} b ON b.${I("id")} = c.${I("collabId")}
  JOIN ${I("Kol")} k ON k.${I("id")} = b.${I("kolId")}
  LEFT JOIN ${I("KolContentMetric")} m ON m.${I("id")} = (
    SELECT m2.${I("id")} FROM ${I("KolContentMetric")} m2
    WHERE m2.${I("contentId")} = c.${I("id")}
    ORDER BY m2.${I("recordedAt")} DESC, m2.${I("id")} DESC
    LIMIT 1
  )`;

/** Kolaborasi KOMISI = afiliasi. Nilai enum ditulis sebagai literal: parameter teks tidak bisa dibandingkan dengan enum PostgreSQL. */
const AFILIASI = Prisma.sql`b.${I("jenis")} = 'KOMISI'`;

function syarat(p: ParamPerforma, cakupan?: readonly string[]): Prisma.Sql {
  const bagian: Prisma.Sql[] = [
    Prisma.sql`c.${I("platform")} = 'TIKTOK'`,
    Prisma.sql`c.${I("link")} IS NOT NULL`,
    Prisma.sql`LOWER(c.${I("link")}) LIKE ${"%tiktok.com%"}`,
  ];
  const pola = polaCari(p.cari);
  if (pola) bagian.push(Prisma.sql`(LOWER(k.${I("name")}) LIKE ${pola} OR LOWER(c.${I("link")}) LIKE ${pola})`);
  if (p.jenis === "afiliasi") bagian.push(AFILIASI);
  if (p.jenis === "kol") bagian.push(Prisma.sql`NOT (${AFILIASI})`);
  if (p.dari) bagian.push(Prisma.sql`c.${I("liveAt")} >= ${parseDateOnly(p.dari)!}`);
  if (p.sampai) bagian.push(Prisma.sql`c.${I("liveAt")} <= ${parseDateOnlyEnd(p.sampai)!}`);
  if (cakupan) bagian.push(cakupan.length ? Prisma.sql`c.${I("id")} IN (${Prisma.join([...cakupan])})` : Prisma.sql`1 = 0`);
  return Prisma.join(bagian, " AND ");
}

const ER_SQL = (a: string) =>
  Prisma.sql`CASE WHEN ${Prisma.raw(a)}.${I("views")} > 0 THEN (${Prisma.raw(a)}.${I("likes")} + ${Prisma.raw(a)}.${I("comments")} + ${Prisma.raw(a)}.${I("shares")} + ${Prisma.raw(a)}.${I("saves")}) * 100.0 / ${Prisma.raw(a)}.${I("views")} END`;

/** `(x IS NULL)` dulu: kosong selalu di akhir — PostgreSQL menaruh NULL di depan pada DESC, MariaDB di belakang. */
function urutan(urut: ParamPerforma["urut"]): Prisma.Sql {
  const v = (kolom: string) => Prisma.sql`v.${I(kolom)}`;
  const turun = (e: Prisma.Sql) => Prisma.sql`(${e}) IS NULL, ${e} DESC`;
  const naik = Prisma.sql`${v("views")} - ${v("viewsSebelum")}`;
  const utama =
    urut === "naik"
      ? Prisma.sql`${turun(naik)}, ${turun(v("views"))}`
      : urut === "er"
        ? turun(ER_SQL("v"))
        : urut === "tayang"
          ? turun(v("tayangAt"))
          : urut === "dicek"
            ? turun(v("dicekAt"))
            : turun(v("views"));
  return Prisma.sql`${utama}, ${v("kontenId")} ASC`;
}

type BarisMentah = {
  kontenId: string;
  kolaborasiId: string;
  kolId: string;
  nama: string;
  link: string;
  tayangAt: Date | string | null;
  afiliasi: number | bigint;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  dicekAt: Date | string | null;
  sumber: string | null;
  viewsSebelum: number | null;
};

const angkaSql = (x: unknown): number => (x === null || x === undefined ? 0 : Number(x));
const isoSql = (x: Date | string | null): string | null => (x === null ? null : new Date(x).toISOString());

/**
 * Satu halaman Performa video + ringkasannya, menurut saringan yang sama.
 * `sekarang` (hari ini WIB untuk "dicek hari ini") dan `cakupan` (id konten)
 * hanya untuk tes yang berbagi basis data.
 */
export async function daftarPerformaVideo(
  p: ParamPerforma,
  opsi: { sekarang?: Date; perHalaman?: number; cakupan?: readonly string[] } = {},
): Promise<HasilPerforma> {
  const perHalaman = opsi.perHalaman ?? PER_HALAMAN_PERFORMA;
  const where = syarat(p, opsi.cakupan);
  const awalHariIni = parseDateOnly(hariIniWib(opsi.sekarang ?? new Date()))!;

  const [r] = await prisma.$queryRaw<{ video: unknown; totalViews: unknown; rataEr: unknown; dicekHariIni: unknown }[]>(Prisma.sql`
    SELECT
      COUNT(*) AS ${I("video")},
      COALESCE(SUM(m.${I("views")}), 0) AS ${I("totalViews")},
      AVG(${ER_SQL("m")}) AS ${I("rataEr")},
      COALESCE(SUM(CASE WHEN m.${I("recordedAt")} >= ${awalHariIni} THEN 1 ELSE 0 END), 0) AS ${I("dicekHariIni")}
    ${DARI}
    WHERE ${where}
  `);
  const total = angkaSql(r?.video);
  const ringkasan: RingkasanPerforma = {
    video: total,
    totalViews: angkaSql(r?.totalViews),
    rataEr: r?.rataEr === null || r?.rataEr === undefined ? null : Math.round(Number(r.rataEr) * 100) / 100,
    dicekHariIni: angkaSql(r?.dicekHariIni),
  };

  const halamanTerakhir = Math.max(1, Math.ceil(total / perHalaman));
  const halaman = Math.min(p.halaman, halamanTerakhir);
  const mentah = total
    ? await prisma.$queryRaw<BarisMentah[]>(Prisma.sql`
        SELECT v.* FROM (
          SELECT
            c.${I("id")} AS ${I("kontenId")},
            c.${I("collabId")} AS ${I("kolaborasiId")},
            k.${I("id")} AS ${I("kolId")},
            k.${I("name")} AS ${I("nama")},
            c.${I("link")} AS ${I("link")},
            c.${I("liveAt")} AS ${I("tayangAt")},
            CASE WHEN ${AFILIASI} THEN 1 ELSE 0 END AS ${I("afiliasi")},
            m.${I("views")} AS ${I("views")},
            m.${I("likes")} AS ${I("likes")},
            m.${I("comments")} AS ${I("comments")},
            m.${I("shares")} AS ${I("shares")},
            m.${I("saves")} AS ${I("saves")},
            m.${I("recordedAt")} AS ${I("dicekAt")},
            m.${I("source")} AS ${I("sumber")},
            (
              SELECT p.${I("views")} FROM ${I("KolContentMetric")} p
              WHERE p.${I("contentId")} = c.${I("id")}
              ORDER BY p.${I("recordedAt")} DESC, p.${I("id")} DESC
              LIMIT 1 OFFSET 1
            ) AS ${I("viewsSebelum")}
          ${DARI}
          WHERE ${where}
        ) v
        ORDER BY ${urutan(p.urut)}
        LIMIT ${perHalaman} OFFSET ${(halaman - 1) * perHalaman}
      `)
    : [];

  const ids = mentah.map((x) => x.kontenId);
  const tugas = ids.length
    ? await prisma.kolTugasPantau.findMany({
        where: { contentId: { in: ids }, jenis: "KONTEN" },
        select: { contentId: true, status: true, galatTerakhir: true, selesaiAt: true },
      })
    : [];
  const tugasPer = new Map<string, typeof tugas>();
  for (const t of tugas) if (t.contentId) tugasPer.set(t.contentId, [...(tugasPer.get(t.contentId) ?? []), t]);

  // "Terdeteksi otomatis": konten tidak punya kolom asal, jadi dibaca dari jejak pembuatannya
  // (ditulis pada kolaborasi, `metadata.kontenId` + `metadata.sumber`). Satu kueri ber-indeks
  // (entityType, entityId) untuk paling banyak satu halaman kolaborasi.
  const kolaborasiIds = [...new Set(mentah.map((x) => x.kolaborasiId))];
  const jejakDibuat = kolaborasiIds.length
    ? await prisma.auditLog.findMany({
        where: { entityType: "KolBrief", entityId: { in: kolaborasiIds }, action: JEJAK.KONTEN_KOL_DICATAT },
        select: { metadata: true },
      })
    : [];
  const terdeteksi = new Set(
    jejakDibuat.flatMap((j) => {
      const m = j.metadata && typeof j.metadata === "object" && !Array.isArray(j.metadata) ? (j.metadata as Record<string, unknown>) : null;
      return m && m.sumber === SUMBER_DETEKSI_TAG && typeof m.kontenId === "string" ? [m.kontenId] : [];
    }),
  );

  const baris = mentah.map((x): BarisPerforma => {
    const angka: AngkaKonten | null =
      x.views === null
        ? null
        : { views: angkaSql(x.views), likes: angkaSql(x.likes), comments: angkaSql(x.comments), shares: angkaSql(x.shares), saves: angkaSql(x.saves) };
    const st = statusVideo({ tugas: tugasPer.get(x.kontenId) ?? [], dicekAt: x.dicekAt });
    return {
      kontenId: x.kontenId,
      kolaborasiId: x.kolaborasiId,
      kolId: x.kolId,
      nama: x.nama,
      handle: handleDariLink(x.link),
      afiliasi: Number(x.afiliasi) === 1,
      link: x.link,
      tayangAt: isoSql(x.tayangAt),
      angka,
      er: angka ? engagementRate(angka) : null,
      naik: angka && x.viewsSebelum !== null ? angka.views - angkaSql(x.viewsSebelum) : null,
      dicekAt: isoSql(x.dicekAt),
      sumber: x.sumber,
      status: st.status,
      alasanGagal: st.alasan,
      terdeteksi: terdeteksi.has(x.kontenId),
    };
  });

  return { baris, total, halaman, perHalaman, ringkasan };
}
