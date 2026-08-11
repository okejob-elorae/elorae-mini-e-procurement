"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordFieldSalesDelivery, closeFieldSalesOrderRemainder } from "@/lib/field-sales/delivery/writer";
import { DeliveryError } from "@/lib/field-sales/errors";
import { parseDateOnly } from "@/lib/date-only";

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
        | "NO_LINES"
        | "OVER_DELIVER"
        | "INSUFFICIENT_STOCK";
      shortLines?: Array<{ orderLineId: string; requested: number; onHand: number }>;
    };

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
  /**
   * Parsed WIB-anchored rather than with a bare `new Date`: production runs UTC, where a
   * plain `YYYY-MM-DD` is read as UTC midnight and lands on the previous WIB calendar day.
   */
  const parsedInvoiceDate = parseDateOnly(invoiceDate ?? "");
  const parsedDueDate = parseDateOnly(dueDate ?? "");
  if (!parsedInvoiceDate || !parsedDueDate) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (parsedDueDate.getTime() < parsedInvoiceDate.getTime()) {
    return { ok: false, reason: "INVALID_DATES" };
  }
  try {
    await recordFieldSalesDelivery({
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
 */
export async function updateDeliveryDatesAction(input: {
  deliveryId: string;
  invoiceDate: string;
  dueDate: string;
  reason: string;
}): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;

  const reason = input.reason.trim();
  if (typeof input.deliveryId !== "string" || input.deliveryId === "" || reason === "") {
    return { ok: false, reason: "INVALID_REQUEST" };
  }

  const parsedInvoiceDate = parseDateOnly(input.invoiceDate ?? "");
  const parsedDueDate = parseDateOnly(input.dueDate ?? "");
  if (!parsedInvoiceDate || !parsedDueDate) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (parsedDueDate.getTime() < parsedInvoiceDate.getTime()) {
    return { ok: false, reason: "INVALID_DATES" };
  }

  const orderId = await prisma.$transaction(async (tx) => {
    const before = await tx.fieldSalesDelivery.findUnique({
      where: { id: input.deliveryId },
      select: { id: true, orderId: true, invoiceDate: true, dueDate: true },
    });
    if (!before) return null;

    await tx.fieldSalesDelivery.update({
      where: { id: before.id },
      data: { invoiceDate: parsedInvoiceDate, dueDate: parsedDueDate },
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
        },
        reason,
      },
    });

    return before.orderId;
  });

  if (!orderId) return { ok: false, reason: "NOT_FOUND" };

  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  return { ok: true };
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
