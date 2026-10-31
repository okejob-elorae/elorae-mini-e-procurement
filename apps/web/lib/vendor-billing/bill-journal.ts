import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/*
 * A vendor bill posts NO journal. The supplier's payable is booked once, when the goods arrive: at
 * the GRN for PO lines (`postGrnJournal`), and at the finished-goods receipt for CMT and other WO
 * step work (`postFgReceiptJournal`, Cr AP = `FGReceipt.serviceCost`). The bill is the matching
 * record on top of those receipts — the vendor's invoice number, its due date, and the billed price
 * beside the PO price or the step's service price (`refPrice`), so a price variance is visible. It
 * never books a second payable for goods or work already on the books.
 *
 * Bills saved before that rule posted Dr PRODUCTION_SERVICE_COST / Cr AP for their WO step lines
 * (`VENDOR_BILL`). Those journals stay where they are, and voiding such a bill still reverses the
 * one it posted; a bill with no journal reverses nothing.
 */

/** The WO step part of a bill — what a pre-rule bill journal posted. */
async function serviceAmount(billId: string, client: AnyClient) {
  const bill = await client.vendorBill.findUnique({
    where: { id: billId },
    select: { docNumber: true, vendorInvoiceNo: true, billDate: true, lines: { where: { type: "WO_STEP" }, select: { amount: true } } },
  });
  if (!bill) return null;
  const amount = Math.round(bill.lines.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
  return { ...bill, amount };
}

/** Mirror of a pre-rule bill journal, posted only against one that exists. */
export async function postVendorBillReversalJournal(
  billId: string,
  postedById: string,
  client: AnyClient = prisma
): Promise<GenerateAutoJournalResult> {
  const original = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "VENDOR_BILL", sourceId: billId } },
    select: { id: true },
  });
  if (!original) return { ok: false, code: "NOTHING_TO_POST" };
  const bill = await serviceAmount(billId, client);
  if (!bill || bill.amount < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    "VENDOR_BILL_REVERSAL",
    billId,
    [
      { role: "AP", debit: bill.amount, credit: 0 },
      { role: "PRODUCTION_SERVICE_COST", debit: 0, credit: bill.amount },
    ],
    { date: new Date(), description: `Vendor bill void ${bill.docNumber} (${bill.vendorInvoiceNo})`, postedById }
  );
}
