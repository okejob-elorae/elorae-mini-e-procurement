import { prisma } from "@elorae/db";
import { ringkasPatokan, sampelPatokan, type KolaborasiPatokan, type PatokanHarga } from "./patokan-harga";
import type { Tahap } from "./tahap";

/*
 * Patokan harga per 1.000 views dari kolaborasi berbayar Elorae — KHUSUS SERVER (aturannya di
 * `patokan-harga.ts`). Dibaca panel ekstensi lewat GET /api/kreatif/ekstensi/patokan.
 * `kolaborasiIds` hanya untuk tes yang berbagi basis data.
 */

const TAHAP_FEE_DIAKUI = ["TAYANG", "ANGKA_MASUK", "DIBAYAR", "SELESAI"] as const;

export async function patokanHargaKol(opsi: { kolaborasiIds?: readonly string[] } = {}): Promise<PatokanHarga> {
  const baris = await prisma.kolBrief.findMany({
    where: { tahap: { in: [...TAHAP_FEE_DIAKUI] }, ...(opsi.kolaborasiIds ? { id: { in: [...opsi.kolaborasiIds] } } : {}) },
    select: {
      id: true,
      tahap: true,
      fee: true,
      terms: { select: { status: true, bruto: true, neto: true, grossUp: true } },
      kolContents: {
        where: { platform: "TIKTOK", format: "VIDEO" },
        select: {
          platform: true,
          format: true,
          liveAt: true,
          metrics: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1, select: { recordedAt: true, views: true } },
        },
      },
    },
  });
  const kolaborasi: KolaborasiPatokan[] = baris.map((b) => ({
    id: b.id,
    tahap: b.tahap as Tahap,
    fee: Number(b.fee),
    termin: b.terms.map((t) => ({ status: t.status, bruto: Number(t.bruto), neto: Number(t.neto), grossUp: t.grossUp })),
    konten: b.kolContents.map((c) => ({
      platform: c.platform,
      format: c.format,
      liveAt: c.liveAt,
      angkaTerakhir: c.metrics[0] ? { recordedAt: c.metrics[0].recordedAt, views: c.metrics[0].views } : null,
    })),
  }));
  return ringkasPatokan(sampelPatokan(kolaborasi));
}
