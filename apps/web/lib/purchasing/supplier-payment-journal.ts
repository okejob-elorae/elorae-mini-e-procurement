import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { bookedPayable, type ApLine } from "./supplier-payable";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * `postSupplierPaymentJournal` can fail four ways the shared
 * `GenerateAutoJournalResult` has no code for, every one of which would
 * otherwise read as a benign zero and let the PO report a clean "marked paid".
 *
 * `AP_ACCOUNT_MISMATCH`: GRN journals exist for this PO, but at least one of
 * them contributed no line on the currently-resolved AP account. That happens
 * if `AP` is remapped to a different chart account between receipt and payment
 * — the historical journal lines still point at the old account, so a plain
 * amount-based read would come back short or zero.
 *
 * `GRN_APPROVAL_PENDING`: one of this PO's receipts is an over-receive still
 * awaiting the owner's approve-or-decline. Its receipt journal already credited
 * payables in full at receive time, so the payable read here includes an amount
 * the owner can still cancel: pay it, then decline, and the decline's
 * `GRN_REVERSAL` debits payables a second time while the bank cash-out stands —
 * payables go negative and the supplier reads as overpaid on the books, with
 * nothing adjusting the payment. Its own code because the remedy is neither a
 * mapping nor a journal to post: the owner has to make the decision first.
 *
 * `GRN_JOURNALS_INCOMPLETE`: at least one of this PO's receipts is still owed
 * and carries no GRN journal — whether that is one of several or every last one
 * of them. GRN auto-journalling is best-effort, so a receipt can sit
 * un-journaled indefinitely; paying only the journaled subset under-pays, and
 * whoever later retries the missing GRN journal pushes payables back off zero on
 * a PO already shown as paid. Distinct from the mismatch code because the remedy
 * is different: post the missing GRN journal, not fix a mapping. An
 * owner-declined receipt is not "still owed" and so never reaches this code —
 * see the exemption on the check itself.
 *
 * `GRN_REVERSAL_MISSING`: an owner-declined receipt still carries its GRN
 * journal with no `GRN_REVERSAL` to undo it. Declining an over-receive GRN
 * posts that reversal best-effort too, so a failed post leaves the declined
 * receipt's payable booked as if it were still owed — the payable read here
 * nets it in, and paying it over-pays both payables and bank by the declined
 * amount. Its own code rather than `GRN_JOURNALS_INCOMPLETE` because the
 * operator acts elsewhere: the reversal has a separate retry
 * (`postGrnReversalJournalAction`) from the receipt journal's.
 *
 * All four stay distinct from the genuinely benign zero cases — no GRNs at all
 * (an advance payment), no GRN that could ever book a payable (each one either
 * sub-cent or owner-declined), or a net payable already cleared by reversals —
 * so a caller can raise them loudly instead of reporting success.
 */
export type PostSupplierPaymentResult =
  | GenerateAutoJournalResult
  | { ok: false; code: "AP_ACCOUNT_MISMATCH" }
  | { ok: false; code: "GRN_APPROVAL_PENDING" }
  | { ok: false; code: "GRN_JOURNALS_INCOMPLETE" }
  | { ok: false; code: "GRN_REVERSAL_MISSING" };

