"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { approveStoreChangeRequest, rejectStoreChangeRequest } from "@/lib/store-changes/writer";

export type StoreChangeActionResult =
  | { ok: true }
  | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" | "INVALID_STATE" | "STORE_GONE" };

async function guard(): Promise<{ userId: string } | { ok: false; reason: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  return { userId: session.user.id };
}

export async function approveStoreChangeRequestAction(requestId: string, storeId: string): Promise<StoreChangeActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const res = await approveStoreChangeRequest({ requestId, reviewerId: g.userId });
  if (!res.ok) return { ok: false, reason: res.code };
  revalidatePath("/backoffice/stores");
  revalidatePath(`/backoffice/stores/${storeId}`);
  return { ok: true };
}

export async function rejectStoreChangeRequestAction(requestId: string, storeId: string, reason: string): Promise<StoreChangeActionResult> {
  const g = await guard();
  if ("ok" in g) return g;
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, reason: "INVALID_STATE" };
  const res = await rejectStoreChangeRequest({ requestId, reviewerId: g.userId, reason: trimmed });
  if (!res.ok) return { ok: false, reason: res.code };
  revalidatePath("/backoffice/stores");
  revalidatePath(`/backoffice/stores/${storeId}`);
  return { ok: true };
}
