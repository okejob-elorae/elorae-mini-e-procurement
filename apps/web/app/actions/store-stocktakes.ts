"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getActiveVisit } from "@/lib/stores/queries";
import {
  createStoreStocktake,
  saveStocktakeCounts,
  approveStoreStocktake,
  cancelStoreStocktake,
} from "@/lib/stores/stocktake/writer";
import { StoreStocktakeError, type StoreStocktakeErrorCode } from "@/lib/stores/stocktake/errors";

export type StoreStocktakeActionResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      code:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "ALREADY_OPEN"
        | "VARIANCE_NEEDS_REASON"
        | "SHORTFALL_NEEDS_CAUSE"
        | "ITEM_NOT_FOUND"
        | "INVALID_REQUEST"
        | "DUPLICATE_LINE"
        | "NO_ACTIVE_VISIT"
        | "ERROR";
    };

type CauseValue = "SHRINKAGE" | "UNRECORDED_SALE";
const CAUSE_VALUES: ReadonlySet<string> = new Set(["SHRINKAGE", "UNRECORDED_SALE"]);

type SaveCountsLineInput = { lineId: string; countedQty: number | null; cause?: CauseValue | null; reason?: string | null };
type SaveCountsAddedLineInput = {
  itemId: string;
  variantSku: string;
  countedQty: number | null;
  cause?: CauseValue | null;
  reason?: string | null;
};

/**
 * Exactly one of `stocktakeId` / `storeId` — never both, never neither. `stocktakeId` covers the
 * admin path AND an SPG filling a document the admin already opened; `storeId` is the SPG-only
 * create-if-absent path (see `saveCountsAction` below for why it must stay SPG-only).
 */
export type SaveCountsActionInput =
  | { stocktakeId: string; lines: SaveCountsLineInput[]; addedLines?: SaveCountsAddedLineInput[]; submit?: boolean }
  | { storeId: string; lines: SaveCountsLineInput[]; addedLines?: SaveCountsAddedLineInput[]; submit?: boolean };

/**
 * Every `StoreStocktakeErrorCode` maps onto its own result code, one to one — a `Record` over
 * the whole union means a future code added to `errors.ts` fails TypeScript here instead of
 * silently collapsing into `ERROR`. In particular `INVALID_REQUEST` here is the writer's OWN
 * shape-error code (a malformed line, an unknown lineId, a bad qty) and must never be conflated
 * with a domain refusal such as `ALREADY_OPEN` or `SHORTFALL_NEEDS_CAUSE` — that conflation has
 * shipped before in this repo and is still open debt.
 */
const ERROR_CODE_MAP: Record<StoreStocktakeErrorCode, Exclude<StoreStocktakeActionResult, { ok: true }>["code"]> = {
  NOT_FOUND: "NOT_FOUND",
  INVALID_STATE: "INVALID_STATE",
  ALREADY_OPEN: "ALREADY_OPEN",
  VARIANCE_NEEDS_REASON: "VARIANCE_NEEDS_REASON",
  SHORTFALL_NEEDS_CAUSE: "SHORTFALL_NEEDS_CAUSE",
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  INVALID_REQUEST: "INVALID_REQUEST",
  DUPLICATE_LINE: "DUPLICATE_LINE",
};

/**
 * A caught `StoreStocktakeError` keeps its own code via the map above; anything else (a network
 * hiccup, a programmer error, `auth()` itself throwing) becomes `ERROR` rather than leaking a
 * thrown message — production digest-masking would swallow it anyway.
 */
function toResult(e: unknown): StoreStocktakeActionResult {
  if (e instanceof StoreStocktakeError) return { ok: false, code: ERROR_CODE_MAP[e.code] };
  return { ok: false, code: "ERROR" };
}

function isValidCreateInput(input: unknown): input is { storeId: string; countedAt: string } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.storeId !== "string" || i.storeId === "") return false;
  if (typeof i.countedAt !== "string" || i.countedAt === "") return false;
  return Number.isFinite(new Date(i.countedAt).getTime());
}

function isValidCountsLine(l: unknown): l is SaveCountsLineInput {
  if (typeof l !== "object" || l === null) return false;
  const ll = l as Record<string, unknown>;
  if (typeof ll.lineId !== "string" || ll.lineId === "") return false;
  if (ll.countedQty !== null && typeof ll.countedQty !== "number") return false;
  if (ll.cause !== undefined && ll.cause !== null && !CAUSE_VALUES.has(ll.cause as string)) return false;
  if (ll.reason !== undefined && ll.reason !== null && typeof ll.reason !== "string") return false;
  return true;
}

