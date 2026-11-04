import { prisma, type Prisma } from "@elorae/db";
import { formatDisplayDateTime } from "@/lib/date-only";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { bacaPengaturanAbsensi, KUNCI_PENGATURAN_ABSENSI } from "./absensi";
import {
  bacaHariKerjaSpg,
  HARI_TIDAK_KERJA,
  hariTidakKerjaOrang,
  hitungHariKerja,
  izinPadaHari,
  KUNCI_HARI_KERJA_SPG,
  JENIS_IZIN,
  labelRentangIzin,
  ringkasCuti,
  STATUS_IZIN,
  STATUS_IZIN_HIDUP,
  type JenisIzin,
  type RingkasanCuti,
  type StatusIzin,
} from "./izin";
import { daftarSalesman, daftarSpg } from "./queries";

/**
 * Bacaan izin/sakit/cuti. `LeaveRequest` tidak punya relasi Prisma, jadi nama
 * pemohon dan penyetuju digabung dengan kueri kedua. Tanggal diformat DI
 * SERVER (WIB) dan dikirim sebagai teks.
 */

async function kuotaCutiDb(): Promise<number> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KUNCI_PENGATURAN_ABSENSI }, select: { value: true } });
  return bacaPengaturanAbsensi(row?.value).kuotaCutiTahunan;
}

type KlienHariKerja = Pick<Prisma.TransactionClient, "systemSetting" | "user">;

/**
 * Hari libur tiap orang (`hariTidakKerjaOrang`): SPG — pengguna dengan toko
 * tetap — memakai hari kerja SPG dari pengaturan, selain itu libur salesman.
 * Orang yang tidak ditemukan dianggap salesman. `client` boleh transaksi:
 * penulis izin membacanya di dalam transaksinya sendiri.
 */
export async function hariTidakKerjaPengguna(
  userIds: readonly string[],
  client: KlienHariKerja = prisma,
): Promise<Map<string, readonly number[]>> {
  const unik = [...new Set(userIds.filter(Boolean))];
  if (unik.length === 0) return new Map();
  const [setelan, orang] = await Promise.all([
    client.systemSetting.findUnique({ where: { key: KUNCI_HARI_KERJA_SPG }, select: { value: true } }),
    client.user.findMany({ where: { id: { in: unik } }, select: { id: true, assignedStoreId: true } }),
  ]);
  const hariKerjaSpg = bacaHariKerjaSpg(setelan?.value);
  const spg = new Set(orang.filter((o) => o.assignedStoreId).map((o) => o.id));
  return new Map(unik.map((id) => [id, hariTidakKerjaOrang({ spg: spg.has(id), hariKerjaSpg })]));
}

/** Hari libur satu orang — lihat `hariTidakKerjaPengguna`. */
export async function hariTidakKerjaSatu(userId: string, client: KlienHariKerja = prisma): Promise<readonly number[]> {
  return (await hariTidakKerjaPengguna([userId], client)).get(userId) ?? HARI_TIDAK_KERJA;
}

