import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { cariTeks } from "@/lib/db/cari-teks";
import { JEJAK } from "@/lib/receivables/jejak";
import { hariIniWib } from "@/lib/tanggal-isian";
import { cpm } from "./angka-konten";
import { angkaKolaborasi, jumlahAngkaKolaborasi, type AngkaKolaborasi, type Periode } from "./angka-queries";
import { LABEL_PLATFORM, type Platform } from "./aturan";
import type { BarisPerformaCsv } from "./laporan-csv";
import { bacaUrutPeringkat, URUT_PERINGKAT, type UrutPeringkat } from "./laporan-param";
import { labelKol, type DataRekap } from "./rekap";
import { SEMUA_TAHAP, type JenisKerjaSama, type Tahap } from "./tahap";
import { JUDUL_TUGAS } from "./tugas";
import { tugasKreatif } from "./tugas-queries";

/**
 * Laporan Ruang KOL — KHUSUS SERVER (klien hanya `import type`).
 *
 * Semua angka hasil (views, order, GMV, biaya, ROAS) berasal dari
 * `angkaKolaborasi(periode)` dan dijumlah per KOL dengan
 * `jumlahAngkaKolaborasi` — tidak ada rumus kedua di sini. Periode mengikuti
 * aturan yang sama: konten menurut tanggal tayang, penjualan menurut
 * tanggalnya, kiriman menurut tanggal berangkat, fee menurut tanggal deal.
 */

type Rentang = { gte: Date; lte: Date };

function rentangDari(periode: Periode | null): Rentang | null {
  if (!periode) return null;
  const gte = parseDateOnly(periode.dari);
  const lte = parseDateOnlyEnd(periode.sampai);
  return gte && lte ? { gte, lte } : null;
}

/**
 * Kolaborasi yang MUNGKIN punya aktivitas di periode — saringan kasar di basis
 * data dengan aturan periode `angkaKolaborasi` yang sama, supaya laporan
 * "Bulan ini" tidak membaca seluruh riwayat. Yang benar-benar beraktivitas
 * diputuskan sesudah angkanya dihitung (`adaAktivitas`).
 */
function whereAktif(rentang: Rentang | null, cari?: string | null): Prisma.KolBriefWhereInput {
  const q = (cari ?? "").trim().replace(/^@+/, "");
  return {
    ...(rentang
      ? {
          OR: [
            { sales: { some: { date: rentang } } },
            { kolContents: { some: { liveAt: rentang, link: { not: null } } } },
            { shipments: { some: { stockIssuedAt: { not: null }, OR: [{ sentAt: rentang }, { sentAt: null, stockIssuedAt: rentang }] } } },
            { dealAt: rentang },
            { dealAt: null, createdAt: rentang },
          ],
        }
      : {}),
    ...(q
      ? {
          kol: {
            OR: [{ name: cariTeks(q) }, { niche: cariTeks(q) }, { accounts: { some: { handle: cariTeks(q) } } }],
          },
        }
      : {}),
  };
}

/** Ada angka apa pun di periode itu: konten, views, order, GMV, atau biaya. */
export function adaAktivitas(a: AngkaKolaborasi): boolean {
  return a.jumlahKonten > 0 || a.angka.views > 0 || a.orders > 0 || a.gmv > 0 || a.biaya.total > 0;
}

type AkunMentah = { platform: string; handle: string; followers: number };
const akunUtama = (akun: readonly AkunMentah[]): AkunMentah | null =>
  [...akun].sort((a, b) => b.followers - a.followers || a.handle.localeCompare(b.handle))[0] ?? null;

// ── Peringkat KOL ─────────────────────────────────────────────────────────

export { bacaUrutPeringkat, URUT_PERINGKAT, type UrutPeringkat };