type PayableLookup =
  | { ok: true; payable: number }
  | { ok: false; code: "UNMAPPED_ROLE"; role: "AP" }
  | { ok: false; code: "NOTHING_TO_POST" }
  | { ok: false; code: "AP_ACCOUNT_MISMATCH" }
  | { ok: false; code: "GRN_APPROVAL_PENDING" }
  | { ok: false; code: "GRN_JOURNALS_INCOMPLETE" }
  | { ok: false; code: "GRN_REVERSAL_MISSING" };

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

  const grns = await client.gRN.findMany({
    where: { poId },
    select: {
      id: true,
      totalAmount: true,
      requiresOwnerApproval: true,
      ownerApprovedAt: true,
      ownerDeclinedAt: true,
    },
  });
  if (grns.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  /*
   * Refuse while ANY receipt of this PO can still be declined by the owner. An
   * over-receive posts its receipt journal at receive time — payables credited
   * in full — and only then waits for the decision, so the payable read below
   * already contains an amount the owner can still cancel. Paying it and then
   * declining leaves `postGrnReversalJournal` debiting payables a second time
   * with the bank cash-out untouched: payables negative, supplier overpaid on
   * the books, and nothing adjusts the payment. Nothing else here catches it —
   * the receipt journal exists, so the completeness check is satisfied, and the
   * receipt is not declined yet, so the reversal check is not either.
   *
   * "Can still be declined" is `declineGRNByOwner`'s own guard
   * (`app/actions/grn.ts`), mirrored term for term: it permits a decline exactly
   * when `requiresOwnerApproval` is set AND neither `ownerApprovedAt` nor
   * `ownerDeclinedAt` is stamped. Mirroring rather than keying on the flag alone
   * matters for the approved case: `approveGRNByOwner` happens to clear the flag
   * today, but if it ever stopped, a flag-only read would block payment forever
   * on every approved over-receive. The `ownerApprovedAt` term makes the guard
   * independent of that.
   *
   * Deliberately NOT exempt below one cent, unlike the completeness check that
   * follows. That exemption exists to avoid a PERMANENT block — `postGrnJournal`
   * can never post for a sub-cent receipt, so a receipt waiting on a journal
   * that will never exist would hold the PO hostage forever. An outstanding
   * decision is temporary by construction: `approveGRNByOwner` always clears it,
   * so the worst a sub-cent over-receive costs here is one decision.
   *
   * Checked FIRST of the three preconditions, and before the journal query it
   * does not need, because the owner's decision is a prerequisite of the other
   * two remedies rather than a peer of them. A pending receipt that is ALSO
   * un-journaled would otherwise be told to post its GRN journal — work the
   * decline then has to reverse — and a PO holding both a pending receipt and a
   * declined-un-reversed one resolves in either order anyway, since no receipt
   * can be pending and declined at once.
   */
  const anyReceiptPendingDecision = grns.some(
    (g) => g.requiresOwnerApproval && g.ownerApprovedAt === null && g.ownerDeclinedAt === null,
  );
  if (anyReceiptPendingDecision) return { ok: false, code: "GRN_APPROVAL_PENDING" };

  const journals = await client.journal.findMany({
    where: {
      sourceType: { in: ["GRN", "GRN_REVERSAL"] },
      sourceId: { in: grns.map((g) => g.id) },
    },
    select: { sourceType: true, sourceId: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
  });

  /*
   * Refuse while ANY receipt of this PO is still missing its GRN journal.
   * Journals existing only proves SOME receipt booked a payable, and the AP
   * check below can only inspect journals that exist — a receipt whose journal
   * never posted contributes no line to see, so without this the payment posts
   * the journaled subset and reports success. The missing amount then reappears
   * the moment someone retries that GRN journal, on a PO already marked paid.
   *
   * Scoped to receipts with a non-trivial amount because `postGrnJournal`
   * itself returns `NOTHING_TO_POST` below one cent, so a sub-cent GRN
   * legitimately has no journal and must not block payment forever. Same
   * `Math.abs(...) < 0.01` predicate as that guard, deliberately.
   *
   * Owner-declined receipts are exempt for the same reason as sub-cent ones:
   * nothing was ever booked for them, so they have nothing to contribute to the
   * payable and must not hold up the rest of the PO. Receiving posts the GRN
   * journal best-effort and an over-receive can be declined afterwards, so a
   * receipt can end up declined with its journal never posted — without the
   * exemption that one receipt blocks every sibling receipt on the PO from ever
   * being paid, and the remedy this code reports ("post the missing GRN
   * journal") would book a payable for goods inventory has already reversed.
   * `GRN_REVERSAL_MISSING` below deliberately does NOT cover that state either:
   * it requires the receipt journal to exist, because a declined receipt that
   * WAS journaled genuinely still needs its reversal on the ledger.
   *
   * A receipt still awaiting the owner's decision never reaches this check —
   * `GRN_APPROVAL_PENDING` above refuses first, deliberately, so nobody is sent
   * to post a journal for a receipt that may be declined.
   *
   * Checked BEFORE the zero-journals guard: a PO where EVERY receipt failed to
   * journal is the same fault as a partially-journaled one, only worse, so it
   * gets the same precise code instead of the vague `NOTHING_TO_POST` that
   * guard used to hand it — the operator's remedy is identical either way.
   *
   * Checked BEFORE the AP-account check: a missing journal is the more concrete
   * remedy (post it from the GRN row), and it also makes any mismatch verdict
   * untrustworthy while it holds — a journal that does not exist cannot
   * contribute an AP line, so reporting a remapped account first would send the
   * operator auditing a mapping that may be perfectly fine.
   */
  const journaledGrnIds = new Set(journals.filter((j) => j.sourceType === "GRN").map((j) => j.sourceId));
  const anyReceiptUnjournaled = grns.some(
    (g) => g.ownerDeclinedAt === null && Math.abs(Number(g.totalAmount)) >= 0.01 && !journaledGrnIds.has(g.id),
  );
  if (anyReceiptUnjournaled) return { ok: false, code: "GRN_JOURNALS_INCOMPLETE" };

  /*
   * Refuse while an owner-declined receipt still has its GRN journal standing
   * un-reversed. Sits beside the completeness check above, and for the same
   * reason: both say the journal set this payable is read from is already known
   * wrong, and a payable derived from a wrong journal set must not go on to
   * produce an AP-mapping verdict — the mismatch check below can only inspect
   * lines that exist, so a reversal that never posted would leave it reporting
   * either a clean payable that over-pays or a remap that never happened.
   *
   * Neither the completeness check nor `GRN_APPROVAL_PENDING` can be the answer
   * for the same receipt as this one: the completeness check fires only for a
   * receipt still owed, the pending check only for a receipt with no decision
   * stamped either way, and this one only for a declined receipt whose journal
   * exists. A declined receipt with no journal at all is none of the three —
   * nothing was booked for it and nothing needs reversing, so it is simply not
   * this PO's problem. Per receipt that makes the order between this check and
   * the two above immaterial to behaviour; across receipts it is not, which is
   * why the pending check goes first — see its own note.
   *
   * Kept separate from `GRN_JOURNALS_INCOMPLETE` because the operator's action
   * differs: the reversal is retried from the declined GRN's own reversal
   * button, not the receipt-journal one.
   */
  const reversedGrnIds = new Set(journals.filter((j) => j.sourceType === "GRN_REVERSAL").map((j) => j.sourceId));
  const anyDeclinedUnreversed = grns.some(
    (g) => g.ownerDeclinedAt != null && journaledGrnIds.has(g.id) && !reversedGrnIds.has(g.id),
  );
  if (anyDeclinedUnreversed) return { ok: false, code: "GRN_REVERSAL_MISSING" };

  /*
   * NOT dead code, and load-bearing: reachable only when every GRN on this PO
   * is exempt from the completeness check — each one either sub-cent or
   * owner-declined, and none of them awaiting a decision, which is refused
   * earlier. That check already refused if any receipt still owed lacked
   * its journal, so no journals at all means no receipt qualified. Nothing was
   * ever booked for an exempt receipt, so `NOTHING_TO_POST` is the honest
   * answer. Without this early return that PO would fall through to an empty
   * `apLines` and be reported as `AP_ACCOUNT_MISMATCH` — a mapping fault that
   * does not exist.
   */
  if (journals.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  /*
   * Every GRN and GRN_REVERSAL journal books its counter-line against the AP
   * role, so each one MUST contribute at least one line on the account that
   * role resolves to now. A journal contributing none means part of this PO's
   * payable sits on a different account — `AP` was remapped between two
   * receipts — and paying only the lines found here would silently under-pay by
   * the missing receipt's amount. An empty set is the same fault with every
   * receipt on the far side of the remap.
   */
  const apLines: ApLine[] = [];
  let journalsWithoutApLine = 0;
  for (const journal of journals) {
    const own = journal.lines.filter((l) => l.chartAccountId === apAccountId);
    if (own.length === 0) {
      journalsWithoutApLine += 1;
      continue;
    }
    for (const l of own) apLines.push({ debit: Number(l.debit), credit: Number(l.credit) });
  }

  if (apLines.length === 0 || journalsWithoutApLine > 0) return { ok: false, code: "AP_ACCOUNT_MISMATCH" };

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
    select: { date: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
  });
  if (!paid) return { ok: false, code: "NOTHING_TO_POST" };

  /*
   * The reversal mirrors the payment journal BY CONSTRUCTION: same chart
   * accounts, debit and credit swapped, so the pair always nets to exactly zero
   * on every account the payment touched. Re-resolving `AP`/`BANK` by role
   * instead would post against whatever those roles point at NOW — an operator
   * who repointed `AP` while the PO sat marked paid would leave the payment's
   * debit stranded on the old account with nothing able to clear it, while the
   * next payment read a zero payable on the new one and reported nothing to
   * post. Mirroring accounts is also why this calls `postJournal` directly
   * rather than the role-based `generateAutoJournal` wrapper; `postJournal`
   * still enforces balance and idempotency by `(sourceType, sourceId)`.
   */
  const lines = paid.lines.map((l) => ({
    chartAccountId: l.chartAccountId,
    debit: Number(l.credit),
    credit: Number(l.debit),
  }));

  /*
   * Zero-value guard only. This sums the mirrored journal's debits as a whole
   * — legitimate because `postJournal` balanced it at creation — rather than
   * assuming which single line carries the payable, so it stays correct if a
   * payment journal ever grows beyond its two lines.
   */
  const totalCents = lines.reduce((cents, l) => cents + Math.round(l.debit * 100), 0);
  if (totalCents < 1) return { ok: false, code: "NOTHING_TO_POST" };

  const po = await client.purchaseOrder.findUnique({ where: { id: poId }, select: { docNumber: true } });

  try {
    /* Dated to the payment it reverses, not today: marking on 31 Aug and
       unmarking on 1 Sep must not report an August cash-out that was undone
       alongside a September inflow that never happened. */
    const res = await postJournal(client, {
      source: { type: "SUPPLIER_PAYMENT_REVERSAL", id: sourceId },
      date: paid.date,
      description: `Supplier payment reversal ${po?.docNumber ?? poId}`,
      postedById,
      lines,
    });
    return { ok: true, journalId: res.journalId, created: res.created };
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}