async function namaPengguna(ids: (string | null)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

const PILIH = {
  id: true,
  userId: true,
  type: true,
  startDay: true,
  endDay: true,
  reason: true,
  photoUrl: true,
  status: true,
  reviewedById: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
} as const;

type BarisDb = Prisma.LeaveRequestGetPayload<{ select: typeof PILIH }>;

const jenisDari = (s: string): JenisIzin => ((JENIS_IZIN as readonly string[]).includes(s) ? (s as JenisIzin) : "IZIN");
const statusDari = (s: string): StatusIzin => ((STATUS_IZIN as readonly string[]).includes(s) ? (s as StatusIzin) : "DIAJUKAN");

/** Rentang yang bertumpuk dengan [dari, sampai] — kunci hari, perbandingan teks. */
const bertumpukDengan = (dari: string, sampai: string) => ({ startDay: { lte: sampai }, endDay: { gte: dari } });

// ─── Untuk absensi (dan siapa pun yang perlu tahu siapa sedang izin) ────────

export type IzinDisetujui = { userId: string; type: string; startDay: string; endDay: string };

/**
 * Izin yang DISETUJUI dan menyentuh [dari, sampai] (kunci hari WIB, inklusif).
 * `userIds` null = semua orang. Dipakai riwayat absen, laporan absensi kantor,
 * dan kartu absen beranda.
 */
export async function izinDisetujuiRentang(userIds: string[] | null, dari: string, sampai: string): Promise<IzinDisetujui[]> {
  if (userIds && userIds.length === 0) return [];
  return prisma.leaveRequest.findMany({
    where: { status: "DISETUJUI", ...bertumpukDengan(dari, sampai), ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { userId: true, type: true, startDay: true, endDay: true },
    orderBy: { startDay: "asc" },
  });
}

/** Jenis izin yang disetujui untuk orang ini pada satu hari, atau null. */
export async function izinDisetujuiPadaHari(userId: string, dayKey: string): Promise<JenisIzin | null> {
  return izinPadaHari(await izinDisetujuiRentang([userId], dayKey, dayKey), dayKey);
}

// ─── HP ──────────────────────────────────────────────────────────────────────

export type BarisIzinSaya = {
  id: string;
  jenis: JenisIzin;
  status: StatusIzin;
  mulai: string;
  selesai: string;
  rentang: string;
  hariKerja: number;
  alasan: string;
  fotoUrl: string | null;
  catatanKantor: string | null;
  diajukan: string;
  diputuskan: string | null;
  /** Dibatalkan oleh pemohon sendiri (bukan dicabut kantor). */
  ditarikSendiri: boolean;
};

export type IzinSaya = {
  baris: BarisIzinSaya[];
  cuti: RingkasanCuti;
  hariIni: string;
  /** Hari libur orang ini (0 = Minggu) — formulir HP menghitung hari kerja dengan ini. */
  hariTidakKerja: number[];
};

const BATAS_RIWAYAT_HP = 30;

/**
 * Ajuan milik satu orang (terbaru dulu, paling banyak 30) dan ringkasan kuota
 * cuti tahun WIB berjalan.
 */
export async function izinSaya(userId: string, sekarang: Date): Promise<IzinSaya> {
  const hariIni = kunciHariWib(sekarang);
  const tahun = hariIni.slice(0, 4);
  const [rows, cutiTahun, kuota, libur] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { userId },
      select: PILIH,
      orderBy: [{ startDay: "desc" }, { createdAt: "desc" }],
      take: BATAS_RIWAYAT_HP,
    }),
    prisma.leaveRequest.findMany({
      where: { userId, type: "CUTI", status: { in: [...STATUS_IZIN_HIDUP] }, ...bertumpukDengan(`${tahun}-01-01`, `${tahun}-12-31`) },
      select: { type: true, startDay: true, endDay: true, status: true },
    }),
    kuotaCutiDb(),
    hariTidakKerjaSatu(userId),
  ]);
  return {
    hariIni,
    hariTidakKerja: [...libur],
    cuti: ringkasCuti(cutiTahun, tahun, kuota, libur),
    baris: rows.map((r) => ({
      id: r.id,
      jenis: jenisDari(r.type),
      status: statusDari(r.status),
      mulai: r.startDay,
      selesai: r.endDay,
      rentang: labelRentangIzin(r.startDay, r.endDay),
      hariKerja: hitungHariKerja(r.startDay, r.endDay, undefined, libur),
      alasan: r.reason,
      fotoUrl: r.photoUrl,
      catatanKantor: r.reviewNote,
      diajukan: formatDisplayDateTime(r.createdAt),
      diputuskan: r.reviewedAt ? formatDisplayDateTime(r.reviewedAt) : null,
      ditarikSendiri: r.status === "DIBATALKAN" && r.reviewedById === null,
    })),
  };
}

// ─── Kantor ──────────────────────────────────────────────────────────────────

export type BarisIzinKantor = BarisIzinSaya & {
  userId: string;
  nama: string;
  diputuskanOleh: string | null;
  /** Hanya untuk CUTI: kuota orang ini di tahun mulainya — penyetuju perlu melihatnya. */
  cuti: RingkasanCuti | null;
};

export type SaringIzin = { status: StatusIzin | null; jenis: JenisIzin | null; userId: string | null; bulan: string | null };

const BATAS_DAFTAR_KANTOR = 300;

