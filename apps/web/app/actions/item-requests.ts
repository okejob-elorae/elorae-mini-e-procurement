"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { assertActor } from "@/lib/auth/assert-actor";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { parseDateOnly } from "@/lib/date-only";
import {
  createRequestFromWo,
  cancelRequestLines,
  convertLinesToPo,
  ItemRequestError,
} from "@/lib/item-requests/mutations";
import { listRequestLines, getRequestDetail, getLastPurchasePrices } from "@/lib/item-requests/queries";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** A user-facing refusal comes back as `{ ok: false }`; anything else still throws. */
async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof ItemRequestError) return { ok: false, error: e.message };
    throw e;
  }
}

async function session(permission: string, userId?: string) {
  const s = await auth();
  if (!s) throw new Error("Unauthorized");
  requirePermission(s.user.permissions, permission);
  if (userId !== undefined) assertActor(s.user.id, userId);
  return s;
}

const statusSchema = z.enum(["OPEN", "CONVERTED", "CANCELLED"]).optional();

export async function getItemRequestLines(filters: { status?: string; search?: string }) {
  await session(PERMISSIONS.ITEM_REQUESTS_VIEW);
  return listRequestLines({ status: statusSchema.parse(filters.status || undefined), search: filters.search?.slice(0, 100) });
}

export async function getItemRequest(id: string) {
  await session(PERMISSIONS.ITEM_REQUESTS_VIEW);
  return getRequestDetail(z.string().min(1).parse(id));
}

export async function getLastPricesForSupplier(itemIds: string[], supplierId: string) {
  await session(PERMISSIONS.ITEM_REQUESTS_VIEW);
  return getLastPurchasePrices(z.array(z.string().min(1)).max(500).parse(itemIds), z.string().min(1).parse(supplierId));
}

export async function createItemRequestFromWo(woId: string, userId: string) {
  const s = await session(PERMISSIONS.ITEM_REQUESTS_MANAGE, userId);
  const res = await guard(() => createRequestFromWo(z.string().min(1).parse(woId), s.user.id));
  if (res.ok && res.created) {
    await logAudit({ userId: s.user.id, action: "CREATE", entityType: "ItemRequest", entityId: res.id, changes: { after: { docNumber: res.docNumber, sourceWoId: woId } } });
  }
  revalidatePath(`/backoffice/work-orders/${woId}`);
  revalidatePath("/backoffice/item-requests");
  return res;
}

export async function cancelItemRequestLines(lineIds: string[], userId: string) {
  const s = await session(PERMISSIONS.ITEM_REQUESTS_MANAGE, userId);
  const ids = z.array(z.string().min(1)).min(1).max(500).parse(lineIds);
  const res = await guard(async () => {
    await cancelRequestLines(ids);
    return {};
  });
  if (res.ok) await logAudit({ userId: s.user.id, action: "CANCEL_LINES", entityType: "ItemRequest", entityId: ids[0], changes: { after: { lineIds: ids } } });
  revalidatePath("/backoffice/item-requests");
  return res;
}

const convertSchema = z.object({
  lineIds: z.array(z.string().min(1)).min(1).max(500),
  supplierId: z.string().min(1),
  prices: z.record(z.string(), z.number().nonnegative()),
  etaDate: z.string().optional(),
});

export async function convertItemRequestLinesToPo(input: z.input<typeof convertSchema>, userId: string) {
  const s = await session(PERMISSIONS.ITEM_REQUESTS_MANAGE, userId);
  requirePermission(s.user.permissions, PERMISSIONS.PURCHASE_ORDERS_CREATE);
  const data = convertSchema.parse(input);
  const res = await guard(() =>
    convertLinesToPo(
      { lineIds: data.lineIds, supplierId: data.supplierId, prices: data.prices, etaDate: data.etaDate ? parseDateOnly(data.etaDate) : null },
      s.user.id
    )
  );
  if (res.ok) {
    await logAudit({ userId: s.user.id, action: "CONVERT_TO_PO", entityType: "PurchaseOrder", entityId: res.id, changes: { after: { docNumber: res.docNumber, lineIds: data.lineIds } } });
  }
  revalidatePath("/backoffice/item-requests");
  revalidatePath("/backoffice/purchase-orders");
  return res;
}
