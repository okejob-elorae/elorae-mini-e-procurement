import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { JEDA_CATAT_DIPAKAI_MS } from "./kalender-langganan";
import { buatToken } from "./pantau-token";

/*
 * Tautan langganan Kalender Kreatif — KHUSUS SERVER (klien hanya `import type`).
 *
 * Seperti link formulir data KOL dan portal toko: yang disimpan hanya sha256
 * token (`KolCalendarFeed.tokenHash`); token mentah dikembalikan SEKALI ke orang
 * yang membuatnya. Satu orang paling banyak satu tautan aktif — membuat yang
 * baru mencabut yang lama, di transaksi yang sama. Jejak tanpa token dan hash.
 */

export type HasilBuatLangganan = { feedId: string; token: string; sejak: Date; lamaDicabut: number };

export async function buatLanggananKalender(input: { userId: string; sekarang?: Date }): Promise<HasilBuatLangganan> {
  const sekarang = input.sekarang ?? new Date();
  const { token, tokenHash } = buatToken();
  return runSerializable(async (tx) => {
    const lama = await tx.kolCalendarFeed.findMany({ where: { userId: input.userId, revokedAt: null }, select: { id: true } });
    if (lama.length) await tx.kolCalendarFeed.updateMany({ where: { id: { in: lama.map((l) => l.id) } }, data: { revokedAt: sekarang } });
    const feed = await tx.kolCalendarFeed.create({ data: { userId: input.userId, tokenHash, createdAt: sekarang }, select: { id: true } });
    await catatJejak(tx, {
      userId: input.userId,
      action: JEJAK.KALENDER_LANGGANAN_DIBUAT,
      entityType: "KolCalendarFeed",
      entityId: feed.id,
      metadata: { tautanLamaDicabut: lama.map((l) => l.id) },
    });
    return { feedId: feed.id, token, sejak: sekarang, lamaDicabut: lama.length };
  });
}

export type HasilCabutLangganan = { ok: true; dicabut: number } | { ok: false; kode: "TIDAK_ADA" };

/** Cabut semua tautan aktif milik orang itu (biasanya satu). */
export async function cabutLanggananKalender(input: { userId: string; sekarang?: Date }): Promise<HasilCabutLangganan> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilCabutLangganan> => {
    const aktif = await tx.kolCalendarFeed.findMany({ where: { userId: input.userId, revokedAt: null }, select: { id: true } });
    if (!aktif.length) return { ok: false, kode: "TIDAK_ADA" };
    await tx.kolCalendarFeed.updateMany({ where: { id: { in: aktif.map((a) => a.id) } }, data: { revokedAt: sekarang } });
    for (const a of aktif) {
      await catatJejak(tx, { userId: input.userId, action: JEJAK.KALENDER_LANGGANAN_DICABUT, entityType: "KolCalendarFeed", entityId: a.id });
    }
    return { ok: true, dicabut: aktif.length };
  });
}

/**
 * Tandai tautan baru saja dibaca — paling sering sekali per `JEDA_CATAT_DIPAKAI_MS`.
 * Bukan penjaga keadaan (dua penulis serentak hanya menulis waktu yang hampir
 * sama), jadi `updateMany` biasa cukup. Tidak pernah melempar: gagal mencatat
 * tidak boleh menggagalkan kalendernya.
 */
export async function catatPemakaianLangganan(feedId: string, terakhir: Date | null, sekarang: Date = new Date()): Promise<boolean> {
  if (terakhir && sekarang.getTime() - terakhir.getTime() < JEDA_CATAT_DIPAKAI_MS) return false;
  try {
    const batas = new Date(sekarang.getTime() - JEDA_CATAT_DIPAKAI_MS);
    const r = await prisma.kolCalendarFeed.updateMany({
      where: { id: feedId, revokedAt: null, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: batas } }] },
      data: { lastUsedAt: sekarang },
    });
    return r.count > 0;
  } catch (e) {
    console.error("[kalender langganan] gagal mencatat pemakaian:", e);
    return false;
  }
}
