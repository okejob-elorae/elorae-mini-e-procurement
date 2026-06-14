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
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { syncJubelioCouriers } from "@/app/actions/jubelio-couriers";

export const FULFILLMENT_FORBIDDEN_REASON = "forbidden";

export type FulfillmentActionResult = { ok: true } | { ok: false; reason: string };
export type CourierOption = { id: number; name: string };

type Authorized = { userId: string };

async function authorize(): Promise<Authorized | FulfillmentActionResult> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  if (!hasPermission(session.user.permissions, PERMISSIONS.SALES_ORDERS_FULFILL)) {
    return { ok: false, reason: FULFILLMENT_FORBIDDEN_REASON };
  }
  return { userId: session.user.id };
}

function isResult(v: Authorized | FulfillmentActionResult): v is FulfillmentActionResult {
  return "ok" in v;
}

export async function finishPickAction(orderId: string): Promise<FulfillmentActionResult> {
  const auth = await authorize();
  if (isResult(auth)) return auth;
  try {
    await markOrderPicked(prisma, { orderId, userId: auth.userId });
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
  const auth = await authorize();
  if (isResult(auth)) return auth;
  try {
    await markOrderPacked(prisma, { orderId, userId: auth.userId });
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
  const auth = await authorize();
  if (isResult(auth)) return auth;
  try {
    await markOrderShipped(prisma, { orderId, userId: auth.userId, courierId });
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
  const auth = await authorize();
  if (isResult(auth)) return [];

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
