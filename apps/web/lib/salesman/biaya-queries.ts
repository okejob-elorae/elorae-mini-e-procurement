import { prisma } from "@elorae/db";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { getActiveVisit } from "@/lib/stores/queries";
import {
  bacaPengaturanBiaya,
  ENTITAS_BIAYA,
  KUNCI_PENGATURAN_BIAYA,
  rentangBulanWib,
  ringkasPerStatus,
  type Jumlahan,
  type PengaturanBiaya,
  type StatusBiaya,
} from "./biaya";
import { kunciHariWib } from "@/lib/dashboard/tren";

/**
 * Bacaan klaim biaya perjalanan. `ExpenseClaim` tidak punya relasi Prisma
 * (tabel web-only, `relationMode = "prisma"`), jadi nama salesman, penyetuju,
 * pembayar, dan toko kunjungan digabung di sini dengan kueri kedua — bukan
 * `include`.
 *
 * Semua tanggal diformat DI SERVER dan dikirim sebagai teks: format tanggal
 * di klien bisa berbeda antara Node dan Safari (hydration error).
 */

export async function pengaturanBiayaDb(): Promise<PengaturanBiaya> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KUNCI_PENGATURAN_BIAYA }, select: { value: true } });
  return bacaPengaturanBiaya(row?.value);
}

