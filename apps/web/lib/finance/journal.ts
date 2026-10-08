import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import type { PostingRole } from "@/lib/constants/journal-roles";
import type { KanalJurnal } from "@/lib/finance/journals/kanal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * `memo` (opsional) ikut tersimpan di `JournalLine.memo`. Jurnal KOL menandai
 * setiap barisnya dengan nama perannya, supaya saldo per kolaborasi bisa
 * dihitung ulang dari jurnalnya sendiri walau pemetaan akun berubah kemudian.
 *
 * `channel` (`KANAL_JURNAL`, `lib/finance/journals/kanal.ts`) dan `storeId`
 * adalah dimensi laba per kanal / per toko: isi pada baris pendapatan, HPP,
 * dan beban penjualan. Opsional — baris tanpa dimensi tersimpan null.
 */
export type AutoJournalLine = {
  role: PostingRole;
  debit: number;
  credit: number;
  memo?: string;
  channel?: KanalJurnal | null;
  storeId?: string | null;
};

export type GenerateAutoJournalResult =
  | { ok: true; journalId: string; created: boolean }
  | { ok: false; code: "UNMAPPED_ROLE" | "UNBALANCED" | "NOTHING_TO_POST"; role?: string };

/**
 * Jurnal otomatis untuk satu dokumen sumber, idempoten per (sourceType, sourceId).
 *
 * Periode tertutup (bagian A1, keputusan sementara pemilik no. 38): bila
 * `meta.date` jatuh di bulan yang sudah ditutup, jurnalnya DIGESER ke tanggal 1
 * bulan terbuka berikutnya — `Journal.originalDate` menyimpan tanggal asli dan
 * keterangannya menyebutnya. Dokumen yang terlambat dicatat tidak pernah gagal
 * hanya karena bulannya sudah ditutup, dan bulan yang sudah dilaporkan tidak
 * pernah berubah. Penguncian dan penggeseran ada di `postJournal`
 * (`packages/db/src/period-lock.ts`), jadi pemanggil `postJournal` langsung
 * mendapat aturan yang sama.
 */
export async function generateAutoJournal(
  client: AnyClient = prisma,
  sourceType: string,
  sourceId: string,
  lines: AutoJournalLine[],
  meta: { date: Date; description: string; postedById: string },
): Promise<GenerateAutoJournalResult> {
  if (lines.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  const roleToId = new Map<PostingRole, string>();
  try {
    for (const role of new Set(lines.map((l) => l.role))) roleToId.set(role, await resolveAccount(role, client));
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
    throw e;
  }

  try {
    const res = await postJournal(client, {
      source: { type: sourceType, id: sourceId },
      date: meta.date,
      description: meta.description,
      postedById: meta.postedById,
      closedPeriod: "shift",
      lines: lines.map((l) => ({
        chartAccountId: roleToId.get(l.role)!,
        debit: l.debit,
        credit: l.credit,
        ...(l.memo ? { memo: l.memo } : {}),
        ...(l.channel ? { channel: l.channel } : {}),
        ...(l.storeId ? { storeId: l.storeId } : {}),
      })),
    });
    return { ok: true, journalId: res.journalId, created: res.created };
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}