export type BarisPeringkat = {
  /** Nomor peringkat, berlanjut lintas halaman. */
  peringkat: number;
  kolId: string;
  nama: string;
  niche: string | null;
  handle: string | null;
  platform: Platform | null;
  pengikut: number;
  jumlahKolaborasi: number;
  jumlahKonten: number;
  views: number;
  orders: number;
  gmv: number;
  biaya: number;
  roas: number | null;
  cpm: number | null;
};

export const UKURAN_HALAMAN_PERINGKAT = [25, 50, 100] as const;

export type HasilPeringkat = { baris: BarisPeringkat[]; total: number; halaman: number; perHalaman: number };

/** Yang `null` (tidak bisa dihitung) selalu di belakang, ke arah urut mana pun. */
function bandingNull(a: number | null, b: number | null, naik: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return naik ? a - b : b - a;
}

function bandingPeringkat(urut: UrutPeringkat) {
  return (a: Omit<BarisPeringkat, "peringkat">, b: Omit<BarisPeringkat, "peringkat">): number => {
    const utama =
      urut === "gmv"
        ? b.gmv - a.gmv
        : urut === "roas"
          ? bandingNull(a.roas, b.roas, false)
          : urut === "orders"
            ? b.orders - a.orders
            : urut === "views"
              ? b.views - a.views
              : urut === "konten"
                ? b.jumlahKonten - a.jumlahKonten
                : urut === "cpm"
                  ? bandingNull(a.cpm, b.cpm, true)
                  : b.biaya - a.biaya;
    return utama || b.gmv - a.gmv || b.views - a.views || a.nama.localeCompare(b.nama) || a.kolId.localeCompare(b.kolId);
  };
}

/** Angka per KOL untuk satu periode (`null` = semua waktu). */
async function angkaPerKol(periode: Periode | null, cari?: string | null) {
  const kolab = await prisma.kolBrief.findMany({ where: whereAktif(rentangDari(periode), cari), select: { id: true, kolId: true } });
  const peta = await angkaKolaborasi(
    kolab.map((k) => k.id),
    { periode },
  );
  const perKol = new Map<string, AngkaKolaborasi[]>();
  for (const k of kolab) {
    const a = peta.get(k.id);
    if (!a || !adaAktivitas(a)) continue;
    perKol.set(k.kolId, [...(perKol.get(k.kolId) ?? []), a]);
  }
  return perKol;
}

/**
 * Peringkat KOL di sebuah periode. Hanya KOL yang punya aktivitas di periode
 * itu; nomor peringkat berlanjut lintas halaman.
 */
export async function peringkatKol(o: {
  periode: Periode | null;
  cari?: string | null;
  urut?: UrutPeringkat;
  halaman?: number;
  perHalaman?: number;
}): Promise<HasilPeringkat> {
  const perKol = await angkaPerKol(o.periode, o.cari);
  const kol = perKol.size
    ? await prisma.kol.findMany({
        where: { id: { in: [...perKol.keys()] } },
        select: { id: true, name: true, niche: true, accounts: { select: { platform: true, handle: true, followers: true } } },
      })
    : [];

  const semua = kol
    .map((k) => {
      const a = jumlahAngkaKolaborasi(perKol.get(k.id) ?? []);
      const akun = akunUtama(k.accounts.map((x) => ({ platform: String(x.platform), handle: x.handle, followers: x.followers })));
      return {
        kolId: k.id,
        nama: k.name,
        niche: k.niche,
        handle: akun?.handle ?? null,
        platform: (akun?.platform as Platform | undefined) ?? null,
        pengikut: akun?.followers ?? 0,
        jumlahKolaborasi: perKol.get(k.id)?.length ?? 0,
        jumlahKonten: a.jumlahKonten,
        views: a.angka.views,
        orders: a.orders,
        gmv: a.gmv,
        biaya: a.biaya.total,
        roas: a.roas,
        cpm: cpm(a.biaya.total, a.angka.views),
      };
    })
    .sort(bandingPeringkat(o.urut ?? "gmv"));

  const diminta = Math.trunc(o.perHalaman ?? 0);
  const perHalaman = diminta >= 1 && diminta <= 100 ? diminta : UKURAN_HALAMAN_PERINGKAT[0];
  const jumlahHalaman = Math.max(1, Math.ceil(semua.length / perHalaman));
  const halaman = Math.min(Math.max(1, Math.trunc(o.halaman ?? 1) || 1), jumlahHalaman);
  const awal = (halaman - 1) * perHalaman;
  return {
    baris: semua.slice(awal, awal + perHalaman).map((b, i) => ({ ...b, peringkat: awal + i + 1 })),
    total: semua.length,
    halaman,
    perHalaman,
  };
}