async function namaPengguna(ids: (string | null)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

async function tokoKunjungan(visitIds: (string | null)[]): Promise<Map<string, string>> {
  const unik = [...new Set(visitIds.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.storeVisit.findMany({
    where: { id: { in: unik } },
    select: { id: true, store: { select: { name: true } } },
  });
  return new Map(rows.map((v) => [v.id, v.store.name]));
}

const PILIH = {
  id: true,
  userId: true,
  spentAt: true,
  category: true,
  amount: true,
  photoUrl: true,
  note: true,
  visitId: true,
  status: true,
  reviewedById: true,
  reviewedAt: true,
  reviewNote: true,
  paidById: true,
  paidAt: true,
  createdAt: true,
} as const;

// ─── HP salesman ─────────────────────────────────────────────────────────────

export type BarisBiayaSaya = {
  id: string;
  tanggal: string;
  kategori: string;
  nilai: number;
  status: string;
  catatan: string | null;
  alasanTolak: string | null;
  fotoUrl: string | null;
  toko: string | null;
  diajukan: string;
};

export type BiayaSayaBulan = {
  baris: BarisBiayaSaya[];
  perStatus: Record<StatusBiaya, Jumlahan>;
  total: Jumlahan;
};

/** Klaim sendiri pada satu bulan (menurut tanggal struk), terbaru dulu. */
export async function biayaSaya(userId: string, bulan: string): Promise<BiayaSayaBulan> {
  const { mulai, akhir } = rentangBulanWib(bulan);
  const rows = await prisma.expenseClaim.findMany({
    where: { userId, spentAt: { gte: mulai, lt: akhir } },
    select: PILIH,
    orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
  });
  const toko = await tokoKunjungan(rows.map((r) => r.visitId));
  const baris = rows.map((r) => ({
    id: r.id,
    tanggal: formatDisplayDate(r.spentAt),
    kategori: r.category,
    nilai: Number(r.amount),
    status: r.status,
    catatan: r.note,
    alasanTolak: r.status === "DITOLAK" ? r.reviewNote : null,
    fotoUrl: r.photoUrl,
    toko: r.visitId ? (toko.get(r.visitId) ?? null) : null,
    diajukan: formatDisplayDateTime(r.createdAt),
  }));
  return { baris, ...ringkasPerStatus(baris) };
}

export type BahanBiayaBaru = {
  pengaturan: PengaturanBiaya;
  /** Hari ini WIB, "YYYY-MM-DD" — batas atas pemilih tanggal. */
  hariIni: string;
  /** Tanggal paling lama yang masih boleh diajukan. */
  palingLama: string;
  kunjungan: { id: string; toko: string } | null;
};

/**
 * Bahan formulir. Kunjungan yang sedang berjalan ditangkap SAAT FORMULIR
 * DIBUKA: kalau salesman check-out sebelum menekan Kirim, klaimnya tetap
 * tertaut ke kunjungan tempat biaya itu terjadi.
 */
export async function bahanBiayaBaru(userId: string, sekarang: Date): Promise<BahanBiayaBaru> {
  const [pengaturan, aktif] = await Promise.all([pengaturanBiayaDb(), getActiveVisit(userId)]);
  const hariIni = kunciHariWib(sekarang);
  const palingLama = kunciHariWib(new Date(Date.parse(`${hariIni}T12:00:00Z`) - pengaturan.batasHari * 86_400_000));
  return {
    pengaturan,
    hariIni,
    palingLama,
    kunjungan: aktif ? { id: aktif.id, toko: aktif.store.name } : null,
  };
}

// ─── Kantor ──────────────────────────────────────────────────────────────────

export type BarisBiayaKantor = BarisBiayaSaya & {
  tanggalIso: string;
  salesmanId: string;
  salesman: string;
  diputuskanOleh: string | null;
  diputuskanPada: string | null;
  dibayarOleh: string | null;
  dibayarPada: string | null;
};

type BarisDb = {
  id: string;
  userId: string;
  spentAt: Date;
  category: string;
  amount: { toString(): string };
  photoUrl: string | null;
  note: string | null;
  visitId: string | null;
  status: string;
  reviewedById: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  paidById: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

function barisKantor(r: BarisDb, nama: Map<string, string>, toko: Map<string, string>): BarisBiayaKantor {
  return {
    id: r.id,
    tanggal: formatDisplayDate(r.spentAt),
    tanggalIso: kunciHariWib(r.spentAt),
    kategori: r.category,
    nilai: Number(r.amount.toString()),
    status: r.status,
    catatan: r.note,
    alasanTolak: r.status === "DITOLAK" ? r.reviewNote : null,
    fotoUrl: r.photoUrl,
    toko: r.visitId ? (toko.get(r.visitId) ?? null) : null,
    diajukan: formatDisplayDateTime(r.createdAt),
    salesmanId: r.userId,
    salesman: nama.get(r.userId) ?? "—",
    diputuskanOleh: r.reviewedById ? (nama.get(r.reviewedById) ?? "—") : null,
    diputuskanPada: r.reviewedAt ? formatDisplayDateTime(r.reviewedAt) : null,
    dibayarOleh: r.paidById ? (nama.get(r.paidById) ?? "—") : null,
    dibayarPada: r.paidAt ? formatDisplayDateTime(r.paidAt) : null,
  };
}

export type SaringBiaya = { bulan: string; status?: string | null; salesmanId?: string | null };

export async function daftarBiayaKantor(saring: SaringBiaya): Promise<{
  baris: BarisBiayaKantor[];
  perStatus: Record<StatusBiaya, Jumlahan>;
  total: Jumlahan;
}> {
  const { mulai, akhir } = rentangBulanWib(saring.bulan);
  const rows = await prisma.expenseClaim.findMany({
    where: {
      spentAt: { gte: mulai, lt: akhir },
      ...(saring.status ? { status: saring.status } : {}),
      ...(saring.salesmanId ? { userId: saring.salesmanId } : {}),
    },
    select: PILIH,
    orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
  });
  const [nama, toko] = await Promise.all([
    namaPengguna(rows.flatMap((r) => [r.userId, r.reviewedById, r.paidById])),
    tokoKunjungan(rows.map((r) => r.visitId)),
  ]);
  const baris = rows.map((r) => barisKantor(r, nama, toko));
  // Yang menunggu tindakan di atas — itulah pekerjaan hari ini: menunggu
  // keputusan, lalu menunggu dibayar, lalu sisanya. Urutan tanggal di dalam
  // tiap kelompok tetap (sort stabil).
  const bobot: Record<string, number> = { DIAJUKAN: 0, DISETUJUI: 1 };
  baris.sort((a, b) => (bobot[a.status] ?? 2) - (bobot[b.status] ?? 2));
  return { baris, ...ringkasPerStatus(baris) };
}

export type JejakBiaya = { id: string; aksi: string; oleh: string; pada: string; alasan: string | null };

export type RincianBiaya = BarisBiayaKantor & { jejak: JejakBiaya[] };

export async function rincianBiaya(id: string): Promise<RincianBiaya | null> {
  const r = await prisma.expenseClaim.findUnique({ where: { id }, select: PILIH });
  if (!r) return null;
  const jejakRows = await prisma.auditLog.findMany({
    where: { entityType: ENTITAS_BIAYA, entityId: id },
    select: { id: true, action: true, userId: true, reason: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const [nama, toko] = await Promise.all([
    namaPengguna([r.userId, r.reviewedById, r.paidById, ...jejakRows.map((j) => j.userId)]),
    tokoKunjungan([r.visitId]),
  ]);
  return {
    ...barisKantor(r, nama, toko),
    jejak: jejakRows.map((j) => ({
      id: j.id,
      aksi: j.action,
      oleh: nama.get(j.userId) ?? "—",
      pada: formatDisplayDateTime(j.createdAt),
      alasan: j.reason,
    })),
  };
}
