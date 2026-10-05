import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { TaxInvoiceError } from "./errors";

/**
 * Nomor Seri Faktur Pajak (NSFP) yang diterima, setelah spasi dan tanda baca
 * dibuang — sengaja longgar, yang ditolak hanya yang jelas bukan NSFP:
 *  - 16 digit, e-Faktur lama: `010.000-24.00000001` = 2 digit kode transaksi,
 *    1 digit status (0 normal, 1 pengganti), lalu 13 digit NSFP alokasi DJP
 *    (3 kode cabang, 2 tahun, 8 nomor urut);
 *  - 13 digit, NSFP alokasi itu sendiri tanpa kode transaksi: `000-24.00000001`;
 *  - 17 digit, nomor faktur Coretax (2025+);
 *  - 14–15 digit ikut diterima karena tidak ada alasan kuat menolaknya.
 * Huruf, kurang dari 13 digit, atau lebih dari 17 digit ditolak.
 */
const PANJANG_MIN_NSFP = 13;
const PANJANG_MAKS_NSFP = 17;

export function normalisasiNomorFaktur(nomor: string): string {
  return nomor.replace(/[\s.,\-/_]/g, "");
}

export function periksaFormatNomorFaktur(nomor: string): boolean {
  const n = normalisasiNomorFaktur(nomor);
  return /^[0-9]+$/.test(n) && n.length >= PANJANG_MIN_NSFP && n.length <= PANJANG_MAKS_NSFP;
}

/**
 * Kunci pembanding "NSFP yang sama". Untuk 16 digit, 3 digit depan (kode
 * transaksi + status) dibuang: faktur pengganti `011.` memakai NSFP yang sama
 * dengan `010.`, dan 13 digit sisanya sama dengan NSFP alokasi. Panjang lain
 * (termasuk Coretax 17 digit) dibandingkan utuh.
 */
export function kunciNomorFaktur(nomor: string): string {
  const n = normalisasiNomorFaktur(nomor);
  return n.length === 16 ? n.slice(3) : n;
}

/**
 * Nomor faktur ditolak. `code` tetap `INVALID_REQUEST` agar aksi dan layar yang
 * ada memetakannya tanpa diubah; `sebab` membedakan format vs ganda.
 */
export class NomorFakturError extends TaxInvoiceError {
  constructor(
    readonly sebab: "FORMAT" | "GANDA",
    readonly dipakai: { taxInvoiceId: string; deliveryId: string; invoiceNo: string } | null = null,
  ) {
    super("INVALID_REQUEST");
    this.name = "NomorFakturError";
  }
}

/** Tolak NSFP yang sudah menempel di TaxInvoice lain berstatus CREATED. Dipanggil di dalam transaksi serializable. */
async function tolakNomorGanda(tx: Prisma.TransactionClient, taxInvoiceId: string, invoiceNo: string): Promise<void> {
  const kunci = kunciNomorFaktur(invoiceNo);
  // Semua nomor CREATED dibandingkan setelah dinormalisasi di JS. Jangan menyempit
  // dengan `contains` potongan nomor: nomor tersimpan apa adanya, jadi tanda baca
  // yang memotong potongan itu (`…000000.01`) meloloskan nomor yang sama.
  const calon = await tx.taxInvoice.findMany({
    where: { status: "CREATED", id: { not: taxInvoiceId }, invoiceNo: { not: null } },
    select: { id: true, deliveryId: true, invoiceNo: true },
  });
  const sama = calon.find((c) => c.invoiceNo !== null && kunciNomorFaktur(c.invoiceNo) === kunci);
  if (sama && sama.invoiceNo !== null) {
    throw new NomorFakturError("GANDA", { taxInvoiceId: sama.id, deliveryId: sama.deliveryId, invoiceNo: sama.invoiceNo });
  }
}

type Transition = {
  taxInvoiceId: string;
  userId: string;
  from: Array<"PENDING" | "CREATED" | "NOT_REQUIRED">;
  to: "PENDING" | "CREATED" | "NOT_REQUIRED";
  data: { invoiceNo: string | null; reason: string | null; markedAt: Date | null; markedById: string | null };
  action: string;
  /** Pemeriksaan tambahan di dalam transaksi yang sama, sebelum baris diubah. */
  periksa?: (tx: Prisma.TransactionClient) => Promise<void>;
};

