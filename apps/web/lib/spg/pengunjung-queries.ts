import { prisma } from "@elorae/db";
import { geserHari } from "@/lib/salesman/jadwal";
import type { PengunjungServer } from "./pengunjung";

/**
 * Bacaan penghitung pengunjung (`SpgVisitorCount`). Hari = kunci hari WIB
 * "YYYY-MM-DD"; satu baris per SPG × toko × hari.
 */

/**
 * Jumlah pengunjung satu toko satu hari: semua SPG toko itu dijumlah. `null` =
 * belum ada yang menghitung hari itu (beda dengan 0 — sudah dihitung, tidak
 * ada yang datang). Dipakai laporan tutup hari untuk mengisi angka pengunjung.
 */
export async function pengunjungToko(storeId: string, day: string): Promise<number | null> {
  const r = await prisma.spgVisitorCount.aggregate({ where: { storeId, day }, _sum: { count: true }, _count: { _all: true } });
  return r._count._all === 0 ? null : (r._sum.count ?? 0);
}

export type PengunjungPerSpg = { userId: string; nama: string; count: number };

/** Rincian per SPG satu toko satu hari, urut terbanyak. */
export async function pengunjungTokoRinci(storeId: string, day: string): Promise<PengunjungPerSpg[]> {
  const baris = await prisma.spgVisitorCount.findMany({ where: { storeId, day }, select: { userId: true, count: true } });
  if (baris.length === 0) return [];
  const orang = await prisma.user.findMany({
    where: { id: { in: baris.map((b) => b.userId) } },
    select: { id: true, name: true, email: true },
  });
  const nama = new Map(orang.map((o) => [o.id, o.name ?? o.email]));
  return baris
    .map((b) => ({ userId: b.userId, nama: nama.get(b.userId) ?? "—", count: b.count }))
    .sort((a, b) => b.count - a.count || a.nama.localeCompare(b.nama, "id"));
}

export type PengunjungHp = { day: string; saya: PengunjungServer; totalToko: number };

/**
 * Angka untuk HP SPG: miliknya sendiri (dengan waktu ubahnya, supaya HP bisa
 * menggabungkan dengan catatannya) dan total tokonya. Hanya angka hitungan —
 * tidak ada nama rekan.
 */
export async function pengunjungUntukHp(userId: string, storeId: string, day: string): Promise<PengunjungHp> {
  const [saya, total] = await Promise.all([
    prisma.spgVisitorCount.findUnique({
      where: { storeId_userId_day: { storeId, userId, day } },
      select: { count: true, clientUpdatedAt: true },
    }),
    prisma.spgVisitorCount.aggregate({ where: { storeId, day }, _sum: { count: true } }),
  ]);
  return {
    day,
    saya: saya ? { count: saya.count, clientUpdatedAt: saya.clientUpdatedAt.toISOString() } : null,
    totalToko: total._sum.count ?? 0,
  };
}

export type RiwayatPengunjungHp = { day: string; saya: number | null; toko: number | null };

/**
 * Hari-hari sebelum `hariIni` (paling baru dulu): angka SPG ini dan total
 * tokonya, supaya SPG bisa memastikan hitungan kemarin sudah sampai. `null` =
 * tidak ada hitungan hari itu.
 */
export async function riwayatPengunjungHp(userId: string, storeId: string, hariIni: string, jumlahHari = 6): Promise<RiwayatPengunjungHp[]> {
  const hari = Array.from({ length: jumlahHari }, (_, i) => geserHari(hariIni, -(i + 1)));
  const baris = await prisma.spgVisitorCount.findMany({
    where: { storeId, day: { in: hari } },
    select: { userId: true, day: true, count: true },
  });
  return hari.map((day) => {
    const hariItu = baris.filter((b) => b.day === day);
    return {
      day,
      saya: hariItu.find((b) => b.userId === userId)?.count ?? null,
      toko: hariItu.length === 0 ? null : hariItu.reduce((n, b) => n + b.count, 0),
    };
  });
}