function isValidAddedLine(l: unknown): l is SaveCountsAddedLineInput {
  if (typeof l !== "object" || l === null) return false;
  const ll = l as Record<string, unknown>;
  if (typeof ll.itemId !== "string" || ll.itemId === "") return false;
  if (typeof ll.variantSku !== "string") return false;
  if (ll.countedQty !== null && typeof ll.countedQty !== "number") return false;
  if (ll.cause !== undefined && ll.cause !== null && !CAUSE_VALUES.has(ll.cause as string)) return false;
  if (ll.reason !== undefined && ll.reason !== null && typeof ll.reason !== "string") return false;
  return true;
}

/**
 * Shape guard for the whole request, ahead of anything domain-specific. `stocktakeId` XOR
 * `storeId` is enforced here — supplying both or neither is `INVALID_REQUEST`, never a domain
 * code, exactly like a malformed line or a non-array `lines`.
 */
function isValidSaveCountsInput(input: unknown): input is {
  stocktakeId?: string;
  storeId?: string;
  lines: SaveCountsLineInput[];
  addedLines?: SaveCountsAddedLineInput[];
  submit?: boolean;
} {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  const hasStocktakeId = typeof i.stocktakeId === "string" && i.stocktakeId !== "";
  const hasStoreId = typeof i.storeId === "string" && i.storeId !== "";
  if (hasStocktakeId === hasStoreId) return false;
  if (!Array.isArray(i.lines) || !i.lines.every(isValidCountsLine)) return false;
  if (i.addedLines !== undefined && (!Array.isArray(i.addedLines) || !i.addedLines.every(isValidAddedLine))) return false;
  if (i.submit !== undefined && typeof i.submit !== "boolean") return false;
  return true;
}

function isValidCancelInput(input: unknown): input is { stocktakeId: string; reason: string } {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  if (typeof i.stocktakeId !== "string" || i.stocktakeId === "") return false;
  if (typeof i.reason !== "string") return false;
  return true;
}

/**
 * Mirrors the gate `recordSpgSaleAction` (`@/app/actions/spg-sale.ts`) already uses: look up the
 * user's fixed `assignedStoreId`, then require an active check-in AT that same store. That gate
 * has two distinct refusal reasons (no assigned store at all / not currently checked in there),
 * but this action's result union only carries `NO_ACTIVE_VISIT` — both collapse onto it here,
 * since from the caller's point of view neither leaves them able to submit a count right now.
 */
async function requireSpgActiveStore(userId: string): Promise<{ ok: true; storeId: string } | { ok: false; code: "NO_ACTIVE_VISIT" }> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true } });
  if (!me?.assignedStoreId) return { ok: false, code: "NO_ACTIVE_VISIT" };
  const activeVisit = await getActiveVisit(userId);
  if (!activeVisit || activeVisit.storeId !== me.assignedStoreId) {
    return { ok: false, code: "NO_ACTIVE_VISIT" };
  }
  return { ok: true, storeId: me.assignedStoreId };
}

/**
 * Opens a new count for a store. Admin-only (`stores:manage`) — the SPG never opens a document
 * directly, only fills/submits one via `saveCountsAction`. Works identically for a store with no
 * SPG assigned at all, which is the primary path this feature exists for.
 *
 * `auth()`, the permission check and the writer call all sit inside the one try/catch below —
 * a throwing `auth()` (a corrupted session cookie, a DB hiccup during the session lookup) must
 * come back as a typed `ERROR`, never escape as an opaque production digest.
 */
