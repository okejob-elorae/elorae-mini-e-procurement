import { prisma, JournalError, type AdminNotification } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { dokumenJurnal, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { postFgReceiptJournal } from "./fg-receipt-journal";

/*
 * Pembungkus "aman" jurnal penerimaan barang jadi. Berkas terpisah dari
 * penulisnya (`./fg-receipt-journal.ts`) supaya tes yang meniru penulis jurnal
 * tetap menjalankan penanda JOURNAL_PENDING yang asli.
 */

const SUMBER = "FG_RECEIPT";

export type HasilPostingPenerimaanFG =
  | GenerateAutoJournalResult
  | { ok: false; code: "NON_POSTABLE_ACCOUNT" | "ERROR"; pesan?: string };

/**
 * Posting jurnal penerimaan barang jadi TANPA pernah melempar — dipakai
 * `receiveFG` (sesudah commit), tombol "Post journal" di halaman WO, dan
 * sapuan dokumen tanpa jurnal. Berhasil → tanda "Jurnal gagal" penerimaan ini
 * diselesaikan; gagal (selain NOTHING_TO_POST) → `JOURNAL_PENDING` ditulis
 * (paling banyak satu yang belum dibaca per penerimaan + sebab).
 */
export async function postFgReceiptJournalAman(
  receiptId: string,
  postedById: string,
): Promise<HasilPostingPenerimaanFG> {
  let hasil: HasilPostingPenerimaanFG;
  try {
    hasil = await postFgReceiptJournal(receiptId, postedById);
  } catch (e) {
    const code = e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT" ? "NON_POSTABLE_ACCOUNT" : "ERROR";
    hasil = { ok: false, code, pesan: e instanceof Error ? e.message : "unknown" };
  }
  if (hasil.ok) {
    await tandaiJurnalTertundaSelesai([dokumenJurnal(SUMBER, receiptId)]);
    return hasil;
  }
  if (hasil.code !== "NOTHING_TO_POST") {
    const role = "role" in hasil ? (hasil.role ?? null) : null;
    const pesan = "pesan" in hasil ? hasil.pesan : undefined;
    await tandaiTertunda(receiptId, hasil.code, role, pesan);
  }
  return hasil;
}

async function tandaiTertunda(receiptId: string, reason: string, role: string | null, pesan?: string): Promise<void> {
  let baris: AdminNotification | null = null;
  try {
    const receipt = await prisma.fGReceipt.findUnique({
      where: { id: receiptId },
      select: { docNumber: true, woId: true },
    });
    // Pencocokan metadata di JS: penyaringan JSON-path tidak andal di adaptor MariaDB.
    const belum = await prisma.adminNotification.findMany({
      where: { category: "JOURNAL_PENDING", readAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { metadata: true },
    });
    const sudahAda = belum.some((n) => {
      const m = n.metadata as { receiptId?: unknown; kind?: unknown; reason?: unknown } | null;
      return m?.receiptId === receiptId && m?.kind === "fg_receipt" && m?.reason === reason;
    });
    if (sudahAda) return;
    const nomor = receipt?.docNumber ?? receiptId;
    baris = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `Jurnal penerimaan barang jadi ${nomor} belum diposting`,
        message: `Jurnal penerimaan barang jadi ${nomor} gagal diposting (${reason}${role ? `: ${role}` : ""}${pesan ? `: ${pesan}` : ""}). Petakan akunnya di Keuangan → Pemetaan Akun, lalu posting ulang dari halaman perintah kerja.`,
        metadata: {
          receiptId,
          woId: receipt?.woId ?? null,
          docNumber: receipt?.docNumber ?? null,
          kind: "fg_receipt",
          reason,
          role,
        },
      },
    });
  } catch (e) {
    console.error(
      `[postFgReceiptJournalAman] gagal menulis JOURNAL_PENDING untuk penerimaan ${receiptId} — jurnalnya belum ada; sapuan dokumen tanpa jurnal akan menemukannya.`,
      e,
    );
  }
  if (baris) void fanOutAdminNotification(baris);
}
