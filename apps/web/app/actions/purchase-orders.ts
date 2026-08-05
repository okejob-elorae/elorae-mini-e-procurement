'use server';

import { revalidatePath } from 'next/cache';
import { Decimal } from 'decimal.js';
import { prisma } from '@elorae/db';
import { generateDocNumber } from '@/lib/docNumber';
import { POStatus } from '@elorae/db';
import { poSchema } from '@/lib/validations';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import { hasPermission, requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { getActorName, notifyPOCreated, notifyPOStatusUpdated, notifyPOPaymentToggled } from '@/app/actions/notifications';
import { createPurchaseOrder, type POFormData } from '@/lib/purchase-orders/mutations';
import { listPOs, getPOById as getPOByIdQuery } from '@/lib/purchase-orders/queries';
import { assertLinesVariantSkusMatchItemDefinitions } from '@/lib/items/validate-variant-lines';
import { resolvePoLeadTimeFields } from '@/lib/leadtime/po-snapshot';
import {
  hasStandingPaymentJournalWhileUnpaid,
  postSupplierPaymentJournal,
  postSupplierPaymentReversalJournal,
} from '@/lib/purchasing/supplier-payment-journal';
import type { GenerateAutoJournalResult } from '@/lib/finance/journal';
import {
  attemptSupplierPaymentJournal,
  notifySupplierPaymentJournalFailure,
  type SupplierPaymentPostFailure,
} from '@/lib/purchasing/post-supplier-payment-journal-safely';
import type { SupplierPaymentDirection } from '@/lib/purchasing/supplier-payment-journal-message';
import { runSerializable } from '@/lib/db/tx-retry';

function poReceiptLineKey(itemId: string, variantSku?: string | null) {
  return `${itemId}\n${variantSku ?? ''}`;
}

export async function createPO(data: POFormData, userId: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_CREATE);

  let po;
  try {
    po = await createPurchaseOrder(data, userId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(error.issues[0]?.message ?? 'Invalid purchase order data');
    }
    throw error;
  }

  getActorName(userId)
    .then((triggeredByName) => notifyPOCreated(po.id, po.docNumber, triggeredByName))
    .catch(() => {});

  return { id: po.id, docNumber: po.docNumber };
}

