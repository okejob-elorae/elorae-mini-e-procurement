"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  createStore,
  updateStore,
  deactivateStore,
  type StoreFields,
} from "@/lib/stores/queries";

type ActionResult<T = never> = { ok: true; data?: T } | { ok: false; code: string; message: string };

const storeInputSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(191),
  address: z.string().min(1),
  phone: z.string().max(64).nullable(),
  contactName: z.string().max(191).nullable(),
  termsType: z.enum(["PUTUS", "KONSI"]),
  paymentTempo: z.number().int().min(0).max(365),
  marginPercent: z.number().min(0).max(999.99).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  checkinRadiusMeters: z.number().int().min(0).max(100000).nullable(),
});

async function requireManage(): Promise<{ ok: true } | ActionResult> {
  const session = await auth();
  if (!session) return { ok: false, code: "forbidden", message: "Permission denied." };
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, code: "forbidden", message: "Permission denied." };
  }
  return { ok: true };
}

export async function createStoreAction(input: StoreFields): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const parsed = storeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: parsed.error.message };
  }
  try {
    const created = await createStore(parsed.data);
    revalidatePath("/backoffice/stores");
    return { ok: true, data: { id: created.id } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, code: "code_unique", message: "Store code already exists." };
    }
    throw e;
  }
}

export async function updateStoreAction(id: string, input: StoreFields): Promise<ActionResult> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const parsed = storeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: parsed.error.message };
  }
  try {
    await updateStore(id, parsed.data);
    revalidatePath("/backoffice/stores");
    revalidatePath(`/backoffice/stores/${id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, code: "code_unique", message: "Store code already exists." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return { ok: false, code: "not_found", message: "Store not found." };
    }
    throw e;
  }
}

export async function deactivateStoreAction(id: string): Promise<ActionResult> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  try {
    await deactivateStore(id);
    revalidatePath("/backoffice/stores");
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return { ok: false, code: "not_found", message: "Store not found." };
    }
    throw e;
  }
}
