"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordFieldSalesDelivery, closeFieldSalesOrderRemainder } from "@/lib/field-sales/delivery/writer";
import { DeliveryError } from "@/lib/field-sales/errors";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { postArJournalSafely } from "@/lib/finance/ar/post-ar-journal-safely";
import { postFieldDeliveryRevenueJournal, postFieldDeliveryCogsJournal } from "@/lib/finance/ar/delivery-journal";
import { isArJournalRetryable } from "@/lib/finance/ar/journal-pending";
import { logPrint } from "./audit";

export type DeliveryActionResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "INVALID_REQUEST"
        | "INVALID_DATES"
        | "CONFLICT"
        | "NO_LINES"
        | "OVER_DELIVER"
        | "INSUFFICIENT_STOCK"
        | "NOT_RETRYABLE"
        | "RECEIVABLE_HAS_PAYMENTS";
      shortLines?: Array<{ orderLineId: string; requested: number; onHand: number }>;
    };

/**
 * A `YYYY-MM-DD` calendar day at WIB midnight, or null for anything that is not one.
 *
 * Three separate rejections, all of which a crafted payload can reach because a server action is
 * a network endpoint:
 *
 * - a non-string (a JSON number survives `?? ""` and makes `parseDateOnly` throw inside `.trim()`);
 * - a value `new Date` silently rolls over — `"2026-02-30"` parses to 2 March and would be STORED;
 * - a year outside MariaDB's `DATETIME` range, which raises 1292 in strict mode.
 *
 * The round-trip is what closes the last two: `formatDateOnlyJakarta` emits exactly the shape the
 * input carries, so an instant that does not format back to the string it came from was not that
 * calendar day. `parseDateOnly` itself is left alone — it has many other callers and widening its
 * contract is not this feature's business.
 *
 * WIB-anchored rather than a bare `new Date`: production runs UTC, where a plain `YYYY-MM-DD` is
 * read as UTC midnight and lands on the previous WIB calendar day.
 */
function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const parsed = parseDateOnly(trimmed);
  if (!parsed) return null;
  return formatDateOnlyJakarta(parsed) === trimmed ? parsed : null;
}

async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_DELIVER)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

/**
 * `idempotencyKey` is required, not optional: it is the only thing between a double-submit and a
 * second stock movement plus a second SalesHistory row, and a repeat only fails on its own if it
 * exceeds the outstanding qty — a partial delivery would go through twice. Taking an object rather
 * than positional args is what lets it be required after the optional `note`.
 */
export async function recordDeliveryAction(input: {
  orderId: string;
  lines: Array<{ orderLineId: string; qty: number }>;
  note?: string;
  invoiceDate: string;
  dueDate: string;
  idempotencyKey: string;
}): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const { orderId, lines, note, invoiceDate, dueDate, idempotencyKey } = input;
  /* Refuse a malformed key rather than dropping it — passing undefined through restores the unprotected path. */
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "" || idempotencyKey.length > 64) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (!Array.isArray(lines) || lines.some((l) => typeof l.orderLineId !== "string" || !Number.isInteger(l.qty) || l.qty <= 0)) {
    return { ok: false, reason: "OVER_DELIVER" };
  }
  const parsedInvoiceDate = parseCalendarDay(invoiceDate);
  const parsedDueDate = parseCalendarDay(dueDate);
  if (!parsedInvoiceDate || !parsedDueDate) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (parsedDueDate.getTime() < parsedInvoiceDate.getTime()) {
    return { ok: false, reason: "INVALID_DATES" };
  }
  let res: { deliveryId: string; docNo: string };
  try {
    res = await recordFieldSalesDelivery({
      orderId,
      deliveredById: g.userId,
      lines,
      note,
      invoiceDate: parsedInvoiceDate,
      dueDate: parsedDueDate,
      idempotencyKey,
    });
  } catch (e) {
    if (e instanceof DeliveryError) return { ok: false, reason: e.code, shortLines: e.shortLines };
    throw e;
  }

  /**
   * Posted AFTER the writer's transaction commits, not inside it. Every value these journals need
   * is fixed by rows that transaction just created and nothing else can touch them, so posting
   * inside would only stretch an already long serializable window — it holds the delivery, the
   * stock consume, the order-line updates and the SalesHistory rows — for no correctness gain.
   */
  await postArJournalSafely("field_delivery_revenue", res.deliveryId, () =>
    postFieldDeliveryRevenueJournal(res.deliveryId, g.userId),
  );
  await postArJournalSafely("field_delivery_cogs", res.deliveryId, () =>
    postFieldDeliveryCogsJournal(res.deliveryId, g.userId),
  );

  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  return { ok: true };
}

