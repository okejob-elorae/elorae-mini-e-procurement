import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/** The WO step part of a bill: PO lines carry no journal, their payable was booked at GRN. */
async function serviceAmount(billId: string, client: AnyClient) {
  const bill = await client.vendorBill.findUnique({
    where: { id: billId },
    select: { docNumber: true, vendorInvoiceNo: true, billDate: true, lines: { where: { type: "WO_STEP" }, select: { amount: true } } },
  });
  if (!bill) return null;
  const amount = Math.round(bill.lines.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
  return { ...bill, amount };
}

/** Dr PRODUCTION_SERVICE_COST / Cr AP for the bill's WO step lines. Idempotent by bill id. */
export async function postVendorBillJournal(
  billId: string,
  postedById: string,
  client: AnyClient = prisma
): Promise<GenerateAutoJournalResult> {
  const bill = await serviceAmount(billId, client);
  if (!bill || bill.amount < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    "VENDOR_BILL",
    billId,
    [
      { role: "PRODUCTION_SERVICE_COST", debit: bill.amount, credit: 0 },
      { role: "AP", debit: 0, credit: bill.amount },
    ],
    { date: bill.billDate, description: `Vendor bill ${bill.docNumber} (${bill.vendorInvoiceNo})`, postedById }
  );
}

/** Mirror of the bill journal, posted only against one that exists. */
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