export async function updatePO(
  id: string,
  data: POFormData,
  userId: string,
  pin?: string
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);
  
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true }
  });

  if (existing?.status === 'CLOSED' || existing?.status === 'CANCELLED') {
    throw new Error('Cannot edit closed or cancelled PO');
  }

  if (existing?.status !== 'DRAFT') {
    if (!pin) {
      throw new Error('PIN required to edit a posted PO');
    }
    const pinResult = await verifyPinForAction(userId, pin, 'EDIT_POSTED_PO');
    if (!pinResult.success) {
      throw new Error(pinResult.messageKey ?? pinResult.message);
    }
  }

  const receivedPreservingStatuses = ['SUBMITTED', 'PARTIAL', 'OVER'] as const;
  const preserveReceived =
    existing?.status &&
    receivedPreservingStatuses.includes(
      existing.status as (typeof receivedPreservingStatuses)[number]
    );

  const po = await prisma.$transaction(async (tx) => {
    await assertLinesVariantSkusMatchItemDefinitions(tx.item, data.items);

    const oldItems = await tx.pOItem.findMany({
      where: { poId: id },
      select: { itemId: true, variantSku: true, receivedQty: true },
    });
    const receivedByLine = new Map<string, number>();
    for (const o of oldItems) {
      const r = Number(o.receivedQty);
      const k = poReceiptLineKey(o.itemId, o.variantSku);
      receivedByLine.set(k, (receivedByLine.get(k) ?? 0) + r);
    }

    if (preserveReceived) {
      for (const [key, recv] of receivedByLine) {
        if (recv <= 0) continue;
        const lines = data.items.filter(
          (i) => poReceiptLineKey(i.itemId, i.variantSku ?? null) === key
        );
        const totalNewQty = lines.reduce((s, i) => s + i.qty, 0);
        if (lines.length === 0 || totalNewQty < recv) {
          throw new Error(
            `Cannot edit: a line has ${recv} received — keep that line and qty ≥ ${recv}, or remove only zero-received lines.`
          );
        }
      }
    }

    const totalAmount = data.items.reduce((sum, item) => {
      return sum.plus(new Decimal(item.qty).mul(item.price));
    }, new Decimal(0));

    await tx.pOItem.deleteMany({ where: { poId: id } });

    const remainingRecv = new Map(receivedByLine);
    const itemCreates = data.items.map((item) => {
      const k = poReceiptLineKey(item.itemId, item.variantSku ?? null);
      const avail = remainingRecv.get(k) ?? 0;
      const receivedQty = preserveReceived ? Math.min(avail, item.qty) : 0;
      remainingRecv.set(k, Math.max(0, avail - receivedQty));
      return {
        itemId: item.itemId,
        variantSku: item.variantSku?.trim() || null,
        qty: item.qty,
        price: item.price,
        ppnIncluded: item.ppnIncluded,
        uomId: item.uomId,
        notes: item.notes ?? null,
        receivedQty,
      };
    });

    let leadTimePatch: {
      chainSnapshot?: object | null;
      chainTotalDays?: number | null;
      etaDate?: Date | null;
    } = {};
    if (existing?.status === "DRAFT") {
      const lt = await resolvePoLeadTimeFields(
        tx,
        data.supplierId,
        data.items,
        data.etaDate ?? null
      );
      leadTimePatch = {
        chainSnapshot: lt.chainSnapshot,
        chainTotalDays: lt.chainTotalDays,
        etaDate: lt.etaDate ?? null,
      };
    }

    const po = await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: data.supplierId,
        etaDate: leadTimePatch.etaDate !== undefined ? leadTimePatch.etaDate : data.etaDate,
        paymentDueDate: data.paymentDueDate ?? undefined,
        notes: data.notes,
        terms: data.terms,
        totalAmount: totalAmount.toNumber(),
        grandTotal: totalAmount.toNumber(),
        ...(existing?.status === "DRAFT"
          ? {
              chainSnapshot: leadTimePatch.chainSnapshot ?? undefined,
              chainTotalDays: leadTimePatch.chainTotalDays ?? undefined,
            }
          : {}),
        items: { create: itemCreates },
      },
      include: {
        items: { include: { item: true } },
        supplier: true,
      },
    });

    if (existing?.status && existing.status !== 'DRAFT') {
      await tx.pOStatusHistory.create({
        data: {
          poId: id,
          status: existing.status,
          changedById: userId,
          notes: 'PO Edited (PIN verified)',
        },
      });
    }

    return po;
  });

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${id}`);
  return { id };
}

export async function changePOStatus(
  id: string,
  newStatus: 'SUBMITTED' | 'CANCELLED' | 'CLOSED',
  userId: string,
  notes?: string,
  pin?: string
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  if (newStatus === 'SUBMITTED') {
    requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_APPROVE);
  } else {
    requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);
  }

  if (newStatus === 'CANCELLED') {
    if (!pin) {
      throw new Error('PIN required to void/cancel a PO');
    }
    const pinResult = await verifyPinForAction(userId, pin, 'VOID_DOCUMENT');
    if (!pinResult.success) {
      throw new Error(pinResult.messageKey ?? pinResult.message);
    }

    // Block cancellation if any receipts exist (or GRNs are linked).
    const poWithReceipts = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { grns: { select: { id: true } }, items: { select: { receivedQty: true } } },
    });
    if (!poWithReceipts) throw new Error('PO not found');
    const anyReceived = (poWithReceipts.items ?? []).some((it) => Number(it.receivedQty) > 0);
    if ((poWithReceipts.grns ?? []).length > 0 || anyReceived) {
      throw new Error('Cannot cancel PO with GRNs');
    }
  }

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true, docNumber: true },
  });
  if (!existing) throw new Error('PO not found');

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: newStatus }
  });
  
  await prisma.pOStatusHistory.create({
    data: {
      poId: id,
      status: newStatus,
      changedById: userId,
      notes: notes || `Status changed to ${newStatus}`
    }
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyPOStatusUpdated(id, existing.docNumber, existing.status, newStatus, triggeredByName)
    )
    .catch(() => {});
  
  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${id}`);
  return { id: po.id, status: po.status };
}

export async function submitPO(id: string, userId: string) {
  return changePOStatus(id, 'SUBMITTED', userId, 'PO Submitted to supplier');
}

export async function cancelPO(id: string, userId: string, reason?: string, pin?: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);

  if (!pin) {
    throw new Error('PIN required to cancel/void a PO');
  }
  const pinResult = await verifyPinForAction(userId, pin, 'VOID_DOCUMENT');
  if (!pinResult.success) {
    throw new Error(pinResult.messageKey ?? pinResult.message);
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { grns: { select: { id: true } }, items: { select: { receivedQty: true } } }
  });

  if (!po) throw new Error('PO not found');

  // Safety: block cancelling if anything was received (even if GRN rows aren't linked via poId).
  const anyReceived = (po.items ?? []).some((it) => Number(it.receivedQty) > 0);
  if (po.grns.length > 0 || anyReceived) {
    throw new Error('Cannot cancel PO with GRNs');
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    
    await tx.pOStatusHistory.create({
      data: {
        poId: id,
        status: 'CANCELLED',
        changedById: userId,
        notes: reason || 'PO Cancelled'
      }
    });
  });
  
  revalidatePath('/backoffice/purchase-orders');
}

