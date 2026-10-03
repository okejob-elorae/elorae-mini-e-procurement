import { prisma, type Prisma } from "@elorae/db";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import {
  bacaAudiens,
  cuplikan,
  keInputWib,
  keadaanPengumuman,
  peranDari,
  pilihKartuBeranda,
  syaratAudiens,
  urutkanUntukHp,
  whereKeadaan,
  type Audiens,
  type KeadaanPengumuman,
  type PeranLapangan,
} from "./aturan";

/**
 * Bacaan pengumuman: penerima, daftar & rincian kantor (dengan laporan baca),
 * daftar & rincian HP, dan kartu beranda. Semua tanggal diformat DI SERVER
 * (WIB) — format tanggal di klien bisa berbeda antara Node dan Safari.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

export type Penerima = { id: string; nama: string; peran: PeranLapangan; assignedStoreId: string | null };

/**
 * Orang lapangan yang dituju sebuah audiens SEKARANG: peran tidak-sistem yang
 * memegang `pwa:access` (definisi yang sama dengan `daftarSalesman`), dipilah
 * oleh toko tetap. Audiens tak dikenal → tidak ada penerima.
 */
export async function penerimaPengumuman(audience: string, klien: Klien = prisma): Promise<Penerima[]> {
  const syarat = syaratAudiens(audience);
  if (syarat === null) return [];
  const rows = await klien.user.findMany({
    where: {
      ...syarat,
      roleDefinition: { isSystem: false, permissions: { some: { permission: { code: "pwa:access" } } } },
    },
    select: { id: true, name: true, email: true, assignedStoreId: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  return rows.map((u) => ({ id: u.id, nama: u.name ?? u.email, peran: peranDari(u.assignedStoreId), assignedStoreId: u.assignedStoreId }));
}

async function namaPengguna(ids: string[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter(Boolean))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

// ── Kantor: daftar ────────────────────────────────────────────────────────

/** Batas baris daftar kantor; pengumuman lebih tua dicari lewat saringan keadaan/kata. */
export const BATAS_DAFTAR_KANTOR = 200;

export type BarisPengumumanKantor = {
  id: string;
  title: string;
  audience: Audiens;
  pinned: boolean;
  requireAck: boolean;
  keadaan: KeadaanPengumuman;
  terbit: string;
  kedaluwarsa: string | null;
  pembuat: string;
  penerima: number;
  dibaca: number;
  dikonfirmasi: number;
};

export async function daftarPengumumanKantor(opsi: {
  keadaan?: KeadaanPengumuman;
  cari?: string;
  sekarang?: Date;
}): Promise<BarisPengumumanKantor[]> {
  const sekarang = opsi.sekarang ?? new Date();
  const where: Prisma.AnnouncementWhereInput = {
    ...(opsi.keadaan ? whereKeadaan(opsi.keadaan, sekarang) : {}),
    ...(opsi.cari ? { title: { contains: opsi.cari, mode: "insensitive" as const } } : {}),
  };
  const rows = await prisma.announcement.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: BATAS_DAFTAR_KANTOR,
  });
  if (rows.length === 0) return [];

  const [lapangan, bacaan, nama] = await Promise.all([
    penerimaPengumuman("SEMUA"),
    prisma.announcementRead.findMany({
      where: { announcementId: { in: rows.map((r) => r.id) } },
      select: { announcementId: true, userId: true, ackAt: true },
    }),
    namaPengguna(rows.map((r) => r.createdById)),
  ]);

  return rows.map((r) => {
    const tuju = new Set(lapangan.filter((p) => r.audience === "SEMUA" || p.peran === r.audience).map((p) => p.id));
    const milik = bacaan.filter((b) => b.announcementId === r.id && tuju.has(b.userId));
    return {
      id: r.id,
      title: r.title,
      audience: bacaAudiens(r.audience) ?? "SEMUA",
      pinned: r.pinned,
      requireAck: r.requireAck,
      keadaan: keadaanPengumuman(r, sekarang),
      terbit: formatDisplayDateTime(r.publishedAt),
      kedaluwarsa: r.expiresAt ? formatDisplayDateTime(r.expiresAt) : null,
      pembuat: nama.get(r.createdById) ?? "—",
      penerima: tuju.size,
      dibaca: milik.length,
      dikonfirmasi: milik.filter((b) => b.ackAt !== null).length,
    };
  });
}

// ── Kantor: rincian + laporan baca ────────────────────────────────────────

export type StatusBaca = "BELUM" | "DIBACA" | "DIKONFIRMASI";

export type BarisLaporanBaca = {
  userId: string;
  nama: string;
  peran: PeranLapangan | null;
  tokoNama: string | null;
  status: StatusBaca;
  dibacaPada: string | null;
  dikonfirmasiPada: string | null;
  /** Membaca, tetapi tidak lagi termasuk penerima (perannya berubah sesudahnya). */
  bukanPenerima: boolean;
};

export type RincianPengumumanKantor = {
  id: string;
  title: string;
  body: string;
  audience: Audiens;
  pinned: boolean;
  requireAck: boolean;
  keadaan: KeadaanPengumuman;
  terbit: string;
  kedaluwarsa: string | null;
  diarsipkan: string | null;
  dibuat: string;
  diubah: string;
  pembuat: string;
  /** Hapus hanya selama belum ada yang membaca; sesudah itu arsipkan. */
  bolehHapus: boolean;
  /** Isi awal formulir ubah ("YYYY-MM-DDTHH:mm", WIB). */
  isian: { publishedAt: string; expiresAt: string; sudahTerbit: boolean };
  laporan: {
    penerima: number;
    dibaca: number;
    dikonfirmasi: number;
    baris: BarisLaporanBaca[];
  };
};

const URUT_STATUS: Record<StatusBaca, number> = { BELUM: 0, DIBACA: 1, DIKONFIRMASI: 2 };

export async function rincianPengumumanKantor(id: string, sekarang = new Date()): Promise<RincianPengumumanKantor | null> {
  const a = await prisma.announcement.findUnique({ where: { id } });
  if (!a) return null;

  const [penerima, bacaan] = await Promise.all([
    penerimaPengumuman(a.audience),
    prisma.announcementRead.findMany({ where: { announcementId: a.id }, select: { userId: true, readAt: true, ackAt: true } }),
  ]);
  const bacaPer = new Map(bacaan.map((b) => [b.userId, b]));
  const tuju = new Set(penerima.map((p) => p.id));
  const luar = bacaan.filter((b) => !tuju.has(b.userId)).map((b) => b.userId);
  const [nama, toko] = await Promise.all([
    namaPengguna([a.createdById, ...luar]),
    (async () => {
      const ids = [...new Set(penerima.map((p) => p.assignedStoreId).filter((x): x is string => !!x))];
      if (ids.length === 0) return new Map<string, string>();
      const rows = await prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      return new Map(rows.map((s) => [s.id, s.name]));
    })(),
  ]);

  const statusDari = (b: { ackAt: Date | null } | undefined): StatusBaca => (!b ? "BELUM" : b.ackAt ? "DIKONFIRMASI" : "DIBACA");
  const baris: BarisLaporanBaca[] = [
    ...penerima.map((p) => {
      const b = bacaPer.get(p.id);
      return {
        userId: p.id,
        nama: p.nama,
        peran: p.peran,
        tokoNama: p.assignedStoreId ? toko.get(p.assignedStoreId) ?? null : null,
        status: statusDari(b),
        dibacaPada: b ? formatDisplayDateTime(b.readAt) : null,
        dikonfirmasiPada: b?.ackAt ? formatDisplayDateTime(b.ackAt) : null,
        bukanPenerima: false,
      };
    }),
    ...luar.map((userId) => {
      const b = bacaPer.get(userId);
      return {
        userId,
        nama: nama.get(userId) ?? "—",
        peran: null,
        tokoNama: null,
        status: statusDari(b),
        dibacaPada: b ? formatDisplayDateTime(b.readAt) : null,
        dikonfirmasiPada: b?.ackAt ? formatDisplayDateTime(b.ackAt) : null,
        bukanPenerima: true,
      };
    }),
  ].sort((x, y) => URUT_STATUS[x.status] - URUT_STATUS[y.status] || x.nama.localeCompare(y.nama, "id"));

  const dariPenerima = baris.filter((b) => !b.bukanPenerima);
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    audience: bacaAudiens(a.audience) ?? "SEMUA",
    pinned: a.pinned,
    requireAck: a.requireAck,
    keadaan: keadaanPengumuman(a, sekarang),
    terbit: formatDisplayDateTime(a.publishedAt),
    kedaluwarsa: a.expiresAt ? formatDisplayDateTime(a.expiresAt) : null,
    diarsipkan: a.archivedAt ? formatDisplayDateTime(a.archivedAt) : null,
    dibuat: formatDisplayDateTime(a.createdAt),
    diubah: formatDisplayDateTime(a.updatedAt),
    pembuat: nama.get(a.createdById) ?? "—",
    bolehHapus: bacaan.length === 0,
    isian: {
      publishedAt: keInputWib(a.publishedAt),
      expiresAt: a.expiresAt ? keInputWib(a.expiresAt) : "",
      sudahTerbit: a.publishedAt.getTime() <= sekarang.getTime(),
    },
    laporan: {
      penerima: penerima.length,
      dibaca: dariPenerima.filter((b) => b.status !== "BELUM").length,
      dikonfirmasi: dariPenerima.filter((b) => b.status === "DIKONFIRMASI").length,
      baris,
    },
  };
}

// ── HP ────────────────────────────────────────────────────────────────────

export type BarisPengumumanHp = {
  id: string;
  title: string;
  cuplikan: string;
  pinned: boolean;
  requireAck: boolean;
  dibaca: boolean;
  perluKonfirmasi: boolean;
  dikonfirmasi: boolean;
  terbit: string;
  kedaluwarsa: string | null;
};

/** Pengumuman yang terlihat oleh orang ini sekarang, mentah (sebelum diformat). */
async function terlihatUntuk(userId: string, sekarang: Date) {
  const peran = peranDari(await ambilTokoTetap(userId));
  const rows = await prisma.announcement.findMany({
    where: { ...whereKeadaan("AKTIF", sekarang), audience: { in: ["SEMUA", peran] } },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  const bacaan = rows.length
    ? await prisma.announcementRead.findMany({
        where: { userId, announcementId: { in: rows.map((r) => r.id) } },
        select: { announcementId: true, ackAt: true },
      })
    : [];
  const per = new Map(bacaan.map((b) => [b.announcementId, b]));
  return {
    peran,
    baris: rows.map((r) => {
      const b = per.get(r.id);
      return {
        id: r.id,
        title: r.title,
        body: r.body,
        pinned: r.pinned,
        requireAck: r.requireAck,
        publishedAt: r.publishedAt,
        expiresAt: r.expiresAt,
        dibaca: !!b,
        perluKonfirmasi: r.requireAck && !b?.ackAt,
        dikonfirmasi: !!b?.ackAt,
      };
    }),
  };
}

function keHp(r: Awaited<ReturnType<typeof terlihatUntuk>>["baris"][number]): BarisPengumumanHp {
  return {
    id: r.id,
    title: r.title,
    cuplikan: cuplikan(r.body, 140),
    pinned: r.pinned,
    requireAck: r.requireAck,
    dibaca: r.dibaca,
    perluKonfirmasi: r.perluKonfirmasi,
    dikonfirmasi: r.dikonfirmasi,
    terbit: formatDisplayDate(r.publishedAt),
    kedaluwarsa: r.expiresAt ? formatDisplayDateTime(r.expiresAt) : null,
  };
}

/** Layar `/pwa/pengumuman`: tersemat dulu, lalu terbaru. */
export async function daftarPengumumanHp(userId: string, sekarang = new Date()): Promise<BarisPengumumanHp[]> {
  const { baris } = await terlihatUntuk(userId, sekarang);
  return urutkanUntukHp(baris).map(keHp);
}

export type DataKartuPengumuman = {
  baris: BarisPengumumanHp[];
  belumDibaca: number;
  perluKonfirmasi: number;
  /** Calon lain yang tidak muat di kartu (lihat semua). */
  lainnya: number;
};

/**
 * Kartu beranda (salesman & SPG): tersemat, menunggu konfirmasi, atau belum
 * dibaca — paling banyak 3. `null` = tidak ada yang perlu dilihat, kartunya
 * tidak tampil.
 */
export async function kartuPengumumanBeranda(userId: string, sekarang = new Date()): Promise<DataKartuPengumuman | null> {
  const { baris } = await terlihatUntuk(userId, sekarang);
  const pilih = pilihKartuBeranda(baris, 3);
  if (pilih.baris.length === 0) return null;
  return { baris: pilih.baris.map(keHp), belumDibaca: pilih.belumDibaca, perluKonfirmasi: pilih.perluKonfirmasi, lainnya: pilih.lainnya };
}

export type RincianPengumumanHp =
  | {
      ada: true;
      id: string;
      title: string;
      body: string;
      pinned: boolean;
      requireAck: boolean;
      keadaan: "AKTIF" | "KEDALUWARSA";
      terbit: string;
      kedaluwarsa: string | null;
      dibaca: boolean;
      dikonfirmasiPada: string | null;
    }
  /** Ada dan untuk perannya, tetapi tidak (lagi/belum) bisa dibaca: diarsipkan atau belum terbit. */
  | { ada: false; alasan: "DIARSIPKAN" | "TERJADWAL" };

/**
 * Rincian untuk HP. `null` = tidak ada, atau bukan untuk perannya (halamannya
 * 404 — tidak membocorkan pengumuman audiens lain). Yang kedaluwarsa masih
 * bisa dibaca dengan keterangan berakhir; yang diarsipkan tidak, karena kantor
 * menariknya.
 */
export async function pengumumanHp(id: string, userId: string, sekarang = new Date()): Promise<RincianPengumumanHp | null> {
  // Dua langkah: judul dan isi baru dibaca SESUDAH lolos audiens dan keadaan, supaya
  // pengumuman peran lain atau yang belum terbit tidak pernah ikut terbaca di jalur ini.
  const [w, tokoTetap] = await Promise.all([
    prisma.announcement.findUnique({
      where: { id },
      select: { id: true, audience: true, publishedAt: true, expiresAt: true, archivedAt: true },
    }),
    ambilTokoTetap(userId),
  ]);
  if (!w) return null;
  const peran = peranDari(tokoTetap);
  if (w.audience !== "SEMUA" && w.audience !== peran) return null;
  const keadaan = keadaanPengumuman(w, sekarang);
  if (keadaan === "DIARSIPKAN" || keadaan === "TERJADWAL") return { ada: false, alasan: keadaan };
  const [a, b] = await Promise.all([
    prisma.announcement.findUnique({ where: { id: w.id } }),
    prisma.announcementRead.findUnique({
      where: { announcementId_userId: { announcementId: w.id, userId } },
      select: { ackAt: true },
    }),
  ]);
  if (!a) return null;
  return {
    ada: true,
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    requireAck: a.requireAck,
    keadaan,
    terbit: formatDisplayDateTime(a.publishedAt),
    kedaluwarsa: a.expiresAt ? formatDisplayDateTime(a.expiresAt) : null,
    dibaca: !!b,
    dikonfirmasiPada: b?.ackAt ? formatDisplayDateTime(b.ackAt) : null,
  };
}
