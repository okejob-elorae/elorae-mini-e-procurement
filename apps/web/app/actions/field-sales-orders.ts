"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { approveFieldSalesOrder, rejectFieldSalesOrder } from "@/lib/field-sales/writer";
import { InvalidOrderTransitionError } from "@/lib/field-sales/errors";

export type ActionResult = { ok: true } | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" | "INVALID_TRANSITION" };

async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

export async function approveFieldSalesOrderAction(orderId: string): Promise<ActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  try {
    await approveFieldSalesOrder({ orderId, approvedById: g.userId });
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return { ok: false, reason: e.from === "MISSING" ? "NOT_FOUND" : "INVALID_TRANSITION" };
    }
    throw e;
  }
  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  return { ok: true };
}

export async function rejectFieldSalesOrderAction(orderId: string, reason: string): Promise<ActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  try {
    await rejectFieldSalesOrder({ orderId, rejectedById: g.userId, reason: reason.trim() || undefined });
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return { ok: false, reason: e.from === "MISSING" ? "NOT_FOUND" : "INVALID_TRANSITION" };
    }
    throw e;
  }
  revalidatePath("/backoffice/field-sales-orders");
  revalidatePath(`/backoffice/field-sales-orders/${orderId}`);
  return { ok: true };
}