export async function getPOs(
  filters?: Parameters<typeof listPOs>[0],
  opts?: Parameters<typeof listPOs>[1]
) {
  return listPOs(filters, opts);
}

export async function getPOById(id: string) {
  return getPOByIdQuery(id);
}

// Get PO statistics for dashboard
export async function getPOStats() {
  const [
    totalPOs,
    draftPOs,
    submittedPOs,
    partialPOs,
    overduePOs,
    totalValue
  ] = await Promise.all([
    prisma.purchaseOrder.count(),
    prisma.purchaseOrder.count({ where: { status: 'DRAFT' } }),
    prisma.purchaseOrder.count({ where: { status: 'SUBMITTED' } }),
    prisma.purchaseOrder.count({ where: { status: 'PARTIAL' } }),
    prisma.purchaseOrder.count({
      where: {
        etaDate: { lt: new Date() },
        status: { notIn: ['CLOSED', 'OVER', 'CANCELLED'] }
      }
    }),
    prisma.purchaseOrder.aggregate({
      _sum: { grandTotal: true }
    })
  ]);
  
  return {
    totalPOs,
    draftPOs,
    submittedPOs,
    partialPOs,
    overduePOs,
    totalValue: Number(totalValue._sum.grandTotal ?? 0),
  };
}

/**
 * What the toggle did to the ledger, so the caller can tell the operator instead
 * of reporting success for a payment nothing was posted for.
 *
 * `changed` is the compare-and-swap's own verdict: false means the PO was
 * ALREADY in the requested state, so no `paidAt` write, no status history, no
 * notification and — critically — no journal happened. It has to cross to the
 * client because a no-op is otherwise indistinguishable from a real toggle, and
 * the two states where it matters are exactly the dangerous ones: a first mark
 * that committed `paidAt` but failed to post, then re-marked from a stale tab,
 * would be reported as a clean payment while the ledger gap persists.
 *
 * `journalFailure` is null on the happy path, on a no-op (nothing was attempted)
 * AND on a reversal with no payment journal to undo, which is a genuine no-op on
 * the ledger.
 *
 * Only the code, the posting role and the direction cross to the client. The
 * `detail` string a thrown journal carries is a raw server error message — it
 * stays in the `AdminNotification` and the server log, where the operator's toast
 * cannot leak it. A toast maps the code to its own remedy sentence anyway.
 *
 * `direction` rides along because two codes mean opposite things on the two
 * halves of the toggle — a failed payment wrote nothing and is retried by
 * unmarking, a failed reversal left the earlier payment journal standing and is
 * retried from its own control — and the toast picks the wording from it. Sent
 * from here rather than inferred by the caller from the button it pressed, so the
 * sentence describes the post that actually ran.
 */
export type SetPOPaidAtResult = {
  changed: boolean;
  journalFailure: { code: string; role: string | null; direction: SupplierPaymentDirection } | null;
};

