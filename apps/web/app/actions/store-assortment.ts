"use server";

import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/**
 * Reference data only — no document, no status, no lifecycle. `id` doubles as the created row's
 * id on a successful add, and as the acted-on row's id on a successful update/remove, so the UI
 * never has to re-fetch just to know which line it touched.
 */
export type StoreAssortmentActionResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      code: "FORBIDDEN" | "ITEM_NOT_FOUND" | "DUPLICATE_LINE" | "INVALID_REQUEST" | "NOT_FOUND" | "ERROR";
    };

export type AddAssortmentLineInput = {
  storeId: string;
  itemId: string;
  variantSku: string;
  targetQty: number | null;
};

export type UpdateAssortmentTargetInput = {
  id: string;
  storeId: string;
  targetQty: number | null;
};

export type RemoveAssortmentLineInput = {
  id: string;
  storeId: string;
};

/**
 * `null` is a meaningful, storable value here — "must merely be present at all" — never coerced
 * to 0. A supplied number must be positive: zero and negative are both meaningless as a target,
 * so both are refused as a shape error (`INVALID_REQUEST`), not a domain refusal.
 */
function isValidTargetQty(v: unknown): v is number | null {
  if (v === null) return true;
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isValidAddInput(input: unknown): input is AddAssortmentLineInput {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.storeId !== "string" || i.storeId === "") return false;
  if (typeof i.itemId !== "string" || i.itemId === "") return false;
  if (typeof i.variantSku !== "string") return false;
  if (!isValidTargetQty(i.targetQty)) return false;
  return true;
}

function isValidUpdateInput(input: unknown): input is UpdateAssortmentTargetInput {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.id !== "string" || i.id === "") return false;
  if (typeof i.storeId !== "string" || i.storeId === "") return false;
  if (!isValidTargetQty(i.targetQty)) return false;
  return true;
}

function isValidRemoveInput(input: unknown): input is RemoveAssortmentLineInput {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.id !== "string" || i.id === "") return false;
  if (typeof i.storeId !== "string" || i.storeId === "") return false;
  return true;
}

/**
 * Anything that isn't a narrowed P2002 becomes `ERROR` rather than leaking a thrown message —
 * production digest-masking would swallow it anyway. The P2002 narrowing exists as a fallback
 * only: `addAssortmentLineAction` checks for the existing row itself before writing, so this
 * only fires on a genuine race between that check and the `create` call.
 */
function toResult(e: unknown): StoreAssortmentActionResult {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return { ok: false, code: "DUPLICATE_LINE" };
  }
  return { ok: false, code: "ERROR" };
}

/**
 * Adds one line to a store's configured assortment. `stores:manage`-gated, and the permission
 * check, `auth()` and the write all sit inside the one try/catch below — a throwing `auth()`
 * (a corrupted session cookie, a DB hiccup during the session lookup) must come back as a typed
 * `ERROR`, never escape as an opaque production digest. This repo shipped exactly that bug once
 * already, missed by three tests that each rejected the writer mock instead of `auth()` itself.
 *
 * `itemId` is verified to exist before the write because `relationMode = "prisma"` means there is
 * no database FK backing the required `item` relation — a dangling id would otherwise write a row
 * the store assortment page can never render again (`Inconsistent query result`, no UI repair
 * path). A duplicate `(storeId, itemId, variantSku)` is checked for up front so it returns a typed
 * `DUPLICATE_LINE` on the common path, with the `P2002` catch in `toResult` as a race-only
 * fallback.
 */
export async function addAssortmentLineAction(input: AddAssortmentLineInput): Promise<StoreAssortmentActionResult> {
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (!isValidAddInput(input)) return { ok: false, code: "INVALID_REQUEST" };

    const item = await prisma.item.findUnique({ where: { id: input.itemId }, select: { id: true } });
    if (!item) return { ok: false, code: "ITEM_NOT_FOUND" };

    const existing = await prisma.storeAssortmentLine.findUnique({
      where: {
        storeId_itemId_variantSku: { storeId: input.storeId, itemId: input.itemId, variantSku: input.variantSku },
      },
      select: { id: true },
    });
    if (existing) return { ok: false, code: "DUPLICATE_LINE" };

    const created = await prisma.storeAssortmentLine.create({
      data: {
        storeId: input.storeId,
        itemId: input.itemId,
        variantSku: input.variantSku,
        targetQty: input.targetQty,
        createdById: session.user.id,
      },
      select: { id: true },
    });

    revalidatePath(`/backoffice/stores/${input.storeId}`);
    return { ok: true, id: created.id };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Updates the target quantity on an existing line. `(id, storeId)` together scope the write —
 * `storeId` is not a security boundary here (`stores:manage` is a global permission, not a
 * per-store one), it just keeps a mismatched `storeId` from silently editing one store's line
 * while revalidating a different store's detail page. `targetQty: null` is accepted and stored
 * as-is, same as on add.
 */
export async function updateAssortmentTargetAction(
  input: UpdateAssortmentTargetInput,
): Promise<StoreAssortmentActionResult> {
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (!isValidUpdateInput(input)) return { ok: false, code: "INVALID_REQUEST" };

    const result = await prisma.storeAssortmentLine.updateMany({
      where: { id: input.id, storeId: input.storeId },
      data: { targetQty: input.targetQty },
    });
    if (result.count === 0) return { ok: false, code: "NOT_FOUND" };

    revalidatePath(`/backoffice/stores/${input.storeId}`);
    return { ok: true, id: input.id };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Removes a line from a store's configured assortment. No document, no status, no soft-delete —
 * this is reference data, so the row is just gone. Same `(id, storeId)` scoping as the update
 * above, for the same reason.
 */
export async function removeAssortmentLineAction(input: RemoveAssortmentLineInput): Promise<StoreAssortmentActionResult> {
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (!isValidRemoveInput(input)) return { ok: false, code: "INVALID_REQUEST" };

    const result = await prisma.storeAssortmentLine.deleteMany({
      where: { id: input.id, storeId: input.storeId },
    });
    if (result.count === 0) return { ok: false, code: "NOT_FOUND" };

    revalidatePath(`/backoffice/stores/${input.storeId}`);
    return { ok: true, id: input.id };
  } catch (e) {
    return toResult(e);
  }
}