export async function createAction(input: { storeId: string; countedAt: string }): Promise<StoreStocktakeActionResult> {
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (!isValidCreateInput(input)) return { ok: false, code: "INVALID_REQUEST" };
    const created = await createStoreStocktake({
      storeId: input.storeId,
      createdById: session.user.id,
      countedAt: new Date(input.countedAt),
    });
    revalidatePath("/backoffice/store-stocktakes");
    revalidatePath(`/backoffice/store-stocktakes/${created.id}`);
    revalidatePath(`/backoffice/stores/${input.storeId}`);
    return { ok: true, id: created.id };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Writes counts onto a document. Two shapes:
 *
 * - `{ stocktakeId }` — an admin (`stores:manage`) editing/saving/submitting a document they (or
 *   another admin) already opened, OR an SPG (`spg_sales:record`) filling a document the admin
 *   opened first. The SPG branch re-verifies the document's own `storeId` against the SPG's
 *   active-visit store — the id alone is not proof of ownership, since every export here is an
 *   independently callable endpoint regardless of what the UI ever offers.
 * - `{ storeId }` — SPG-only create-if-absent. Reachable ONLY when the caller holds
 *   `spg_sales:record` and is actively checked in at that exact store; an admin can never reach
 *   this branch (it is gated on the SPG permission before anything else), which matters because
 *   this branch swallows `ALREADY_OPEN` by design (it reuses the existing open document instead
 *   of refusing) — letting an admin in here would let them dodge the `ALREADY_OPEN` refusal the
 *   `createAction` path deliberately enforces.
 *
 * Either way the SPG always lands the document in `PENDING_VERIFICATION` (`submit` is forced
 * true on that path) — an SPG count is, by definition, a submission for an admin to verify, never
 * a draft save. The admin path defaults `submit` to `false` (a draft save) unless the caller asks
 * for `true`.
 */
export async function saveCountsAction(input: SaveCountsActionInput): Promise<StoreStocktakeActionResult> {
  let stocktakeId = "";
  let storeIdForRevalidate = "";
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, code: "FORBIDDEN" };
    const permissions = session.user.permissions ?? [];
    const isAdmin = hasPermission(permissions, PERMISSIONS.STORES_MANAGE);
    const isSpg = hasPermission(permissions, PERMISSIONS.SPG_SALES_RECORD);
    if (!isAdmin && !isSpg) return { ok: false, code: "FORBIDDEN" };
    if (!isValidSaveCountsInput(input)) return { ok: false, code: "INVALID_REQUEST" };

    let submit = input.submit ?? false;

    if (input.storeId) {
      if (!isSpg) return { ok: false, code: "FORBIDDEN" };
      const gate = await requireSpgActiveStore(session.user.id);
      if (!gate.ok) return gate;
      if (gate.storeId !== input.storeId) return { ok: false, code: "FORBIDDEN" };

      const open = await prisma.storeStocktake.findFirst({
        where: { storeId: input.storeId, openKey: { not: null } },
        select: { id: true },
      });
      stocktakeId = open
        ? open.id
        : (await createStoreStocktake({ storeId: input.storeId, createdById: session.user.id, countedAt: new Date() })).id;
      storeIdForRevalidate = input.storeId;
      submit = true;
    } else {
      stocktakeId = input.stocktakeId as string;
      const doc = await prisma.storeStocktake.findUnique({ where: { id: stocktakeId }, select: { storeId: true } });
      if (!doc) return { ok: false, code: "NOT_FOUND" };
      storeIdForRevalidate = doc.storeId;

      if (!isAdmin) {
        const gate = await requireSpgActiveStore(session.user.id);
        if (!gate.ok) return gate;
        if (gate.storeId !== doc.storeId) return { ok: false, code: "FORBIDDEN" };
        submit = true;
      }
    }

    await saveStocktakeCounts({
      stocktakeId,
      lines: input.lines,
      addedLines: input.addedLines,
      submit,
      userId: session.user.id,
    });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/backoffice/store-stocktakes");
  revalidatePath(`/backoffice/store-stocktakes/${stocktakeId}`);
  revalidatePath(`/backoffice/stores/${storeIdForRevalidate}`);
  return { ok: true, id: stocktakeId };
}

/**
 * Approves a count, writing `StoreStock.qty` to the counted figure. Admin-only — verification is
 * the one step an SPG never performs on their own count.
 */
export async function approveAction(stocktakeId: string): Promise<StoreStocktakeActionResult> {
  let storeIdForRevalidate = "";
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (typeof stocktakeId !== "string" || stocktakeId === "") return { ok: false, code: "INVALID_REQUEST" };
    const doc = await prisma.storeStocktake.findUnique({ where: { id: stocktakeId }, select: { storeId: true } });
    if (!doc) return { ok: false, code: "NOT_FOUND" };
    storeIdForRevalidate = doc.storeId;
    await approveStoreStocktake({ stocktakeId, approvedById: session.user.id });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/backoffice/store-stocktakes");
  revalidatePath(`/backoffice/store-stocktakes/${stocktakeId}`);
  revalidatePath(`/backoffice/stores/${storeIdForRevalidate}`);
  return { ok: true, id: stocktakeId };
}

/** Abandons an open document. Admin-only, and requires a non-blank reason (enforced by the writer). */
export async function cancelAction(input: { stocktakeId: string; reason: string }): Promise<StoreStocktakeActionResult> {
  let stocktakeId = "";
  let storeIdForRevalidate = "";
  try {
    const session = await auth();
    const permissions = session?.user?.permissions ?? [];
    if (!session?.user?.id || !hasPermission(permissions, PERMISSIONS.STORES_MANAGE)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (!isValidCancelInput(input)) return { ok: false, code: "INVALID_REQUEST" };
    stocktakeId = input.stocktakeId;
    const doc = await prisma.storeStocktake.findUnique({ where: { id: stocktakeId }, select: { storeId: true } });
    if (!doc) return { ok: false, code: "NOT_FOUND" };
    storeIdForRevalidate = doc.storeId;
    await cancelStoreStocktake({ stocktakeId, cancelledById: session.user.id, reason: input.reason });
  } catch (e) {
    return toResult(e);
  }
  revalidatePath("/backoffice/store-stocktakes");
  revalidatePath(`/backoffice/store-stocktakes/${stocktakeId}`);
  revalidatePath(`/backoffice/stores/${storeIdForRevalidate}`);
  return { ok: true, id: stocktakeId };
}
