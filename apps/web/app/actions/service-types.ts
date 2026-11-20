"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { listServiceTypes, getServiceTypeById } from "@/lib/service-types/queries";
import {
  createServiceType,
  updateServiceType,
  deleteServiceType,
  createServiceTypeSchema,
  updateServiceTypeSchema,
  ServiceTypeError,
} from "@/lib/service-types/mutations";

export type HasilJenisJasa =
  | { ok: true; id?: string }
  | { ok: false; code: "DUPLICATE_CODE" | "IN_USE" | "FAILED"; count?: number };

function keHasil(e: unknown): HasilJenisJasa {
  if (e instanceof ServiceTypeError) return { ok: false, code: e.code, count: e.count };
  console.error(e);
  return { ok: false, code: "FAILED" };
}

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

export async function listServiceTypesAction(opts?: {
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
  withUsage?: boolean;
}) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_VIEW);
  return listServiceTypes(opts);
}

export async function getServiceTypeByIdAction(id: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_VIEW);
  return getServiceTypeById(id);
}

export async function createServiceTypeAction(
  input: z.infer<typeof createServiceTypeSchema>,
): Promise<HasilJenisJasa> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_MANAGE);
  try {
    const row = await createServiceType(input);
    revalidatePath("/backoffice/service-types");
    return { ok: true, id: row.id };
  } catch (e) {
    return keHasil(e);
  }
}

export async function updateServiceTypeAction(
  id: string,
  input: z.infer<typeof updateServiceTypeSchema>,
): Promise<HasilJenisJasa> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_MANAGE);
  try {
    await updateServiceType(id, input);
  } catch (e) {
    return keHasil(e);
  }
  revalidatePath("/backoffice/service-types");
  return { ok: true };
}

export async function deleteServiceTypeAction(id: string): Promise<HasilJenisJasa> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_MANAGE);
  try {
    await deleteServiceType(id);
  } catch (e) {
    return keHasil(e);
  }
  revalidatePath("/backoffice/service-types");
  return { ok: true };
}
