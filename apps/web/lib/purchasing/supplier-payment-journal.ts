import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { bookedPayable, type ApLine } from "./supplier-payable";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * Payable this purchase order's receipts booked to the GL, read from the journal
 * lines themselves rather than from `PurchaseOrder.totalAmount` — paying the PO
 * total would leave an unclearable remainder whenever receipt was partial or
 * priced differently from the order.
 */
async function poBookedPayable(poId: string, client: AnyClient): Promise<number | null> {
  let apAccountId: string;
  try {
    apAccountId = await resolveAccount("AP", client);
  } catch (e) {
    if (e instanceof UnmappedRoleError) return null;
    throw e;
  }

  const grns = await client.gRN.findMany({ where: { poId }, select: { id: true } });
  if (grns.length === 0) return 0;

  const journals = await client.journal.findMany({
    where: {
      sourceType: { in: ["GRN", "GRN_REVERSAL"] },
      sourceId: { in: grns.map((g) => g.id) },
    },
    select: { sourceType: true, lines: { where: { chartAccountId: apAccountId }, select: { debit: true, credit: true } } },
  });

  const lines: ApLine[] = journals.flatMap((j) =>
    j.lines.map((l) => ({
      sourceType: j.sourceType ?? "",
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  );

  return bookedPayable(lines);
}

export async function postSupplierPaymentJournal(
  poId: string,
  postedById: string,
  paidAt: Date,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const payable = await poBookedPayable(poId, client);
  if (payable === null) return { ok: false, code: "UNMAPPED_ROLE", role: "AP" };
  if (payable < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const po = await client.purchaseOrder.findUnique({ where: { id: poId }, select: { docNumber: true } });

  return generateAutoJournal(
    client,
    "SUPPLIER_PAYMENT",
    poId,
    [
      { role: "AP" as const, debit: payable, credit: 0 },
      { role: "BANK" as const, debit: 0, credit: payable },
    ],
    { date: paidAt, description: `Supplier payment ${po?.docNumber ?? poId}`, postedById },
  );
}

export async function postSupplierPaymentReversalJournal(
  poId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const paid = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: poId } },
    select: { lines: { select: { debit: true, credit: true } } },
  });
  if (!paid) return { ok: false, code: "NOTHING_TO_POST" };

  const amount = paid.lines.reduce((sum, l) => sum + Number(l.debit), 0);
  if (amount < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const po = await client.purchaseOrder.findUnique({ where: { id: poId }, select: { docNumber: true } });

  return generateAutoJournal(
    client,
    "SUPPLIER_PAYMENT_REVERSAL",
    poId,
    [
      { role: "BANK" as const, debit: amount, credit: 0 },
      { role: "AP" as const, debit: 0, credit: amount },
    ],
    { date: new Date(), description: `Supplier payment reversal ${po?.docNumber ?? poId}`, postedById },
  );
}