/**
 * Corrects an issued nota's dates. Both move together: they are one document's dating, and
 * letting one shift while the other is frozen reproduces the inverted pair the create path
 * rejects. `docNo` is never touched — the client's immutability rule is about numbers.
 *
 * The audit row is written with `tx.auditLog.create` inside the transaction rather than
 * through `logAudit`, which swallows its own errors by design. A controls trail that can
 * fail silently is worse than none, because its presence is taken as proof.
 *
 * Serializable + compare-and-swap for the same reason. A snapshot read followed by an
 * unconditional update lets two corrections of one nota interleave: both read the same `before`,
 * the second overwrites the first, and BOTH audit rows claim to have started from the original
 * pair — so the trail shows a correction that never happened and loses one that did. The
 * isolation level is what makes the re-read on retry honest; the CAS is what turns a lost update
 * into an explicit `CONFLICT` for the operator who lost the race.
 */
export async function updateDeliveryDatesAction(input: {
  deliveryId: string;
  invoiceDate: string;
  dueDate: string;
  reason: string;
}): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;

  /**
   * Every dereference sits behind its own typeof. An omitted `reason` used to throw on `.trim()`
   * before the guard that would have rejected it, and a thrown server action is digest-masked in
   * production, so the operator saw a generic failure instead of the real reason.
   */
  if (typeof input.deliveryId !== "string" || input.deliveryId === "" || typeof input.reason !== "string") {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  const reason = input.reason.trim();
  if (reason === "") {
    return { ok: false, reason: "INVALID_REQUEST" };
  }

  const parsedInvoiceDate = parseCalendarDay(input.invoiceDate);
  const parsedDueDate = parseCalendarDay(input.dueDate);
  if (!parsedInvoiceDate || !parsedDueDate) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (parsedDueDate.getTime() < parsedInvoiceDate.getTime()) {
    return { ok: false, reason: "INVALID_DATES" };
  }

  const outcome = await runSerializable<
    | { kind: "OK"; orderId: string }
    | { kind: "NOT_FOUND" }
    | { kind: "CONFLICT" }
    | { kind: "HAS_PAYMENTS" }
  >(async (tx) => {
    const before = await tx.fieldSalesDelivery.findUnique({
      where: { id: input.deliveryId },
      select: { id: true, orderId: true, invoiceDate: true, dueDate: true },
    });
    if (!before) return { kind: "NOT_FOUND" };

    /**
     * The read pair is part of the filter, so the write only lands on the row the audit entry is
     * about to describe. A miss means someone else moved it in between; the transaction returns
     * without writing anything, so a `CONFLICT` never leaves an audit row behind. The mariadb
     * driver reports MATCHED rows rather than changed ones (`foundRows` defaults on), so
     * re-submitting the same dates still counts as a hit.
     */
    const swapped = await tx.fieldSalesDelivery.updateMany({
      where: { id: before.id, invoiceDate: before.invoiceDate, dueDate: before.dueDate },
      data: { invoiceDate: parsedInvoiceDate, dueDate: parsedDueDate },
    });
    if (swapped.count === 0) return { kind: "CONFLICT" };

    /**
     * REFUSE once live money has been applied. A payment posts its own DR Cash / CR AR journal dated
     * on `paidAt`, and that date is correct — the cash moved then, and no invoice correction changes
     * when it moved. Re-dating the revenue journal on a paid invoice therefore SPLITS the pair:
     * invoice Jan 1, payment journaled Jan 5, correct the invoice to Feb 1, and revenue lands in
     * February while the receipt stays in January — January carries a credit AR balance and revenue
     * is recognised a month after the cash that settled it.
     *
     * Fail closed, not with a warning: the resulting GL disagreement is silent, permanent, and
     * nothing recomputes a journal's date later. An operator who must re-date a paid invoice voids
     * the payment first — a deliberate, audited act — which restores `paidAmount` to 0 and reopens
     * the correction.
     */
    const receivable = await tx.receivable.findUnique({
      where: { deliveryId: before.id },
      select: { paidAmount: true },
    });
    if (receivable && Number(receivable.paidAmount) > 0) return { kind: "HAS_PAYMENTS" };

    /**
     * The receivable denormalises these dates so the aging list and the overdue sweep read one
     * table. `updateMany`, not `update`: a delivery predating the AR ledger has no receivable, and
     * that must not fail a date correction.
     */
    const receivableSync = await tx.receivable.updateMany({
      where: { deliveryId: before.id },
      data: { invoiceDate: parsedInvoiceDate, dueDate: parsedDueDate },
    });

    /**
     * An invoice-date correction means the sale belongs to a different period, so its journals move
     * with it — otherwise the GL and the AR ledger disagree about which month the revenue is in.
     * Safe only because this system has no period-close mechanism; if one is ever built, this
     * re-dating must be revisited, since it could move revenue into or out of a closed period.
     * The action's existing AuditLog entry is what makes the change traceable.
     */
    const journalRedate = await tx.journal.updateMany({
      where: {
        sourceType: { in: ["FIELD_DELIVERY_REVENUE", "FIELD_DELIVERY_COGS"] },
        sourceId: before.id,
      },
      data: { date: parsedInvoiceDate },
    });

    await tx.auditLog.create({
      data: {
        userId: g.userId,
        action: "UPDATE_DELIVERY_DATES",
        entityType: "FieldSalesDelivery",
        entityId: before.id,
        changes: {
          before: {
            invoiceDate: before.invoiceDate.toISOString(),
            dueDate: before.dueDate.toISOString(),
          },
          after: {
            invoiceDate: parsedInvoiceDate.toISOString(),
            dueDate: parsedDueDate.toISOString(),
          },
          /**
           * `Journal` has no history table and no audit of its own, so this row is the ONLY trail
           * for a mutation of posted GL. `receivablesSynced`/`journalsRedated` are the `updateMany`
           * counts above; `journalsPreviousDate` is `before.invoiceDate` — accurate because a
           * journal's `date` is always kept equal to its delivery's `invoiceDate` by this same
           * action on every prior correction, so the delivery's pre-write snapshot IS the journals'
           * pre-write date.
           */
          receivablesSynced: receivableSync.count,
          journalsRedated: journalRedate.count,
          journalsPreviousDate: before.invoiceDate.toISOString(),
        },
        reason,
      },
    });

    return { kind: "OK", orderId: before.orderId };
  });

  if (outcome.kind === "NOT_FOUND") return { ok: false, reason: "NOT_FOUND" };
  if (outcome.kind === "CONFLICT") return { ok: false, reason: "CONFLICT" };
  if (outcome.kind === "HAS_PAYMENTS") return { ok: false, reason: "RECEIVABLE_HAS_PAYMENTS" };

  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${outcome.orderId}`);
  return { ok: true };
}

type FieldDeliveryJournalKind = "field_delivery_revenue" | "field_delivery_cogs";

export type PostFieldDeliveryJournalsResult =
  | { ok: true; posted: FieldDeliveryJournalKind[]; stillPending: FieldDeliveryJournalKind[] }
  | Extract<DeliveryActionResult, { ok: false }>;

/**
 * Retries the two delivery journals following the shape of `postVanSaleJournalAction`
 * (`apps/web/app/actions/van-sale.ts`).
 *
 * Gated on a JOURNAL_PENDING notification rather than on a missing Journal row: every backfilled
 * receivable has no journal by construction, and re-posting one of those would book revenue for a
 * delivery nobody ever attempted to post.
 *
 * `postArJournalSafely` never throws and never surfaces its inner result — it exists precisely so a
 * failed post cannot fail the caller. That means this action cannot tell "posted" from "attempted
 * and flagged again" from its return value alone: re-checking `isArJournalRetryable` per kind AFTER
 * the attempt is what tells them apart — a kind still retryable after its own attempt did not post.
 * Without this, a still-unmapped role reports `{ ok: true }` to a caller that toasts success while
 * the journal still does not exist.
 */
export async function postFieldDeliveryJournalsAction(deliveryId: string): Promise<PostFieldDeliveryJournalsResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (typeof deliveryId !== "string" || deliveryId === "") return { ok: false, reason: "INVALID_REQUEST" };

  const revenue = await isArJournalRetryable("field_delivery_revenue", deliveryId);
  const cogs = await isArJournalRetryable("field_delivery_cogs", deliveryId);
  if (!revenue && !cogs) return { ok: false, reason: "NOT_RETRYABLE" };

  const posted: FieldDeliveryJournalKind[] = [];
  const stillPending: FieldDeliveryJournalKind[] = [];

  if (revenue) {
    await postArJournalSafely("field_delivery_revenue", deliveryId, () =>
      postFieldDeliveryRevenueJournal(deliveryId, g.userId),
    );
    if (await isArJournalRetryable("field_delivery_revenue", deliveryId)) {
      stillPending.push("field_delivery_revenue");
    } else {
      posted.push("field_delivery_revenue");
    }
  }
  if (cogs) {
    await postArJournalSafely("field_delivery_cogs", deliveryId, () =>
      postFieldDeliveryCogsJournal(deliveryId, g.userId),
    );
    if (await isArJournalRetryable("field_delivery_cogs", deliveryId)) {
      stillPending.push("field_delivery_cogs");
    } else {
      posted.push("field_delivery_cogs");
    }
  }

  /* Same paths `recordDeliveryAction` revalidates after a successful post — the delivery lives on
   * the order's detail page, not a page of its own. */
  const delivery = await prisma.fieldSalesDelivery.findUnique({
    where: { id: deliveryId },
    select: { orderId: true },
  });
  if (delivery) {
    revalidatePath("/backoffice/field-sales-orders");
    revalidatePath(`/backoffice/field-sales-orders/${delivery.orderId}`);
  }

  return { ok: true, posted, stillPending };
}

export async function closeRemainderAction(orderId: string, reason: string): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (reason.trim() === "") return { ok: false, reason: "INVALID_STATE" };
  try {
    await closeFieldSalesOrderRemainder({ orderId, closedById: g.userId, reason: reason.trim() });
  } catch (e) {
    if (e instanceof DeliveryError) return { ok: false, reason: e.code };
    throw e;
  }
  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  return { ok: true };
}

/**
 * Stamps the first print of a nota tagihan and pings finance that a faktur pajak is now due.
 *
 * Compare-and-swap, not read-then-write: a double-click on the print button would otherwise pass
 * a read-then-check twice before either write lands, notifying finance twice for the same
 * document. `updateMany`'s `count` says whether THIS call was the one that flipped
 * `notaPrintedAt` from null — 1 means it genuinely won the first print, 0 means somebody already
 * had (a reprint), which must audit but never notify again.
 *
 * Gated on `FIELD_SALES_ORDERS_VIEW` — the same permission that renders the deliveries card —
 * not a `tax_invoices:*` permission. Requiring faktur authority to print a nota would invert the
 * role separation this feature exists to create.
 *
 * The whole body is one try/catch returning void: the nota is already printed by the time this
 * runs, so a ping failure (or any other failure here) must never surface as a print failure.
 *
 * `logPrint` is wrapped in its OWN try/catch, separate from the outer one: it is the least
 * important write here, but it runs before the CAS, so an unguarded throw from it would abort
 * the whole function and leave `notaPrintedAt` null — vetoing both the stamp and the finance
 * notification because the audit trail hiccuped. Left in its current position (before the CAS)
 * on purpose, so a reprint still gets its own audit row; moving it after the early return would
 * silently stop reprints being audited at all.
 */
export async function recordNotaTagihanPrinted(deliveryId: string): Promise<void> {
  try {
    const session = await auth();
    if (!session?.user?.id) return;
    if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) return;

    try {
      await logPrint("FieldSalesNotaTagihan", deliveryId);
    } catch (err) {
      console.error("[nota-tagihan-print] failed to write the print audit row", err);
    }

    const swapped = await prisma.taxInvoice.updateMany({
      where: { deliveryId, notaPrintedAt: null },
      data: { notaPrintedAt: new Date(), notaPrintedById: session.user.id },
    });
    if (swapped.count !== 1) return;

    const delivery = await prisma.fieldSalesDelivery.findUnique({
      where: { id: deliveryId },
      select: { docNo: true, order: { select: { store: { select: { name: true } } } } },
    });
    if (!delivery) return;

    const storeName = delivery.order.store.name;
    const notification = await prisma.adminNotification.create({
      data: {
        category: "TAX_INVOICE_PENDING",
        severity: "INFO",
        title: `Nota ${delivery.docNo} sudah di-print`,
        message: `Nota ${delivery.docNo} untuk toko ${storeName} sudah di-print. Pastikan buat faktur pajak.`,
        metadata: { deliveryId, docNo: delivery.docNo, storeName },
      },
    });

    void fanOutAdminNotification(notification);
  } catch (err) {
    /* Best-effort: the nota is already printed by the time this runs, so a ping must never fail a print. */
    console.error("[nota-tagihan-print] failed to record print", err);
  }
}
