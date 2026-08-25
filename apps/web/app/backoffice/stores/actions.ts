"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { searchPlacesViaSerpApi } from "@/lib/geo/search-places";
import type { SerpPlaceResult } from "@/lib/geo/serpapi-maps";
import {
  createStore,
  updateStore,
  deactivateStore,
  StoreHasConsignmentStockError,
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

async function requireManage(): Promise<
  { ok: true; userId: string } | { ok: false; code: string; message: string }
> {
  const session = await auth();
  if (!session) return { ok: false, code: "forbidden", message: "Permission denied." };
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, code: "forbidden", message: "Permission denied." };
  }
  return { ok: true, userId: session.user.id };
}

/** In-process cooldown for SerpAPI place search (paid quota). */
const PLACE_SEARCH_COOLDOWN_MS = 2_000;
const lastPlaceSearchAtByUser = new Map<string, number>();

function takePlaceSearchSlot(userId: string): boolean {
  const now = Date.now();
  const last = lastPlaceSearchAtByUser.get(userId) ?? 0;
  if (now - last < PLACE_SEARCH_COOLDOWN_MS) return false;
  lastPlaceSearchAtByUser.set(userId, now);
  if (lastPlaceSearchAtByUser.size > 500) {
    for (const [id, at] of lastPlaceSearchAtByUser) {
      if (now - at > PLACE_SEARCH_COOLDOWN_MS * 10) lastPlaceSearchAtByUser.delete(id);
    }
  }
  return true;
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
    if (e instanceof StoreHasConsignmentStockError) {
      return {
        ok: false,
        code: "has_consignment_stock",
        message: "This store still holds consignment stock and must return or transfer it before switching off Konsi.",
      };
    }
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

const placeSearchSchema = z.object({
  q: z.string().min(1).max(500),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

/** Whether SerpAPI place search is configured (no key leaked). */
export async function getPlaceSearchAvailabilityAction(): Promise<{ configured: boolean }> {
  const gate = await requireManage();
  if (!gate.ok) return { configured: false };
  return { configured: Boolean(process.env.SERPAPI_KEY?.trim()) };
}

export async function searchStorePlacesAction(input: {
  q: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<
  | { ok: true; results: SerpPlaceResult[] }
  | {
      ok: false;
      code: "FORBIDDEN" | "EMPTY_QUERY" | "NO_API_KEY" | "UPSTREAM" | "RATE_LIMITED" | "validation";
      message: string;
    }
> {
  const gate = await requireManage();
  if (!gate.ok) return { ok: false, code: "FORBIDDEN", message: "Permission denied." };

  const parsed = placeSearchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: parsed.error.message };
  }

  if (!takePlaceSearchSlot(gate.userId)) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "Please wait a moment before searching again.",
    };
  }

  const result = await searchPlacesViaSerpApi({
    q: parsed.data.q,
    lat: parsed.data.lat ?? null,
    lng: parsed.data.lng ?? null,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  return { ok: true, results: result.results };
}
