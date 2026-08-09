"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordFieldSalesDelivery, closeFieldSalesOrderRemainder } from "@/lib/field-sales/delivery/writer";
import { DeliveryError } from "@/lib/field-sales/errors";

export type DeliveryActionResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "INVALID_REQUEST"
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
  idempotencyKey: string;
}): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const { orderId, lines, note, idempotencyKey } = input;
  /* Refuse a malformed key rather than dropping it — passing undefined through restores the unprotected path. */
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "" || idempotencyKey.length > 64) {
    return { ok: false, reason: "INVALID_REQUEST" };
  }
  if (!Array.isArray(lines) || lines.some((l) => typeof l.orderLineId !== "string" || !Number.isInteger(l.qty) || l.qty <= 0)) {
    return { ok: false, reason: "OVER_DELIVER" };
  }
  try {
    await recordFieldSalesDelivery({ orderId, deliveredById: g.userId, lines, note, idempotencyKey });
  } catch (e) {
    if (e instanceof DeliveryError) return { ok: false, reason: e.code, shortLines: e.shortLines };
    throw e;
  }
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