// ── CSV Performa ──────────────────────────────────────────────────────────

/** Baris CSV "Performa": satu per kolaborasi yang beraktivitas di periode, GMV terbesar dulu. */
export async function barisPerforma(o: { periode: Periode | null; cari?: string | null }): Promise<BarisPerformaCsv[]> {
  const kolab = await prisma.kolBrief.findMany({
    where: whereAktif(rentangDari(o.periode), o.cari),
    select: {
      id: true,
      docNo: true,
      tahap: true,
      jenis: true,
      campaign: { select: { name: true } },
      kol: { select: { name: true, accounts: { select: { platform: true, handle: true, followers: true } } } },
    },
  });
  const peta = await angkaKolaborasi(
    kolab.map((k) => k.id),
    { periode: o.periode },
  );
  const hasil: BarisPerformaCsv[] = [];
  for (const k of kolab) {
    const a = peta.get(k.id);
    if (!a || !adaAktivitas(a)) continue;
    const akun = akunUtama(k.kol.accounts.map((x) => ({ platform: String(x.platform), handle: x.handle, followers: x.followers })));
    hasil.push({
      username: akun?.handle ?? null,
      namaKol: k.kol.name,
      platform: (akun?.platform as Platform | undefined) ?? null,
      pengikut: akun?.followers ?? 0,
      campaign: k.campaign?.name ?? null,
      docNo: k.docNo,
      tahap: k.tahap as Tahap,
      jenis: k.jenis as JenisKerjaSama,
      fee: a.biaya.fee,
      pphGrossUp: a.biaya.pph,
      views: a.angka.views,
      jumlahKonten: a.jumlahKonten,
      orders: a.orders,
      gmv: a.gmv,
      komisi: a.komisi,
      biayaKirim: Math.round((a.biaya.ongkir + a.biaya.sampel) * 100) / 100,
      boost: a.biaya.boost,
      totalBiaya: a.biaya.total,
      roas: a.roas,
    });
  }
  return hasil.sort((a, b) => b.gmv - a.gmv || b.views - a.views || a.docNo.localeCompare(b.docNo));
}

// ── Rekap ─────────────────────────────────────────────────────────────────

/** Hari WIB KOL pertama dibuat — awal rentang "Semua" di Rekap. */
export async function awalSemuaKreatif(): Promise<string | null> {
  const k = await prisma.kol.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  return k ? formatDateOnlyJakarta(k.createdAt) : null;
}

const platformTeks = (p: string | null | undefined): string | null => (p ? (LABEL_PLATFORM[p as Platform] ?? p) : null);

const objek = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const tahapDari = (v: unknown): Tahap | null => {
  const t = objek(v)?.tahap;
  return typeof t === "string" && (SEMUA_TAHAP as readonly string[]).includes(t) ? (t as Tahap) : null;
};

/**
 * Bahan `susunRekap` untuk satu hari atau satu rentang hari WIB.
 *
 * "Perlu ditindaklanjuti" adalah keadaan SEKARANG (13 kelompok Hari ini milik
 * `userId`, termasuk agendanya), seperti "Posisi tahap".
 */
