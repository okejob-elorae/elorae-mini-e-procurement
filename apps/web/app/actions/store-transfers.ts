"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { createStoreTransfer, approveStoreTransfer, cancelStoreTransfer } from "@/lib/stores/transfer/writer";
import { StoreTransferError, type StoreTransferErrorCode } from "@/lib/stores/transfer/errors";
import { getStoreStockForTransfer, type StoreStockOptionRow } from "@/lib/stores/transfer/queries";
import { parseMovedAtInput } from "@/lib/stores/transfer/moved-at";

export type StoreTransferActionResult =
  | { ok: true; id: string; docNo?: string }
  | { ok: false; code: StoreTransferErrorCode | "FORBIDDEN" | "INVALID_REQUEST" | "ERROR"; detail?: string };

export type CreateStoreTransferLineInput = { itemId: string; variantSku: string; qty: number };

export type CreateStoreTransferActionInput = {
  fromStoreId: string;
  toStoreId: string;
  /* A datetime-local value (YYYY-MM-DDTHH:mm), read as WIB. */
  movedAt: string;
  note?: string;
  lines: CreateStoreTransferLineInput[];
};

function isValidLine(l: unknown): l is CreateStoreTransferLineInput {
  if (typeof l !== "object" || l === null) return false;
  const i = l as Record<string, unknown>;
  return (
    typeof i.itemId === "string" &&
    i.itemId !== "" &&
    typeof i.variantSku === "string" &&
    typeof i.qty === "number" &&
    Number.isFinite(i.qty) &&
    i.qty > 0
  );
}

function isValidCreateInput(input: unknown): input is CreateStoreTransferActionInput {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.fromStoreId !== "string" || i.fromStoreId === "") return false;
  if (typeof i.toStoreId !== "string" || i.toStoreId === "") return false;
  if (typeof i.movedAt !== "string") return false;
  if (i.note !== undefined && typeof i.note !== "string") return false;
  if (!Array.isArray(i.lines) || i.lines.length === 0) return false;
  return i.lines.every(isValidLine);
}

/**
 * Every user-visible string this document produces goes through the SAME error-code union the
 * writer throws — `StoreTransferError`'s codes plus the action-layer three (`FORBIDDEN`,
 * `INVALID_REQUEST`, `ERROR`). Nothing enforces that at compile time — both clients build their
 * locale key with a plain template literal (`err.${code}`) and pass a bare `string` to `t(...)`,
 * and no `IntlMessages` augmentation exists anywhere in `apps/web`, so `tsc` stays silent either
 * way. Keeping every code covered in BOTH `en.json`/`id.json` is a review discipline, not a
 * compiler guarantee — miss one and the operator reads the raw `err.<CODE>` key off the screen
 * instead of a type error at build time. The stocktake doc numbers a `COUNTED_SINCE_MOVE`
 * refusal names ride in `detail`, which both clients pass to the copy as `{detail}`.
 */
function toResult(e: unknown): StoreTransferActionResult {
  if (e instanceof StoreTransferError) return e.detail ? { ok: false, code: e.code, detail: e.detail } : { ok: false, code: e.code };
  return { ok: false, code: "ERROR" };
}

/**
 * Creates a PENDING transfer. `stores:manage` — the same permission that gates opening a store
 * stocktake — because this, like that document, moves consignment stock on a store's behalf
 * rather than reading it. The writer's own `SAME_STORE`/`NO_LINES`/`BAD_QTY`/`MOVED_AT_IN_FUTURE`/
 * `ITEM_NOT_FOUND` guards still run regardless of what this input check catches, since this action
 * is callable independently of whatever the form ever sends. A move time that does not round-trip
 * through WIB (`parseMovedAtInput`) is `INVALID_REQUEST`, never a domain code.
 */
export async function createStoreTransferAction(
  input: CreateStoreTransferActionInput,
): Promise<StoreTransferActionResult> {
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (!isValidCreateInput(input)) return { ok: false, code: "INVALID_REQUEST" };
    const movedAt = parseMovedAtInput(input.movedAt);
    if (!movedAt) return { ok: false, code: "INVALID_REQUEST" };

    const { transferId, docNo } = await createStoreTransfer({
      fromStoreId: input.fromStoreId,
      toStoreId: input.toStoreId,
      movedAt,
      note: input.note?.trim() || null,
      createdById: session.user.id,
      lines: input.lines,
    });

    revalidatePath("/backoffice/store-transfers");
    revalidatePath(`/backoffice/store-transfers/${transferId}`);
    return { ok: true, id: transferId, docNo };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Approves a transfer, moving stock out of the source and into the destination in one
 * transaction (see `approveStoreTransfer`). `stores:manage`, same as the create side and the
 * store stocktake approve action — this repo does not seed RBAC rows on deploy, and reusing an
 * existing, already-seeded permission means this screen needs no post-merge SQL step at all.
 */
export async function approveStoreTransferAction(transferId: string): Promise<StoreTransferActionResult> {
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (typeof transferId !== "string" || transferId === "") return { ok: false, code: "INVALID_REQUEST" };

    await approveStoreTransfer({ transferId, approvedById: session.user.id });

    revalidatePath("/backoffice/store-transfers");
    revalidatePath(`/backoffice/store-transfers/${transferId}`);
    return { ok: true, id: transferId };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Cancels a PENDING transfer — no stock has moved yet, so this is a pure status flip (see
 * `cancelStoreTransfer`'s doc comment for why it moves nothing). Same `stores:manage` gate as
 * create/approve; the writer's own CAS is what actually stops this from ever reaching an
 * APPROVED transfer, regardless of what this action or the UI ever check.
 */
export async function cancelStoreTransferAction(transferId: string): Promise<StoreTransferActionResult> {
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (typeof transferId !== "string" || transferId === "") return { ok: false, code: "INVALID_REQUEST" };

    await cancelStoreTransfer({ transferId, cancelledById: session.user.id });

    revalidatePath("/backoffice/store-transfers");
    revalidatePath(`/backoffice/store-transfers/${transferId}`);
    return { ok: true, id: transferId };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Read-only lookup backing the create form's item picker: what the selected source store
 * currently holds, refetched every time the source store changes. Gated on `stores:view` (the
 * read permission this whole document family uses) rather than `stores:manage` — a viewer who
 * can see the store detail's stock card can see the same figures here. Returns an empty list on
 * any auth failure instead of throwing, since this backs a picker rather than a mutation and an
 * empty picker is the correct degraded state for someone who should not be filling this form out
 * in the first place.
 */
export async function getSourceStockAction(storeId: string): Promise<StoreStockOptionRow[]> {
  const session = await auth();
  const permissions = session?.user?.permissions ?? [];
  if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_VIEW)) return [];
  if (typeof storeId !== "string" || storeId === "") return [];
  return getStoreStockForTransfer(storeId);
}