async function transition(t: Transition): Promise<{ ok: true }> {
  return runSerializable(async (tx) => {
    const row = await tx.taxInvoice.findUnique({
      where: { id: t.taxInvoiceId },
      select: { id: true, status: true, invoiceNo: true, reason: true },
    });
    if (!row) throw new TaxInvoiceError("NOT_FOUND");
    if (!t.from.includes(row.status)) throw new TaxInvoiceError("INVALID_STATE");
    if (t.periksa) await t.periksa(tx);

    const swapped = await tx.taxInvoice.updateMany({
      where: { id: t.taxInvoiceId, status: row.status },
      data: { status: t.to, ...t.data },
    });
    if (swapped.count !== 1) throw new TaxInvoiceError("CONFLICT");

    /**
     * `TaxInvoice.status`, `invoiceNo` and `reason` are all last-write-wins, so every transition
     * overwrites the previous one — mark NOT_REQUIRED with a justification, revert it, mark
     * CREATED with a faktur number, revert again, and both the justification and the number are
     * gone from the row with no trace anywhere. The before/after pair plus the operator's reason
     * is what makes this an audit trail rather than a list of timestamps, and it is written inside
     * the same transaction as the update, exactly as nota-date correction does.
     */
    await tx.auditLog.create({
      data: {
        userId: t.userId,
        action: t.action,
        entityType: "TaxInvoice",
        entityId: t.taxInvoiceId,
        changes: {
          before: { status: row.status, invoiceNo: row.invoiceNo, reason: row.reason },
          after: { status: t.to, invoiceNo: t.data.invoiceNo, reason: t.data.reason },
        },
        reason: t.data.reason,
      },
    });

    return { ok: true };
  });
}

export async function markTaxInvoiceCreated(input: {
  taxInvoiceId: string;
  invoiceNo: string;
  userId: string;
}): Promise<{ ok: true }> {
  const invoiceNo = input.invoiceNo.trim();
  if (invoiceNo === "") throw new TaxInvoiceError("INVALID_REQUEST");
  if (!periksaFormatNomorFaktur(invoiceNo)) throw new NomorFakturError("FORMAT");
  return transition({
    taxInvoiceId: input.taxInvoiceId,
    userId: input.userId,
    from: ["PENDING"],
    to: "CREATED",
    data: { invoiceNo, reason: null, markedAt: new Date(), markedById: input.userId },
    action: "TAX_INVOICE_CREATED",
    // NSFP tidak unik di skema: penjaganya di sini, di transaksi serializable yang sama dengan penulisannya.
    periksa: (tx) => tolakNomorGanda(tx, input.taxInvoiceId, invoiceNo),
  });
}

export async function markTaxInvoiceNotRequired(input: {
  taxInvoiceId: string;
  reason: string;
  userId: string;
}): Promise<{ ok: true }> {
  const reason = input.reason.trim();
  if (reason === "") throw new TaxInvoiceError("INVALID_REQUEST");
  return transition({
    taxInvoiceId: input.taxInvoiceId,
    userId: input.userId,
    from: ["PENDING"],
    to: "NOT_REQUIRED",
    data: { invoiceNo: null, reason, markedAt: new Date(), markedById: input.userId },
    action: "TAX_INVOICE_NOT_REQUIRED",
  });
}

export async function revertTaxInvoiceToPending(input: {
  taxInvoiceId: string;
  reason: string;
  userId: string;
}): Promise<{ ok: true }> {
  const reason = input.reason.trim();
  if (reason === "") throw new TaxInvoiceError("INVALID_REQUEST");
  return transition({
    taxInvoiceId: input.taxInvoiceId,
    userId: input.userId,
    from: ["CREATED", "NOT_REQUIRED"],
    to: "PENDING",
    data: { invoiceNo: null, reason, markedAt: null, markedById: null },
    action: "TAX_INVOICE_REVERTED",
  });
}
