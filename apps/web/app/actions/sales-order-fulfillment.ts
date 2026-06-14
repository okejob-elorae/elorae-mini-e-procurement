"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  markOrderShipped,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { syncJubelioCouriers } from "@/app/actions/jubelio-couriers";

export type FulfillmentActionResult = { ok: true } | { ok: false; reason: string };
export type CourierOption = { id: number; name: string };

async function requireFulfillSession(): Promise<{ userId: string }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SALES_ORDERS_FULFILL);
  return { userId: session.user.id };
}

export async function finishPickAction(orderId: string): Promise<FulfillmentActionResult> {
  const { userId } = await requireFulfillSession();
  try {
    await markOrderPicked(prisma, { orderId, userId });
  } catch (err) {
    if (err instanceof InvalidFulfillmentTransition) {
      return { ok: false, reason: err.message };
    }
    throw err;
  }
  revalidatePath(`/backoffice/sales-orders/${orderId}`);
  return { ok: true };
}

export async function finishPackAction(orderId: string): Promise<FulfillmentActionResult> {
  const { userId } = await requireFulfillSession();
  try {
    await markOrderPacked(prisma, { orderId, userId });
  } catch (err) {
    if (err instanceof InvalidFulfillmentTransition) {
      return { ok: false, reason: err.message };
    }
    throw err;
  }
  revalidatePath(`/backoffice/sales-orders/${orderId}`);
  return { ok: true };
}

export async function shipOrderAction(
  orderId: string,
  courierId: number,
): Promise<FulfillmentActionResult> {
  const { userId } = await requireFulfillSession();
  try {
    await markOrderShipped(prisma, { orderId, userId, courierId });
  } catch (err) {
    if (err instanceof InvalidFulfillmentTransition) {
      return { ok: false, reason: err.message };
    }
    throw err;
  }
  revalidatePath(`/backoffice/sales-orders/${orderId}`);
  return { ok: true };
}

export async function getCouriersForShipDialog(): Promise<CourierOption[]> {
  await requireFulfillSession();

  const count = await prisma.jubelioCourier.count();
  if (count === 0) {
    await syncJubelioCouriers();
  }

  const rows = await prisma.jubelioCourier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows;
}
