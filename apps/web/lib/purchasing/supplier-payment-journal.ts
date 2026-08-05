import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { bookedPayable, type ApLine } from "./supplier-payable";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * `postSupplierPaymentJournal` can fail five ways the shared
 * `GenerateAutoJournalResult` has no code for, every one of which would
 * otherwise read as a benign zero — or a benign idempotent hit — and let the PO
 * report a clean "marked paid".
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
 * `PAYMENT_SUPERSEDED`: a payment journal is already standing at this
 * generation, but it posted a different amount than the payable read now. The
 * generation counts REVERSALS, so a reversal that failed to post leaves it put
 * while `paidAt` keeps toggling: unmark (the reversal fails, so payment `#1`
 * still stands on the ledger), receive and journal another receipt, re-mark —
 * the payable is now larger, the generation is still 1, and `postJournal`
 * matches the standing journal and reports `created: false`. Treated as success
 * that clears the old, smaller amount against the new, larger payable while
 * telling the operator it went through. Its own code because the remedy is
 * neither a mapping nor a missing GRN journal: the standing payment journal has
 * to be reversed — unmark again, and confirm the reversal actually posted this
 * time — before this payment can post at its real amount. If that reversal fails
 * again, `hasStandingPaymentJournalWhileUnpaid` flags the PO and the reversal can
 * be posted directly from the detail page's standing-payment warning.
 *
 * The first four stay distinct from the genuinely benign zero cases — no GRNs at
 * all (an advance payment), no GRN that could ever book a payable (each one
 * either sub-cent or owner-declined), or a net payable already cleared by
 * reversals — so a caller can raise them loudly instead of reporting success.
 * `PAYMENT_SUPERSEDED` does the same for the other silent success: an idempotent
 * hit that no longer matches what the ledger owes.
 */
export type PostSupplierPaymentResult =
  | GenerateAutoJournalResult
  | { ok: false; code: "AP_ACCOUNT_MISMATCH" }
  | { ok: false; code: "GRN_APPROVAL_PENDING" }
  | { ok: false; code: "GRN_JOURNALS_INCOMPLETE" }
  | { ok: false; code: "GRN_REVERSAL_MISSING" }
  | { ok: false; code: "PAYMENT_SUPERSEDED" };

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
 *
 * The cost of that choice: a reversal that FAILED to post leaves the count — and
 * so the generation — put while `paidAt` toggles freely, so a later re-mark can
 * land on a payment journal standing for a stale amount. That is why the caller
 * does not trust `created: false` on its own and compares amounts
 * (`PAYMENT_SUPERSEDED`); the fix belongs there rather than in this count, since
 * counting payments to close it would reopen the duplicate-on-retry hole. The
 * same property is what makes `hasStandingPaymentJournalWhileUnpaid` a one-query
 * test: while a reversal is missing, the generation still points AT the payment
 * that needs reversing.
 */
async function currentGeneration(poId: string, client: AnyClient): Promise<number> {
  const reversalCount = await client.journal.count({
    where: { sourceType: "SUPPLIER_PAYMENT_REVERSAL", sourceId: { startsWith: `${poId}#` } },
  });
  return reversalCount + 1;
}

/**
 * The payment journal one generation already posted, with the lines its value is
 * read from. ONE lookup, shared by the reversal writer (which mirrors those
 * lines) and by the stale-hit guard in `postSupplierPaymentJournal` (which
 * compares their value against a freshly-read payable), so a standing payment is
 * never read two different ways.
 */
async function postedPaymentJournal(poId: string, gen: number, client: AnyClient) {
  return client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "SUPPLIER_PAYMENT", sourceId: `${poId}#${gen}` } },
    select: { date: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
  });
}

/**
 * Total debits of a journal's lines in cents. Summing the journal AS A WHOLE
 * rather than picking out the line assumed to carry the payable is legitimate
 * because `postJournal` balanced it at creation, and it keeps working if a
 * payment journal ever grows past its two lines — or if `AP` was repointed after
 * it posted, which would make an account-keyed read come back short.
 */
function totalDebitCents(lines: Array<{ debit: Prisma.Decimal | number }>): number {
  return lines.reduce((cents, l) => cents + Math.round(Number(l.debit) * 100), 0);
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

  const res = await generateAutoJournal(
    client,
    "SUPPLIER_PAYMENT",
    sourceId,
    [
      { role: "AP" as const, debit: lookup.payable, credit: 0 },
      { role: "BANK" as const, debit: 0, credit: lookup.payable },
    ],
    { date: paidAt, description: `Supplier payment ${po?.docNumber ?? poId}`, postedById },
  );

  /*
   * `created: false` means a payment journal was already standing at this
   * generation, and it is only benign while that journal posted the SAME amount
   * as the payable just read — a plain double-submit of one mark. It is not
   * benign after a reversal failed to post: the generation stays put (it counts
   * reversals) while `paidAt` toggles, so an unmark whose reversal failed, a new
   * receipt journaled onto the same PO, and a re-mark all land back on the
   * original journal — which cleared the smaller, older payable. Passing that
   * through as success under-pays the supplier on the books and confirms it to
   * the operator, so it is refused instead: the standing journal must be reversed
   * first.
   *
   * Compared in cents, matching `bookedPayable`'s own rounding, so two amounts
   * equal to the cent never differ on a float tail. A standing journal that
   * cannot be read back at all is left to `res` — `postJournal` only reports
   * `created: false` because it found one, so this is unreachable rather than a
   * state with a verdict of its own.
   */
  if (res.ok && !res.created) {
    const standing = await postedPaymentJournal(poId, gen, client);
    if (standing && totalDebitCents(standing.lines) !== Math.round(lookup.payable * 100)) {
      return { ok: false, code: "PAYMENT_SUPERSEDED" };
    }
  }

  return res;
}

