import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { bookedPayable, type ApLine } from "./supplier-payable";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * `postSupplierPaymentJournal` can fail a way the shared `GenerateAutoJournalResult`
 * has no code for: GRN journals exist for this PO, but none of their lines sit on
 * the currently-resolved AP account. That happens if `AP` is remapped to a
 * different chart account between receipt and payment — the historical journal
 * lines still point at the old account, so a plain amount-based read would come
 * back zero and silently look like "nothing to post". `AP_ACCOUNT_MISMATCH`
 * keeps that distinct from the benign zero cases (no GRNs yet, GRNs never
 * journaled, net payable already cleared) so a caller can raise it loudly
 * instead of reporting success.
 */
export type PostSupplierPaymentResult = GenerateAutoJournalResult | { ok: false; code: "AP_ACCOUNT_MISMATCH" };

type PayableLookup =
  | { ok: true; payable: number }
  | { ok: false; code: "UNMAPPED_ROLE"; role: "AP" }
  | { ok: false; code: "NOTHING_TO_POST" }
  | { ok: false; code: "AP_ACCOUNT_MISMATCH" };

/**
 * Payable this purchase order's receipts booked to the GL, read from the journal
 * lines themselves rather than from `PurchaseOrder.totalAmount` — paying the PO
 * total would leave an unclearable remainder whenever receipt was partial or
 * priced differently from the order.
 */
async function poBookedPayable(poId: string, client: AnyClient): Promise<PayableLookup> {
  let apAccountId: string;
  try {
    apAccountId = await resolveAccount("AP", client);
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: "AP" };
    throw e;
  }

  const grns = await client.gRN.findMany({ where: { poId }, select: { id: true } });
  if (grns.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  const journals = await client.journal.findMany({
    where: {
      sourceType: { in: ["GRN", "GRN_REVERSAL"] },
      sourceId: { in: grns.map((g) => g.id) },
    },
    select: { sourceType: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
  });

  /* No GRN journals posted at all yet is the benign, expected case (a GRN can sit
     un-journaled for a while) — distinct from journals existing but missing the
     currently-mapped AP account below. */
  if (journals.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  const apLines: ApLine[] = journals.flatMap((j) =>
    j.lines
      .filter((l) => l.chartAccountId === apAccountId)
      .map((l) => ({ sourceType: j.sourceType ?? "", debit: Number(l.debit), credit: Number(l.credit) })),
  );

  if (apLines.length === 0) return { ok: false, code: "AP_ACCOUNT_MISMATCH" };

  const payable = bookedPayable(apLines);
  if (payable < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  return { ok: true, payable };
}

/**
 * Number of mark/unmark cycles already completed for this PO, counted from the
 * reversal journals rather than the payment journals. A payment is keyed
 * `poId#gen`; a reversal targets and is itself keyed at the same `poId#gen` it
 * reverses. Counting reversals means a plain retry of the SAME mark (no
 * intervening unmark) sees the same count and resolves to the same generation
 * — so `generateAutoJournal`'s idempotency still holds — while a genuine
 * unmark-then-re-mark cycle bumps the count and opens a fresh generation.
 * Counting payments instead would break that: a retry would see one more
 * payment than reversals and post a duplicate.
 */
async function currentGeneration(poId: string, client: AnyClient): Promise<number> {
  const reversalCount = await client.journal.count({
    where: { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: { startsWith: `${poId}#` } },
  });
  return reversalCount + 1;
}

export async function postSupplierPaymentJournal(
  poId: string,
  postedById: string,
  paidAt: Date,
  client: AnyClient = prisma,
): Promise<PostSupplierPaymentResult> {
  const lookup = await poBookedPayable(poId, client);
  if (!lookup.ok) return lookup;

  const gen = await currentGeneration(poId, client);
  const sourceId = `${poId}#${gen}`;
  const po = await client.purchaseOrder.findUnique({ where: { id: poId }, select: { docNumber: true } });

  return generateAutoJournal(
    client,
    "SUPPLIER_PAYMENT",
    sourceId,
    [
      { role: "AP" as const, debit: lookup.payable, credit: 0 },
      { role: "BANK" as const, debit: 0, credit: lookup.payable },
    ],
    { date: paidAt, description: `Supplier payment ${po?.docNumber ?? poId}`, postedById },
  );
}

export async function postSupplierPaymentReversalJournal(
  poId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const gen = await currentGeneration(poId, client);
  const sourceId = `${poId}#${gen}`;

  const paid = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId } },
    select: { lines: { select: { debit: true, credit: true } } },
  });
  if (!paid) return { ok: false, code: "NOTHING_TO_POST" };

  const amount = paid.lines.reduce((sum, l) => sum + Number(l.debit), 0);
  if (amount < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const po = await client.purchaseOrder.findUnique({ where: { id: poId }, select: { docNumber: true } });

  return generateAutoJournal(
    client,
    "SUPPLIER_PAYMENT_REVERSAL",
    sourceId,
    [
      { role: "BANK" as const, debit: amount, credit: 0 },
      { role: "AP" as const, debit: 0, credit: amount },
    ],
    { date: new Date(), description: `Supplier payment reversal ${po?.docNumber ?? poId}`, postedById },
  );
}
