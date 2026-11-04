import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/*
 * A vendor bill books no payable for goods or work a receipt already booked. The supplier's payable
 * is booked once, when the goods arrive: at the GRN for PO lines (`postGrnJournal`), and at the
 * finished-goods receipt for CMT and other WO step work (`postFgReceiptJournal`, Cr AP =
 * `FGReceipt.serviceCost`). For those the bill is the matching record on top of the receipts — the
 * vendor's invoice number, its due date, and the billed price beside the PO price or the step's
 * service price (`refPrice`), so a price variance is visible.
 *
 * The exception is step work from a finished-goods receipt that booked nothing: one received before
 * receipts started booking CMT (`serviceCost` null), which nothing backfills. For those pieces the
 * bill is the only place the CMT can reach the books, so it posts Dr PRODUCTION_SERVICE_COST / Cr AP
 * (`VENDOR_BILL`) for exactly them — what every bill posted for its step lines before the rule.
 * `createVendorBill` works out the pieces; a bill whose step work receipts booked posts nothing.
 * Voiding a bill mirrors whatever journal it posted.
 */

/** Dr PRODUCTION_SERVICE_COST / Cr AP for the step work on a bill that no receipt booked. Idempotent by bill id. */
export async function postVendorBillJournal(
  billId: string,
  amount: number,
  postedById: string,
  client: AnyClient = prisma
): Promise<GenerateAutoJournalResult> {
  if (amount < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const bill = await client.vendorBill.findUnique({
    where: { id: billId },
    select: { docNumber: true, vendorInvoiceNo: true, billDate: true },
  });
  if (!bill) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    "VENDOR_BILL",
    billId,
    [
      { role: "PRODUCTION_SERVICE_COST", debit: amount, credit: 0 },
      { role: "AP", debit: 0, credit: amount },
    ],
    { date: bill.billDate, description: `Vendor bill ${bill.docNumber} (${bill.vendorInvoiceNo})`, postedById }
  );
}

/**
 * Mirrors the bill's journal as posted (debit and credit swapped on the same chart account), dated
 * on `voidedAt`, like `postVendorPaymentReversalJournal`. A bill whose step lines a receipt partly
 * booked posted only the rest, so the reversal reads the journal, never the bill lines, and a role
 * re-pointed since cannot move it onto another account. A bill that posted nothing reverses nothing.
 */
export async function postVendorBillReversalJournal(
  billId: string,
  postedById: string,
  client: AnyClient = prisma
): Promise<GenerateAutoJournalResult> {
  const original = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "VENDOR_BILL", sourceId: billId } },
    select: { lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
  });
  if (!original || original.lines.length === 0) return { ok: false, code: "NOTHING_TO_POST" };
  const bill = await client.vendorBill.findUnique({
    where: { id: billId },
    select: { docNumber: true, vendorInvoiceNo: true, voidedAt: true },
  });
  if (!bill) return { ok: false, code: "NOTHING_TO_POST" };
  try {
    const res = await postJournal(client, {
      source: { type: "VENDOR_BILL_REVERSAL", id: billId },
      date: bill.voidedAt ?? new Date(),
      description: `Vendor bill void ${bill.docNumber} (${bill.vendorInvoiceNo})`,
      postedById,
      lines: original.lines.map((l) => ({
        chartAccountId: l.chartAccountId,
        debit: Number(l.credit),
        credit: Number(l.debit),
        ...(l.memo ? { memo: l.memo } : {}),
      })),
    });
    return { ok: true, journalId: res.journalId, created: res.created };
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}
