import { prisma } from "@elorae/db";
import { PILIH_PENGGUNA_SESI, isiSesiDari } from "@/lib/auth/segarkan-sesi";
import { buatPembatasJendela } from "@/lib/field-sales/portal-toko-batas";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { kalenderKreatif } from "./agenda-queries";
import { bangunIcs } from "./ical";
import {
  acaraKalenderKreatif,
  JENDELA_BACA_LANGGANAN_MS,
  KALENDER_LANGGANAN,
  MAKS_BACA_LANGGANAN_PER_JAM,
  rentangLangganan,
} from "./kalender-langganan";
import { bentukTokenSah, hashRahasia } from "./pantau-token";

/*
 * Tautan langganan Kalender Kreatif — bacaan, KHUSUS SERVER (klien hanya `import type`).
 */

/** Satu per proses: dipakai rute `/api/kreatif/kalender/[token]`, dikunci per hash token. */
export const pembatasBacaLangganan = buatPembatasJendela(MAKS_BACA_LANGGANAN_PER_JAM, JENDELA_BACA_LANGGANAN_MS);

export type RingkasLangganan = { aktif: { sejak: Date; terakhirDibaca: Date | null } | null };

/** Keadaan tautan orang itu untuk kartu di halaman Kalender. Tokennya tidak pernah bisa dibaca ulang. */
export async function ringkasLanggananKalender(userId: string): Promise<RingkasLangganan> {
  const f = await prisma.kolCalendarFeed.findFirst({
    where: { userId, revokedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, lastUsedAt: true },
  });
  return { aktif: f ? { sejak: f.createdAt, terakhirDibaca: f.lastUsedAt } : null };
}

export type AksesLangganan = { feedId: string; userId: string; terakhirDibaca: Date | null };

/**
 * Buka tautan dari rute publik. Semua sebab gagal — bentuk salah, tidak
 * dikenal, dicabut, akunnya tidak ada lagi, atau izin `creative:view` sudah
 * tidak dimiliki — SATU jawaban (`null`). Izin dibaca ulang dari basis data
 * setiap kali (peran sistem = semua izin, aturan yang sama dengan sesi masuk).
 */
export async function bukaLanggananKalender(token: unknown): Promise<AksesLangganan | null> {
  if (!bentukTokenSah(token)) return null;
  const feed = await prisma.kolCalendarFeed.findUnique({
    where: { tokenHash: hashRahasia(token) },
    select: { id: true, userId: true, revokedAt: true, lastUsedAt: true },
  });
  if (!feed || feed.revokedAt) return null;
  const pengguna = await prisma.user.findUnique({ where: { id: feed.userId }, select: PILIH_PENGGUNA_SESI });
  if (!pengguna) return null;
  if (!hasPermission(isiSesiDari(pengguna).permissions, PERMISSIONS.CREATIVE_VIEW)) return null;
  return { feedId: feed.id, userId: feed.userId, terakhirDibaca: feed.lastUsedAt };
}

/** Berkas .ics berisi Kalender Kreatif orang itu, −30…+90 hari dari hari ini (WIB). */
export async function isiLanggananKalender(o: { userId: string; asal: string; sekarang?: Date }): Promise<string> {
  const sekarang = o.sekarang ?? new Date();
  const hariIni = hariIniWib(sekarang);
  const { dari, sampai } = rentangLangganan(hariIni);
  const data = await kalenderKreatif({ dari, sampai, userId: o.userId, hariIni });
  return bangunIcs(KALENDER_LANGGANAN, acaraKalenderKreatif(data, { asal: o.asal }), sekarang);
}
