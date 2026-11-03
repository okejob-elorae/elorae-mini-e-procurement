import type { Prisma, PrismaClient } from "@elorae/db";
import { generateAutoJournal, type AutoJournalLine, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { SUMBER_JURNAL_KOREKSI_UTANG, SUMBER_JURNAL_KOREKSI_UTANG_BALIK } from "./koreksi-utang-queries";

export { SUMBER_JURNAL_KOREKSI_UTANG, SUMBER_JURNAL_KOREKSI_UTANG_BALIK };

type AnyClient = PrismaClient | Prisma.TransactionClient;

/*
 * Jurnal koreksi utang pemasok (selisih harga invoice yang diterima, keputusan pemilik 2026-11-02,
 * P27/P49/P53) dan pembaliknya saat tagihannya dibatalkan. Idempoten per koreksi (`generateAutoJournal`,
 * sumber + id koreksi). Barisnya disusun `barisJurnalKoreksiUtang` / `barisJurnalBalikKoreksiUtang`
 * (`koreksi-utang-aturan.ts`). Periode tertutup menggeser tanggalnya seperti jurnal otomatis lain.
 */

export function postKoreksiUtangJournal(
  tx: AnyClient,
  a: { koreksiId: string; baris: AutoJournalLine[]; tanggal: Date; keterangan: string; olehUserId: string },
): Promise<GenerateAutoJournalResult> {
  return generateAutoJournal(tx, SUMBER_JURNAL_KOREKSI_UTANG, a.koreksiId, a.baris, {
    date: a.tanggal,
    description: a.keterangan,
    postedById: a.olehUserId,
  });
}

export function postKoreksiUtangReversalJournal(
  tx: AnyClient,
  a: { koreksiId: string; baris: AutoJournalLine[]; tanggal: Date; keterangan: string; olehUserId: string },
): Promise<GenerateAutoJournalResult> {
  return generateAutoJournal(tx, SUMBER_JURNAL_KOREKSI_UTANG_BALIK, a.koreksiId, a.baris, {
    date: a.tanggal,
    description: a.keterangan,
    postedById: a.olehUserId,
  });
}