/** Mark a PO as paid (or unmark by passing paidAt: null). */
export async function setPOPaidAt(poId: string, paidAt: Date | null): Promise<SetPOPaidAtResult> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PURCHASE_ORDERS_EDIT);

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { docNumber: true, status: true },
  });
  if (!po) throw new Error('PO not found');

  /**
   * Fails closed before the transaction opens, matching this file's own
   * `throw new Error('Unauthorized')` convention for a missing session. A
   * missing actor used to be treated as a silent journal skip INSIDE the
   * transaction: the CAS still committed, the outcome reported `changed: true,
   * failure: null`, and the post-commit block was gated on the same actor, so
   * the status history, the payment notification AND any journal-failure
   * notification were all skipped. The PO ended up marked paid with nothing
   * posted to the GL and nothing flagged anywhere. A write that needs an actor
   * to be auditable and journalable must not commit without one.
   */
  const actorId = session.user?.id;
  if (!actorId) throw new Error('Unauthorized');

  const direction: SupplierPaymentDirection = paidAt != null ? 'payment' : 'reversal';

  /**
   * The toggle and its journal in ONE serializable transaction, so a concurrent
   * toggle can neither interleave between them nor read a half-applied state.
   *
   * The compare-and-swap alone (which is what this used to be) only ordered the
   * two `paidAt` writes. It still left this open: a mark CAS-succeeds and starts
   * posting; an unmark CAS-succeeds because the PO now reads paid, runs its
   * reversal, finds no payment journal yet and returns NOTHING_TO_POST — silent
   * by design in that direction — and then the mark's journal commits. The PO
   * ends up unpaid with DR payables / CR bank standing, and nothing flagged.
   * Serializing the pair removes the window the second toggle needed.
   *
   * Zero rows changed means the PO is already in the requested state, so the
   * status history, the notification and the journal are all skipped.
   *
   * The journal stays best-effort: `attemptSupplierPaymentJournal` catches a
   * journal problem INSIDE the callback and hands it back as a value, so the CAS
   * still commits and the failure becomes a JOURNAL_PENDING notification written
   * after the transaction. Verified on MariaDB: a caught statement error does
   * not poison the surrounding transaction. The exception is a deadlock or
   * serialization abort, which MariaDB has already rolled back — that one
   * rethrows so `runSerializable` retries the toggle and the post together.
   * A failed PAYMENT needs no retry button because the toggle IS the retry; a
   * failed REVERSAL is the one case the toggle cannot re-reach, and it has its
   * own control (`postSupplierPaymentReversalJournalAction`).
   */
  const outcome = await runSerializable<{ changed: boolean; failure: SupplierPaymentPostFailure | null }>(
    async (tx) => {
      const toggled = await tx.purchaseOrder.updateMany({
        where: { id: poId, paidAt: paidAt != null ? null : { not: null } },
        data: { paidAt },
      });
      if (toggled.count === 0) return { changed: false, failure: null };

      const failure = await attemptSupplierPaymentJournal(direction, () =>
        paidAt != null
          ? postSupplierPaymentJournal(poId, actorId, paidAt, tx)
          : postSupplierPaymentReversalJournal(poId, actorId, tx)
      );
      return { changed: true, failure };
    }
  );

  if (outcome.changed) {
    /**
     * FIRST of the post-commit writes, ahead of the status history, because a
     * bookkeeping write must never be able to erase the only recovery signal for
     * a ledger inconsistency. The toggle has already committed and the journal
     * has already failed; if the history insert went first and threw — a
     * transient DB error, an FK, anything — nothing would be flagged anywhere.
     * The PO would read paid with no payment journal, no `JOURNAL_PENDING` row,
     * and a re-mark would be a CAS no-op because `paidAt` is already set — that
     * no-op is now reported as one instead of as a payment, but it still posts
     * nothing, so nothing but this row would tell them to unmark first.
     *
     * The history insert below is now guarded too, so on its own that guard would
     * also keep this reachable in either order. The ordering stays as the outer
     * belt: the durable flag must not depend on a `catch` further down the
     * function staying correct, and it costs nothing to keep.
     *
     * The notify helper swallows and logs its own failures, so putting it first
     * cannot block the history insert either — neither write can starve the other.
     *
     * Written outside the transaction on purpose: a notification must not be
     * rolled back by, or contribute its own write to, transaction contention.
     */
    if (outcome.failure) {
      await notifySupplierPaymentJournalFailure(direction, poId, outcome.failure);
    }

    /**
     * Guarded, not just ordered after the notification. Ordering alone protects
     * the DURABLE record; this protects the IMMEDIATE one. An unguarded throw
     * here rejects `setPOPaidAt` before it can return `journalFailure`, so the
     * client falls into its generic error toast and the operator who clicked
     * never sees the warning that explains the ledger gap or the unmark/re-mark
     * remedy — a bookkeeping audit insert would have replaced the only in-UI
     * explanation of a finance inconsistency. The two lessons are separate: the
     * ordering keeps the notification from being skipped, the guard keeps the
     * caller's answer from being replaced.
     *
     * Logged rather than swallowed: a missing payment-event history row is a real
     * audit gap and must stay discoverable in the server log, it just must not
     * change what the operator is told about the journal.
     */
    try {
      await prisma.pOStatusHistory.create({
        data: {
          poId,
          status: po.status,
          changedById: actorId,
          paymentEvent: paidAt != null ? 'MARKED' : 'UNMARKED',
          notes: paidAt != null ? 'Supplier payment marked' : 'Supplier payment unmarked',
        },
      });
    } catch (e) {
      console.error(
        `[setPOPaidAt] FAILED TO WRITE PAYMENT HISTORY for PO ${poId} — the paid toggle committed ` +
          `(${paidAt != null ? 'MARKED' : 'UNMARKED'}) but its POStatusHistory row did not, so the payment event ` +
          'is missing from the audit trail.',
        e,
      );
    }
    getActorName(actorId)
      .then((triggeredByName) =>
        notifyPOPaymentToggled(poId, po.docNumber, paidAt != null, triggeredByName)
      )
      .catch(() => {});
  }

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath('/backoffice/purchase-orders/[id]');
  revalidatePath('/backoffice/supplier-payments');

  /**
   * Returned, not thrown: a journal problem must still not fail the toggle, which
   * has already committed and is the operator's own retry handle. The
   * `AdminNotification` written above stays either way — the toast is immediate
   * feedback for whoever clicked, the notification is the durable record for
   * whoever audits later.
   */
  return {
    changed: outcome.changed,
    journalFailure: outcome.failure
      ? { code: outcome.failure.reason, role: outcome.failure.role, direction }
      : null,
  };
}

