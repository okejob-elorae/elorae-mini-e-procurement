import { prisma } from "@elorae/db";
import { bacaRiwayatPengiriman, type RiwayatPengiriman } from "./formulir-kol-aturan";

/** Kartu "Link formulir data" di profil KOL — KHUSUS SERVER (klien hanya `import type`). */

export type LinkFormulirRingkas = { id: string; berlakuSampai: string; dibuat: string; terakhirDibuka: string | null };

export type KirimanFormulirRingkas = RiwayatPengiriman & {
  id: string;
  dikirim: string;
  menimpa: number;
  dicek: string | null;
};

export type RingkasFormulirKol = { linkAktif: LinkFormulirRingkas | null; kiriman: KirimanFormulirRingkas[] };

export const BATAS_KIRIMAN_DITAMPILKAN = 10;

export async function ringkasFormulirKol(kolId: string, sekarang: Date = new Date()): Promise<RingkasFormulirKol> {
  const [link, kiriman] = await Promise.all([
    prisma.kolFormLink.findFirst({
      where: { kolId, revokedAt: null, expiresAt: { gt: sekarang } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, expiresAt: true, createdAt: true, lastUsedAt: true },
    }),
    prisma.kolFormSubmission.findMany({
      where: { kolId },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: BATAS_KIRIMAN_DITAMPILKAN,
      select: { id: true, submittedAt: true, changes: true, replacedCount: true, reviewedAt: true },
    }),
  ]);
  return {
    linkAktif: link
      ? { id: link.id, berlakuSampai: link.expiresAt.toISOString(), dibuat: link.createdAt.toISOString(), terakhirDibuka: link.lastUsedAt?.toISOString() ?? null }
      : null,
    kiriman: kiriman.map((s) => ({
      id: s.id,
      dikirim: s.submittedAt.toISOString(),
      menimpa: s.replacedCount,
      dicek: s.reviewedAt?.toISOString() ?? null,
      ...bacaRiwayatPengiriman(s.changes),
    })),
  };
}

/** Bahan kelompok Hari ini "Data dari KOL": kiriman yang belum ditandai dicek. */
export type KirimanTugas = {
  id: string;
  kolId: string;
  kolNama: string;
  handle: string | null;
  waNormal: string | null;
  dikirim: Date;
  jumlahKolom: number;
  menimpa: number;
  npwpBaru: boolean;
};

export async function kirimanBelumDicekTugas(cakupan?: { kirimanIds?: readonly string[] }): Promise<KirimanTugas[]> {
  const baris = await prisma.kolFormSubmission.findMany({
    where: { reviewedAt: null, ...(cakupan?.kirimanIds ? { id: { in: [...cakupan.kirimanIds] } } : {}) },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    take: 200,
    select: { id: true, kolId: true, submittedAt: true, changes: true, replacedCount: true },
  });
  if (!baris.length) return [];
  const kol = await prisma.kol.findMany({
    where: { id: { in: [...new Set(baris.map((b) => b.kolId))] } },
    select: { id: true, name: true, waNormal: true, accounts: { select: { handle: true, followers: true }, orderBy: [{ followers: "desc" }, { id: "asc" }], take: 1 } },
  });
  const perId = new Map(kol.map((k) => [k.id, k]));
  const hasil: KirimanTugas[] = [];
  for (const b of baris) {
    const k = perId.get(b.kolId);
    // relationMode = prisma: kiriman milik KOL yang sudah dihapus dilewati, tidak merobohkan Hari ini.
    if (!k) continue;
    const r = bacaRiwayatPengiriman(b.changes);
    hasil.push({
      id: b.id,
      kolId: k.id,
      kolNama: k.name,
      handle: k.accounts[0]?.handle ?? null,
      waNormal: k.waNormal,
      dikirim: b.submittedAt,
      jumlahKolom: r.perubahan.length + r.sensitif.length,
      menimpa: b.replacedCount,
      npwpBaru: r.npwpBaru,
    });
  }
  return hasil;
}
