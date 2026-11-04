import { prisma, type AdminNotification } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import {
  dokumenJurnal,
  metadataNotifikasi,
  sumberNotifikasiJurnal,
  tandaiJurnalTertundaSelesai,
} from "@/lib/finance/jurnal-tertunda";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";

/*
 * Penulis `JOURNAL_PENDING` untuk posting yang dijalankan SAPUAN (bukan
 * tombol/aksi sumbernya). Metadata harus berbentuk sama dengan yang ditulis
 * aksi sumbernya, supaya `sumberNotifikasiJurnal` mengenalinya, tab Tertunda
 * menautkannya, dan posting ulang yang berhasil menyelesaikannya.
 */

function kunciSumber(metadata: unknown): string | null {
  const s = sumberNotifikasiJurnal(metadata);
  if (!s) return null;
  if (s.tipe === "dokumen") return `d|${s.sourceType}|${s.sourceId}`;
  if (s.tipe === "kolaborasiKol") return `k|${s.kolaborasiId}`;
  return `p|${s.arah}|${s.poId}`;
}

/**
 * Menulis satu `JOURNAL_PENDING` kecuali sudah ada yang belum selesai untuk
 * dokumen dan sebab yang sama. Tidak pernah melempar.
 */
export async function catatGagalSapuan(isi: {
  metadata: Record<string, unknown> & { reason: string };
  judul: string;
  pesan: string;
}): Promise<void> {
  let baris: AdminNotification | null = null;
  try {
    const kunci = kunciSumber(isi.metadata);
    const belum = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING", readAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { metadata: true },
    });
    const sudahAda = belum.some((n) => {
      const m = metadataNotifikasi(n.metadata);
      return kunci != null && kunciSumber(m) === kunci && m.reason === isi.metadata.reason;
    });
    if (sudahAda) return;
    baris = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: isi.judul,
        message: isi.pesan,
        metadata: { ...isi.metadata, olehSapuan: true },
      },
    });
  } catch (e) {
    console.error("[sapuan] gagal menulis JOURNAL_PENDING", isi.metadata, e);
  }
  if (baris) void fanOutAdminNotification(baris);
}

/**
 * Menyelesaikan hasil posting sapuan: berhasil → tanda tertundanya diselesaikan;
 * gagal (selain nihil) → `JOURNAL_PENDING` ditulis. Mengembalikan hasilnya apa adanya.
 */
export async function selesaikanHasilSapuan(
  hasil: GenerateAutoJournalResult,
  sumber: { sourceType: string; sourceId: string },
  gagal: (kode: string, peran: string | null) => { metadata: Record<string, unknown>; judul: string; pesan: string },
): Promise<GenerateAutoJournalResult> {
  if (hasil.ok) {
    await tandaiJurnalTertundaSelesai([dokumenJurnal(sumber.sourceType, sumber.sourceId)]);
    return hasil;
  }
  if (hasil.code !== "NOTHING_TO_POST") {
    const peran = "role" in hasil ? (hasil.role ?? null) : null;
    const g = gagal(hasil.code, peran);
    await catatGagalSapuan({ metadata: { ...g.metadata, reason: hasil.code, role: peran }, judul: g.judul, pesan: g.pesan });
  }
  return hasil;
}
