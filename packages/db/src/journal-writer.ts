import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { resolvePostingDate, PeriodClosedError, wibDayLabel, type ClosedPeriodMode } from "./period-lock";

type AnyClient = PrismaClient | Prisma.TransactionClient;

function hasTx(client: AnyClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

export class JournalError extends Error {
  constructor(
    public code: "UNBALANCED" | "TOO_FEW_LINES" | "BAD_LINE" | "NON_POSTABLE_ACCOUNT" | "PERIOD_CLOSED",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "JournalError";
  }
}

/**
 * `channel` (kanal, nilai dari `KANAL_JURNAL` di apps/web `lib/finance/journals/kanal.ts`)
 * dan `storeId` adalah dimensi laporan laba per kanal / per toko. Opsional: baris
 * tanpa dimensi tersimpan `null`, persis seperti sebelum kolomnya ada.
 */
export type JournalLineInput = {
  chartAccountId: string;
  debit: number;
  credit: number;
  memo?: string;
  channel?: string | null;
  storeId?: string | null;
};

export type PostJournalInput = {
  date: Date;
  description: string;
  postedById: string;
  source?: { type: string; id: string };
  isManual?: boolean;
  /**
   * Bawaan `POSTED`. `DRAFT` = jurnal manual menunggu persetujuan orang lain;
   * pembaca saldo/laporan WAJIB hanya menghitung `POSTED` (apps/web
   * `lib/finance/journals/status-jurnal.ts`).
   */
  status?: "POSTED" | "DRAFT";
  /** Jurnal yang dibalik oleh jurnal ini (`Journal.reversalOfId`, unik). */
  reversalOfId?: string;
  /** Tanggal asli kejadian bila `date` digeser keluar dari periode yang sudah ditutup. */
  originalDate?: Date;
  /**
   * Bila `date` jatuh di bulan yang sudah DITUTUP (`AccountingPeriod`, WIB):
   * bawaan `refuse` untuk jurnal manual dan draf (`JournalError` PERIOD_CLOSED),
   * `shift` untuk jurnal otomatis — digeser ke tanggal 1 bulan terbuka
   * berikutnya, tanggal aslinya disimpan di `originalDate` dan disebut di
   * keterangan. `allow` hanya untuk jurnal penutupan tahun itu sendiri.
   * Lihat `./period-lock.ts`.
   */
  closedPeriod?: ClosedPeriodMode;
  lines: JournalLineInput[];
};

export async function postJournal(
  client: AnyClient,
  input: PostJournalInput,
): Promise<{ journalId: string; created: boolean }> {
  const { lines } = input;
  if (lines.length < 2) throw new JournalError("TOO_FEW_LINES");

  const cents = (n: number): number => Math.round((Number(n) || 0) * 100);
  let drCents = 0,
    crCents = 0;
  const rounded = lines.map((l) => {
    const dC = cents(l.debit),
      cC = cents(l.credit);
    if ((dC > 0) === (cC > 0)) throw new JournalError("BAD_LINE", "line must be exactly one of debit/credit");
    drCents += dC;
    crCents += cC;
    return {
      chartAccountId: l.chartAccountId,
      debit: dC / 100,
      credit: cC / 100,
      memo: l.memo ?? null,
      channel: l.channel ?? null,
      storeId: l.storeId ?? null,
    };
  });
  if (drCents !== crCents) throw new JournalError("UNBALANCED", `dr=${drCents / 100} cr=${crCents / 100}`);

  const run = async (tx: Prisma.TransactionClient) => {
    if (input.source) {
      const existing = await tx.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: input.source.type, sourceId: input.source.id } },
        select: { id: true },
      });
      if (existing) return { journalId: existing.id, created: false };
    }

    // Postable check: every line account must be an active leaf (isActive AND no children).
    const ids = Array.from(new Set(lines.map((l) => l.chartAccountId)));
    const accts = await tx.chartAccount.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } });
    if (accts.length !== ids.length || accts.some((a) => !a.isActive)) throw new JournalError("NON_POSTABLE_ACCOUNT");
    const parents = await tx.chartAccount.findMany({ where: { parentId: { in: ids } }, select: { parentId: true } });
    const parentSet = new Set(parents.map((p) => p.parentId));
    if (ids.some((id) => parentSet.has(id))) throw new JournalError("NON_POSTABLE_ACCOUNT");

    /*
     * Kunci periode PALING AKHIR sebelum menulis: baris periodenya terkunci
     * sampai transaksi ini selesai, jadi makin pendek jaraknya ke commit makin
     * sebentar posting lain di bulan yang sama menunggu.
     */
    const mode: ClosedPeriodMode =
      input.closedPeriod ?? (input.isManual || input.status === "DRAFT" ? "refuse" : "shift");
    let tanggal: Awaited<ReturnType<typeof resolvePostingDate>>;
    try {
      tanggal = await resolvePostingDate(tx, input.date, mode);
    } catch (e) {
      if (e instanceof PeriodClosedError) throw new JournalError("PERIOD_CLOSED", e.message);
      throw e;
    }
    const originalDate = input.originalDate ?? tanggal.shiftedFrom ?? undefined;
    const description = tanggal.shiftedFrom
      ? `${input.description} (tanggal asli ${wibDayLabel(tanggal.shiftedFrom)}, periodenya sudah ditutup)`
      : input.description;

    const j = await tx.journal.create({
      data: {
        date: tanggal.date,
        description,
        postedById: input.postedById,
        sourceType: input.source?.type ?? null,
        sourceId: input.source?.id ?? null,
        isManual: input.isManual ?? false,
        /*
         * Kolom fondasi akuntansi hanya ikut ditulis bila diisi, supaya pemanggil
         * lama menghasilkan perintah tulis yang sama persis seperti sebelumnya
         * (aman bagi klien Prisma yang dimuat sebelum kolomnya ada).
         */
        ...(input.status ? { status: input.status } : {}),
        ...(input.reversalOfId ? { reversalOfId: input.reversalOfId } : {}),
        ...(originalDate ? { originalDate } : {}),
        lines: {
          create: rounded.map((l) => ({
            chartAccountId: l.chartAccountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo,
            ...(l.channel ? { channel: l.channel } : {}),
            ...(l.storeId ? { storeId: l.storeId } : {}),
          })),
        },
      },
      select: { id: true },
    });
    return { journalId: j.id, created: true };
  };

  return hasTx(client) ? client.$transaction(run) : run(client as Prisma.TransactionClient);
}