/**
 * True when this PO reads UNPAID while a payment journal still stands on the
 * ledger for it — the state a failed reversal leaves behind. `paidAt` went back
 * to null (the toggle's CAS committed), the reversal did not post, so payables
 * are still cleared and bank still credited for a purchase order the ERP now
 * shows as unpaid.
 *
 * The toggle cannot get out of it on its own, which is why the "no retry button
 * because the toggle IS the retry" rule does not apply here and
 * `postSupplierPaymentReversalJournalAction` exists: from unpaid the UI only
 * offers "Mark paid", and marking either hits `PAYMENT_SUPERSEDED` (if the
 * payable moved) or an idempotent same-amount hit that changes nothing on the
 * ledger — never the missing reversal.
 *
 * Reading the payment journal AT the current generation is the whole test. The
 * generation counts REVERSALS, so a payment that HAS been reversed sits one
 * generation behind the current one and this lookup misses it by construction —
 * no separate "is it reversed" query is needed, and adding one would duplicate
 * the generation formula. `paidAt` is re-read here rather than taken from a
 * caller so the server action can use this as its own state guard.
 */
export async function hasStandingPaymentJournalWhileUnpaid(
  poId: string,
  client: AnyClient = prisma,
): Promise<boolean> {
  const po = await client.purchaseOrder.findUnique({ where: { id: poId }, select: { paidAt: true } });
  if (!po || po.paidAt != null) return false;

  const gen = await currentGeneration(poId, client);
  const standing = await postedPaymentJournal(poId, gen, client);
  return standing != null;
}

/**
 * `PO_IS_PAID` is the reversal's own precondition: the PO reads PAID, so its
 * payment journal is supposed to be standing and undoing it would leave the
 * ledger saying the opposite of the PO — payables owed again and bank restored
 * for a purchase order the ERP shows as paid. That is the exact inverse of the
 * inconsistency this writer exists to repair, so it is refused rather than
 * posted.
 *
 * Its own code rather than `NOTHING_TO_POST` because the remedy is opposite:
 * nothing-to-reverse means the payment never posted and there is nothing to do,
 * while this means the payment posted and is CORRECT — the caller wanted a
 * reversal for a state that no longer holds, and unmarking the PO is the only
 * thing that could legitimately make one due.
 */
export type PostSupplierPaymentReversalResult =
  | GenerateAutoJournalResult
  | { ok: false; code: "PO_IS_PAID" };

export async function postSupplierPaymentReversalJournal(
  poId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<PostSupplierPaymentReversalResult> {
  /*
   * Read FIRST, before the generation and the standing-payment lookup, because a
   * paid PO must not have its payment reversed no matter what those two say. The
   * caller's own state check is not enough on its own: the recovery action reads
   * `hasStandingPaymentJournalWhileUnpaid` and then calls this, and a check
   * outside this writer can only be trusted while the pair runs in one
   * serializable transaction. This guard makes the invariant hold even if a
   * future caller forgets that.
   *
   * Safe for the paid toggle, which is the only other caller: its unmark branch
   * sets `paidAt = null` with `updateMany` and then calls this INSIDE the same
   * transaction, so this read sees its own uncommitted write and finds null. The
   * mark branch never calls this at all.
   *
   * A PO row that does not exist is deliberately NOT this code — `paidAt` cannot
   * be "set" for a row that is absent, and the standing-payment lookup below
   * already answers that case with `NOTHING_TO_POST`.
   *
   * `docNumber` is taken from the same read the guard needs, so the description
   * costs no extra query.
   */
  const po = await client.purchaseOrder.findUnique({
    where: { id: poId },
    select: { docNumber: true, paidAt: true },
  });
  if (po?.paidAt != null) return { ok: false, code: "PO_IS_PAID" };

  const gen = await currentGeneration(poId, client);
  const sourceId = `${poId}#${gen}`;

  const paid = await postedPaymentJournal(poId, gen, client);
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

  /* Zero-value guard only, on the mirrored journal's debits as a whole — see
     `totalDebitCents` for why summing the whole journal is the right read. */
  if (totalDebitCents(lines) < 1) return { ok: false, code: "NOTHING_TO_POST" };

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