async function susunKantor(rows: BarisDb[]): Promise<BarisIzinKantor[]> {
  if (rows.length === 0) return [];
  const [nama, liburPer] = await Promise.all([
    namaPengguna(rows.flatMap((r) => [r.userId, r.reviewedById])),
    hariTidakKerjaPengguna(rows.map((r) => r.userId)),
  ]);
  const libur = (userId: string) => liburPer.get(userId) ?? HARI_TIDAK_KERJA;

  // Kuota cuti per (orang, tahun mulai) — satu kueri untuk semua baris cuti.
  const cuti = rows.filter((r) => r.type === "CUTI");
  const kuotaPer = new Map<string, RingkasanCuti>();
  if (cuti.length > 0) {
    const tahun = cuti.map((r) => r.startDay.slice(0, 4)).sort();
    const [kuota, semua] = await Promise.all([
      kuotaCutiDb(),
      prisma.leaveRequest.findMany({
        where: {
          userId: { in: [...new Set(cuti.map((r) => r.userId))] },
          type: "CUTI",
          status: { in: [...STATUS_IZIN_HIDUP] },
          ...bertumpukDengan(`${tahun[0]}-01-01`, `${tahun[tahun.length - 1]}-12-31`),
        },
        select: { userId: true, type: true, startDay: true, endDay: true, status: true },
      }),
    ]);
    for (const r of cuti) {
      const k = `${r.userId}|${r.startDay.slice(0, 4)}`;
      if (!kuotaPer.has(k)) {
        kuotaPer.set(
          k,
          ringkasCuti(semua.filter((a) => a.userId === r.userId), r.startDay.slice(0, 4), kuota, libur(r.userId)),
        );
      }
    }
  }

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    nama: nama.get(r.userId) ?? "—",
    jenis: jenisDari(r.type),
    status: statusDari(r.status),
    mulai: r.startDay,
    selesai: r.endDay,
    rentang: labelRentangIzin(r.startDay, r.endDay),
    hariKerja: hitungHariKerja(r.startDay, r.endDay, undefined, libur(r.userId)),
    alasan: r.reason,
    fotoUrl: r.photoUrl,
    catatanKantor: r.reviewNote,
    diajukan: formatDisplayDateTime(r.createdAt),
    diputuskan: r.reviewedAt ? formatDisplayDateTime(r.reviewedAt) : null,
    diputuskanOleh: r.reviewedById ? (nama.get(r.reviewedById) ?? "—") : null,
    ditarikSendiri: r.status === "DIBATALKAN" && r.reviewedById === null,
    cuti: r.type === "CUTI" ? (kuotaPer.get(`${r.userId}|${r.startDay.slice(0, 4)}`) ?? null) : null,
  }));
}

/**
 * Antrean kantor. Bulan menyaring tanggal IZINNYA (bukan tanggal diajukan):
 * cuti Desember yang diajukan Oktober muncul di Desember. Yang menunggu
 * keputusan selalu di atas.
 */
export async function daftarIzinKantor(
  saring: SaringIzin,
): Promise<{ baris: BarisIzinKantor[]; perStatus: Record<StatusIzin, number>; terpotong: boolean }> {
  const dasar: Prisma.LeaveRequestWhereInput = {
    ...(saring.jenis ? { type: saring.jenis } : {}),
    ...(saring.userId ? { userId: saring.userId } : {}),
    ...(saring.bulan ? bertumpukDengan(`${saring.bulan}-01`, `${saring.bulan}-31`) : {}),
  };
  const [rows, kelompok] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { ...dasar, ...(saring.status ? { status: saring.status } : {}) },
      select: PILIH,
      orderBy: [{ startDay: "desc" }, { createdAt: "desc" }],
      take: BATAS_DAFTAR_KANTOR + 1,
    }),
    prisma.leaveRequest.groupBy({ by: ["status"], where: dasar, _count: { _all: true } }),
  ]);
  const terpotong = rows.length > BATAS_DAFTAR_KANTOR;
  const urut = rows
    .slice(0, BATAS_DAFTAR_KANTOR)
    .sort((a, b) => Number(b.status === "DIAJUKAN") - Number(a.status === "DIAJUKAN"));
  const perStatus = Object.fromEntries(STATUS_IZIN.map((s) => [s, 0])) as Record<StatusIzin, number>;
  for (const k of kelompok) if ((STATUS_IZIN as readonly string[]).includes(k.status)) perStatus[k.status as StatusIzin] = k._count._all;
  return { baris: await susunKantor(urut), perStatus, terpotong };
}

/** Satu ajuan untuk `?id=` (tautan lonceng) — tampil walau tersaring keluar dari daftar. */
export async function izinById(id: string): Promise<BarisIzinKantor | null> {
  const r = await prisma.leaveRequest.findUnique({ where: { id }, select: PILIH });
  return r ? ((await susunKantor([r]))[0] ?? null) : null;
}

/** Orang lapangan untuk saringan: salesman dan SPG, urut nama. */
export async function orangLapangan(): Promise<{ id: string; nama: string }[]> {
  const [sales, spg] = await Promise.all([daftarSalesman(), daftarSpg()]);
  return [...sales, ...spg.map((s) => ({ id: s.id, nama: s.nama }))].sort((a, b) => a.nama.localeCompare(b.nama));
}
