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
      reason: "FORBIDDEN" | "NOT_FOUND" | "INVALID_STATE" | "NO_LINES" | "OVER_DELIVER" | "INSUFFICIENT_STOCK";
      shortLines?: Array<{ orderLineId: string; requested: number; onHand: number }>;
    };

async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_DELIVER)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

export async function recordDeliveryAction(
  orderId: string,
  lines: Array<{ orderLineId: string; qty: number }>,
  note?: string,
): Promise<DeliveryActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  if (!Array.isArray(lines) || lines.some((l) => typeof l.orderLineId !== "string" || !Number.isInteger(l.qty) || l.qty <= 0)) {
    return { ok: false, reason: "OVER_DELIVER" };
  }
  try {
    await recordFieldSalesDelivery({ orderId, deliveredById: g.userId, lines, note });
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