export async function dataRekap(o: {
  dari: string;
  sampai: string;
  userId: string | null;
  sekarang?: Date;
  /** `false` melewatkan pembacaan tugas (tes). */
  denganTugas?: boolean;
}): Promise<DataRekap> {
  const periode = { dari: o.dari, sampai: o.sampai };
  const rentang = rentangDari(periode);
  if (!rentang) throw new Error(`Periode rekap tidak sah: ${o.dari}–${o.sampai}`);
  const sekarang = o.sekarang ?? new Date();

  const pilihKol = { select: { name: true, accounts: { select: { platform: true, handle: true, followers: true } } } } as const;
  const label = (k: { name: string; accounts: AkunMentah[] }) => {
    const a = akunUtama(k.accounts.map((x) => ({ platform: String(x.platform), handle: x.handle, followers: x.followers })));
    return { kol: labelKol(a?.handle, k.name), platform: platformTeks(a?.platform) };
  };

  const [kolab, kolBaru, kiriman, diterima, konten, posisiMentah, jejakTahap, catatan, tugas] = await Promise.all([
    prisma.kolBrief.findMany({
      where: whereAktif(rentang),
      select: { id: true, kolId: true, campaignId: true, campaign: { select: { name: true } }, kol: pilihKol },
    }),
    prisma.kol.findMany({ where: { createdAt: rentang }, orderBy: { createdAt: "asc" }, select: { name: true, accounts: pilihKol.select.accounts } }),
    prisma.kolShipment.findMany({
      where: { OR: [{ sentAt: rentang }, { sentAt: null, stockIssuedAt: rentang }] },
      orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
      select: { courier: true, trackingNo: true, collab: { select: { kol: pilihKol } } },
    }),
    prisma.kolShipment.count({ where: { receivedAt: rentang } }),
    prisma.kolContent.findMany({
      where: { link: { not: null }, liveAt: rentang },
      orderBy: { liveAt: "asc" },
      select: {
        platform: true,
        link: true,
        liveAt: true,
        collab: { select: { kol: pilihKol } },
        metrics: { select: { views: true }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1 },
      },
    }),
    prisma.kolBrief.groupBy({ by: ["tahap"], _count: { _all: true } }),
    prisma.auditLog.findMany({
      where: {
        entityType: "KolBrief",
        action: { in: [JEJAK.KOLABORASI_PINDAH_TAHAP, JEJAK.KOLABORASI_MAJU_OTOMATIS] },
        createdAt: rentang,
      },
      orderBy: { createdAt: "asc" },
      select: { entityId: true, changes: true },
    }),
    prisma.kolNote.findMany({
      where: { createdAt: rentang },
      orderBy: { createdAt: "asc" },
      select: { body: true, createdAt: true, kol: pilihKol, collab: { select: { kol: pilihKol } } },
    }),
    o.denganTugas === false ? Promise.resolve([]) : tugasKreatif(o.userId, hariIniWib(sekarang)),
  ]);

  const peta = await angkaKolaborasi(
    kolab.map((k) => k.id),
    { periode },
  );
  const aktif = kolab.filter((k) => {
    const a = peta.get(k.id);
    return a !== undefined && adaAktivitas(a);
  });
  const total = jumlahAngkaKolaborasi(aktif.map((k) => peta.get(k.id)!));

  // Per campaign: KOL yang beraktivitas di campaign itu, views, GMV.
  const perCampaign = new Map<string, { nama: string; kol: Set<string>; angka: AngkaKolaborasi[] }>();
  for (const k of aktif) {
    if (!k.campaignId || !k.campaign) continue;
    const c = perCampaign.get(k.campaignId) ?? { nama: k.campaign.name, kol: new Set<string>(), angka: [] };
    c.kol.add(k.kolId);
    c.angka.push(peta.get(k.id)!);
    perCampaign.set(k.campaignId, c);
  }

  // Teratas: per KOL, yang menghasilkan penjualan.
  const perKol = new Map<string, { label: { kol: string; platform: string | null }; angka: AngkaKolaborasi[] }>();
  for (const k of aktif) {
    const x = perKol.get(k.kolId) ?? { label: label(k.kol), angka: [] };
    x.angka.push(peta.get(k.id)!);
    perKol.set(k.kolId, x);
  }

  // Label KOL untuk jejak tahap (entityId = kolaborasi).
  const idJejak = [...new Set(jejakTahap.map((j) => j.entityId))];
  const kolJejak = idJejak.length
    ? await prisma.kolBrief.findMany({ where: { id: { in: idJejak } }, select: { id: true, kol: pilihKol } })
    : [];
  const labelJejak = new Map(kolJejak.map((k) => [k.id, label(k.kol).kol]));

  const jumlahPerTahap = new Map(posisiMentah.map((p) => [p.tahap as Tahap, p._count._all]));

  return {
    dari: o.dari,
    sampai: o.sampai,
    dibuatPada: sekarang,
    ringkasan: {
      kolBaru: kolBaru.length,
      barangDikirim: kiriman.length,
      barangDiterima: diterima,
      kontenTayang: konten.length,
      views: total.angka.views,
      orders: total.orders,
      gmv: total.gmv,
      komisi: total.komisi,
      biayaFee: total.biaya.fee,
      biayaPph: total.biaya.pph,
      biayaKirim: Math.round((total.biaya.ongkir + total.biaya.sampel) * 100) / 100,
      biayaBoost: total.biaya.boost,
    },
    posisi: SEMUA_TAHAP.map((tahap) => ({ tahap, jumlah: jumlahPerTahap.get(tahap) ?? 0 })),
    perCampaign: [...perCampaign.values()]
      .map((c) => {
        const a = jumlahAngkaKolaborasi(c.angka);
        return { nama: c.nama, kol: c.kol.size, views: a.angka.views, gmv: a.gmv };
      })
      .sort((a, b) => b.gmv - a.gmv || b.views - a.views || a.nama.localeCompare(b.nama)),
    teratas: [...perKol.values()]
      .map((x) => {
        const a = jumlahAngkaKolaborasi(x.angka);
        return { kol: x.label.kol, platform: x.label.platform, gmv: a.gmv, orders: a.orders };
      })
      .filter((t) => t.gmv > 0 || t.orders > 0)
      .sort((a, b) => b.gmv - a.gmv || b.orders - a.orders || a.kol.localeCompare(b.kol)),
    pengiriman: kiriman.map((s) => ({ ...label(s.collab.kol), kurir: s.courier, resi: s.trackingNo })),
    kontenTayang: konten.map((k) => ({
      kol: label(k.collab.kol).kol,
      platform: platformTeks(k.platform),
      views: k.metrics[0]?.views ?? 0,
      link: k.link,
      tanggal: formatDateOnlyJakarta(k.liveAt!),
    })),
    kolBaru: kolBaru.map((k) => {
      const a = akunUtama(k.accounts.map((x) => ({ platform: String(x.platform), handle: x.handle, followers: x.followers })));
      return { kol: labelKol(a?.handle, k.name), platform: platformTeks(a?.platform), pengikut: a?.followers ?? 0 };
    }),
    perubahanTahap: jejakTahap.flatMap((j) => {
      const c = objek(j.changes);
      const ke = tahapDari(c?.after);
      return ke ? [{ kol: labelJejak.get(j.entityId) ?? "—", dari: tahapDari(c?.before), ke }] : [];
    }),
    catatan: catatan.map((n) => ({
      kol: n.kol ? label(n.kol).kol : n.collab ? label(n.collab.kol).kol : "—",
      waktu: n.createdAt,
      isi: n.body,
    })),
    tindakLanjut: tugas.map((g) => ({ judul: JUDUL_TUGAS[g.kunci], jumlah: g.jumlah })),
  };
}