export type PostSupplierPaymentReversalActionResult =
  | GenerateAutoJournalResult
  | { ok: false; code: 'FORBIDDEN' | 'BAD_STATE' };

/**
 * Posts the reversal a failed unmark never posted, for a PO that reads unpaid
 * while its payment journal still stands.
 *
 * A DELIBERATE exception to this flow's "no retry button because the toggle IS
 * the retry" rule, not an inconsistency with it. That rule holds wherever the
 * toggle can reach the missing post again; it cannot reach this one. From unpaid
 * the UI only offers "Mark paid", and marking either returns
 * `PAYMENT_SUPERSEDED` (once the payable has moved) or an idempotent hit on the
 * journal already standing — so the mark/unmark dance can be blocked outright,
 * and even when it is not it never posts the reversal that is actually missing.
 * Without this action the operator has no way out through the UI at all.
 *
 * The state check is server-side and re-read here, mirroring the van journal
 * retries (`postVanSaleJournalAction` and siblings): the warning banner's
 * visibility on the PO detail page is not a guard, because every export of a
 * `"use server"` module is an independently callable endpoint reachable by
 * anyone holding `journals:manage`. Do not remove it as "redundant" with the UI
 * condition. Unlike the van retries the evidence is the LEDGER STATE, not a
 * `JOURNAL_PENDING` notification — a state a mark/unmark can reach without any
 * notification ever being written, and one that stops being true the moment the
 * reversal posts, which makes it both stricter and self-clearing.
 *
 * The check and the post run in ONE serializable transaction, for the same reason
 * the paid toggle wraps its own pair: a check outside the write is only a prelude,
 * and a concurrent `setPOPaidAt(paidAt)` can commit between the two. That window
 * was real and it inverted the very bug this control repairs — the mark
 * CAS-succeeds, treats the standing journal as an idempotent same-amount hit and
 * reports a clean payment, then this action posts the reversal anyway, leaving the
 * PO reading PAID with payables owed again and bank restored. Serializing the pair
 * removes the window; `postSupplierPaymentReversalJournal`'s own `PO_IS_PAID`
 * guard closes it a second time from inside, so the invariant does not rest on a
 * non-atomic prelude in either layer. That guard is unreachable from here once the
 * pair is serialized, which is why it is folded into `BAD_STATE` rather than given
 * a code of its own on the wire: both mean "the state this control requires no
 * longer holds", and the operator's next step — reload and look again — is the
 * same.
 *
 * `postSupplierPaymentReversalJournal` handles idempotency (keyed
 * `(SUPPLIER_PAYMENT_REVERSAL, poId#gen)`), so a double-click cannot double-post.
 * Returns a typed result instead of throwing, so the caller can name the failure
 * the same way the toggle's own outcome is named.
 */
export async function postSupplierPaymentReversalJournalAction(
  poId: string
): Promise<PostSupplierPaymentReversalActionResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: 'FORBIDDEN' };
  }
  const postedById = session.user.id;

  const result = await runSerializable<PostSupplierPaymentReversalActionResult>(async (tx) => {
    if (!(await hasStandingPaymentJournalWhileUnpaid(poId, tx))) {
      return { ok: false, code: 'BAD_STATE' };
    }
    const posted = await postSupplierPaymentReversalJournal(poId, postedById, tx);
    if (!posted.ok && posted.code === 'PO_IS_PAID') return { ok: false, code: 'BAD_STATE' };
    return posted;
  });

  revalidatePath('/backoffice/purchase-orders');
  revalidatePath(`/backoffice/purchase-orders/${poId}`);
  revalidatePath('/backoffice/supplier-payments');

  return result;
}
