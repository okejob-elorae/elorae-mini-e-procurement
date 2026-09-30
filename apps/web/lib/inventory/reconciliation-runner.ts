import type { Prisma, ReconAction, ReconDirection, ReconTrigger, StockAdjustmentSource, StockLedgerRefType } from "@elorae/db";
import {
  effectiveOfflineReservedByKey,
  effectiveOfflineReservedQty,
  eloraeOnHandFromJubelio,
  isJubelioStockPushEnabled,
  isValidJubelioQty,
  lockMainInventoryValueRow,
  prisma,
  setMainStock,
} from "@elorae/db";
import { Decimal } from "decimal.js";
import { generateDocNumber } from "@/lib/docNumber";
import { apiFetch } from "@/lib/internal-api";
import {
  classifyReconRow,
  comparableEloraeQty,
  isCronEnabled,
  parseReconDirection,
  parseReconThreshold,
  sameQty2dp,
  type ReconBulkResolveReason,
  type ReconResolveReason,
  type ReconSettingsReason,
} from "./reconciliation";
import { RECON_BULK_BATCH_MAX } from "./reconciliation-selection";

export { RECON_BULK_BATCH_MAX };

/** `jubelioQty` is `null` when Jubelio gave no usable figure — never read it as 0. */
export type JubelioSnapshotRow = {
  itemId: string;
  variantSku: string;
  jubelioItemId: number;
  jubelioQty: number | null;
};

/** One variant of one item group, read live by the api from `GET /inventory/items/group/{id}`. */
export type JubelioGroupSnapshotRow = {
  jubelioItemId: number;
  endQty: number | null;
};

export type ReconConfig = {
  threshold: number;
  direction: ReturnType<typeof parseReconDirection>;
  cronEnabled: boolean;
};

const RECON_SETTINGS_KEYS = [
  "RECON_AUTO_CORRECT_THRESHOLD",
  "RECON_AUTO_CORRECT_DIRECTION",
  "RECON_CRON_ENABLED",
] as const;

export async function loadReconciliationConfig(): Promise<ReconConfig> {
  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: [...RECON_SETTINGS_KEYS] } },
  });
  const map = new Map(settings.map((s) => [s.key, s.value]));
  return {
    threshold: parseReconThreshold(map.get("RECON_AUTO_CORRECT_THRESHOLD")),
    direction: parseReconDirection(map.get("RECON_AUTO_CORRECT_DIRECTION")),
    cronEnabled: isCronEnabled(map.get("RECON_CRON_ENABLED")),
  };
}

export async function hasRunningReconciliation(): Promise<boolean> {
  const running = await prisma.reconciliationRun.findFirst({
    where: { status: "RUNNING" },
    select: { id: true },
  });
  return running != null;
}

async function fetchJubelioSnapshot(): Promise<JubelioSnapshotRow[]> {
  const res = await apiFetch<{ rows: JubelioSnapshotRow[] }>(
    "GET",
    "/jubelio/inventory/snapshot",
    { userId: "" },
  );
  if (!res.ok || !res.data?.rows) {
    throw new Error(res.error ?? "Failed to fetch Jubelio inventory snapshot");
  }
  return res.data.rows;
}

/**
 * The live figures for ONE item group. The group id goes in the PATH: a query string would fail
 * the signed channel's check (see apiFetch). Returns `null` when the api call itself fails.
 */
async function fetchJubelioGroupSnapshot(groupId: number): Promise<JubelioGroupSnapshotRow[] | null> {
  const res = await apiFetch<{ rows: JubelioGroupSnapshotRow[] }>(
    "GET",
    `/jubelio/inventory/snapshot/group/${groupId}`,
    { userId: "" },
  );
  if (!res.ok || !res.data?.rows) return null;
  return res.data.rows;
}

/** `DECIMAL(10,2)` holds at most eight integer digits. */
const DECIMAL_10_2_MAX = 99999999.99;

const ERROR_MESSAGE_MAX = 2000;

/* The message unchanged when it fits, else its first `ERROR_MESSAGE_MAX - 1` code points plus an ellipsis. */
function capErrorMessage(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= ERROR_MESSAGE_MAX) return text;
  return `${chars.slice(0, ERROR_MESSAGE_MAX - 1).join("")}…`;
}

type MatchJubelioOutcome = "APPLIED" | "NOOP" | "NO_INVENTORY_ROW" | "STOCK_MOVED";

/**
 * Applies a MATCH_JUBELIO correction under the verified contract: the absolute target is
 * Jubelio's `end_qty` plus the field-sales holds Jubelio has had netted out of it
 * (`effectiveOfflineReservedQty`: the holds while stock pushes are enabled, 0 while they are off —
 * see jubelio-stock-contract.ts). `jubelioQty` is the raw Jubelio figure.
 *
 * Runs inside the caller's transaction, and the row lock is its FIRST statement, so prevQty, the
 * holds and the optional moved-since check (`expectedEloraeQty`, the figure the run stored) all see
 * a row no concurrent push or webhook can move until this commits. Every refusal returns before
 * any write.
 */
async function applyMatchJubelio(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    itemId: string;
    variantSku: string;
    itemName: string;
    jubelioQty: number;
    expectedEloraeQty?: number;
    userId?: string;
  },
): Promise<MatchJubelioOutcome> {
  if (!isValidJubelioQty(params.jubelioQty)) {
    throw new Error(`Invalid Jubelio quantity for ${params.itemName}: ${params.jubelioQty}`);
  }

  const variantKey = params.variantSku;
  const locked = await lockMainInventoryValueRow(tx, params.itemId, variantKey);
  if (!locked) return "NO_INVENTORY_ROW";

  const pushEnabled = await isJubelioStockPushEnabled(tx);
  const offline = await effectiveOfflineReservedQty(tx, params.itemId, variantKey);
  const prevQty = new Decimal(locked.qtyOnHand);

  if (params.expectedEloraeQty !== undefined) {
    const liveEloraeQty = comparableEloraeQty(prevQty.toNumber(), offline, pushEnabled);
    if (!sameQty2dp(liveEloraeQty, params.expectedEloraeQty)) return "STOCK_MOVED";
  }

  // eloraeOnHandFromJubelio's own addition happens in plain numbers (the contract's pure
  // shape); everything from here on is Decimal, so the adjustment/ledger math doesn't drift.
  const targetQty = new Decimal(eloraeOnHandFromJubelio(params.jubelioQty, offline).toString())
    .toDecimalPlaces(2);
  if (prevQty.equals(targetQty)) return "NOOP";

  const prevAvgCost = new Decimal(locked.avgCost);
  const qtyChange = targetQty.minus(prevQty).abs();
  const type = targetQty.gte(prevQty) ? "POSITIVE" : "NEGATIVE";
  const idempotencyKey = `recon:${params.runId}:${params.itemId}:${variantKey || "base"}`;

  const existing = await tx.stockAdjustment.findUnique({ where: { idempotencyKey } });
  if (existing) return "NOOP";

  const adjDoc = await generateDocNumber("ADJ", tx);
  const adjustment = await tx.stockAdjustment.create({
    data: {
      docNumber: adjDoc,
      itemId: params.itemId,
      type,
      qtyChange: qtyChange.toNumber(),
      reason: `Jubelio reconciliation run ${params.runId}`,
      prevQty: prevQty.toNumber(),
      newQty: targetQty.toNumber(),
      prevAvgCost: prevAvgCost.toNumber(),
      newAvgCost: prevAvgCost.toNumber(),
      source: "JUBELIO_RECONCILE" satisfies StockAdjustmentSource,
      idempotencyKey,
      externalRef: params.runId,
    },
  });

  const signedQtyChange = type === "POSITIVE" ? qtyChange : qtyChange.neg();
  const newTotalValue = targetQty.mul(prevAvgCost);
  await setMainStock(tx, {
    itemId: params.itemId,
    variantSku: variantKey,
    nextQty: targetQty.toNumber(),
    totalValue: newTotalValue.toNumber(),
    unitCost: prevAvgCost.toNumber(),
    totalCost: signedQtyChange.mul(prevAvgCost).toNumber(),
    balanceValue: newTotalValue.toNumber(),
    inventoryValueId: locked.id,
    refType: "Reconciliation" satisfies StockLedgerRefType,
    refId: adjustment.id,
    refDocNumber: adjDoc,
    createdById: params.userId ?? null,
  });
  return "APPLIED";
}

async function enqueueReconStockPush(itemId: string, userId: string): Promise<void> {
  const row = await prisma.jubelioOutbox.create({
    data: {
      entityType: "stock_push",
      entityId: itemId,
      payload: {},
      enqueuedById: userId || null,
    },
    select: { id: true },
  });
  void apiFetch("POST", `/jubelio/outbox/enqueue/${row.id}`, { userId }).catch(() => {});
}

export async function runReconciliation(
  trigger: ReconTrigger,
  startedById?: string,
  /**
   * Scopes the mapping scan to these item ids — a spec's own seeded rows, never a length check:
   * `undefined` (the default, every production caller) scans every mapping, `[]` scans none. This
   * is the only thing scoped; the Jubelio snapshot fetch and the classification loop are unchanged.
   */
  opts: { itemIds?: string[] } = {},
): Promise<{
  runId: string;
  skipped?: boolean;
  reason?: string;
  inSync: number;
  autoCorrected: number;
  flagged: number;
}> {
  if (trigger === "CRON") {
    const config = await loadReconciliationConfig();
    if (!config.cronEnabled) {
      return {
        runId: "",
        skipped: true,
        reason: "cron_disabled",
        inSync: 0,
        autoCorrected: 0,
        flagged: 0,
      };
    }
  }

  if (await hasRunningReconciliation()) {
    return {
      runId: "",
      skipped: true,
      reason: "already_running",
      inSync: 0,
      autoCorrected: 0,
      flagged: 0,
    };
  }

  const config = await loadReconciliationConfig();
  const run = await prisma.reconciliationRun.create({
    data: {
      triggeredBy: trigger,
      status: "RUNNING",
      startedById: startedById ?? null,
    },
  });

  let inSync = 0;
  let autoCorrected = 0;
  let flagged = 0;
  let totalScanned = 0;

  try {
    /*
     * Owner-approved cutover switch (see jubelio-stock-contract.ts). While it is off,
     * classifyReconRow degrades REASSERT_ELORAE to FLAGGED so nothing is enqueued, and
     * comparableEloraeQty below neither subtracts the holds nor floors at 0 — no push has
     * netted the holds out of end_qty, and nothing mirrors a floor that only means something
     * on the push path, so a negative on-hand compares raw and gets flagged.
     */
    const pushEnabled = await isJubelioStockPushEnabled(prisma);

    const mappings = await prisma.jubelioProductMapping.findMany({
      where: opts.itemIds !== undefined ? { itemId: { in: opts.itemIds } } : undefined,
      include: {
        item: {
          select: {
            id: true,
            nameId: true,
            type: true,
            inventoryValues: {
              select: { variantSku: true, qtyOnHand: true },
              orderBy: { id: "asc" },
            },
          },
        },
      },
    });

    const fgMappings = mappings.filter((m) => m.item.type === "FINISHED_GOOD");
    const offlineByKey = await effectiveOfflineReservedByKey(
      prisma,
      fgMappings.map((m) => ({ itemId: m.itemId, variantSku: m.erpVariantSku ?? "" })),
    );

    const jubelioRows = await fetchJubelioSnapshot();
    const jubelioByKey = new Map(
      jubelioRows.map((r) => [`${r.itemId}:${r.variantSku}`, r]),
    );

    let failedCount = 0;

    for (const mapping of fgMappings) {
      const variantSku = mapping.erpVariantSku ?? "";
      let eloraeQty = 0;
      let storedJubelioQty: number | null = null;
      let variance: number | null = null;
      let pushEnqueued = false;
      let pushAction: ReconAction = "FLAGGED";
      try {
        // OR-tolerant match on the variantless spelling only. Dropped the old fallback to an
        // unrelated variant row on the same item — a mapping whose variant genuinely has no
        // InventoryValue row now compares against 0 instead of a sibling variant's quantity.
        const invRow = mapping.item.inventoryValues.find((iv) =>
          variantSku === "" ? (iv.variantSku ?? "") === "" : iv.variantSku === variantSku,
        );
        const rawQtyOnHand = invRow ? Number(invRow.qtyOnHand) : 0;
        const offline = offlineByKey.get(`${mapping.itemId}:${variantSku}`) ?? 0;
        eloraeQty = comparableEloraeQty(rawQtyOnHand, offline, pushEnabled);
        /* A variant the snapshot had no usable figure for is null, never 0 — see classifyReconRow. */
        const jubelioQty = jubelioByKey.get(`${mapping.itemId}:${variantSku}`)?.jubelioQty ?? null;
        const { classified, ...figures } = classifyReconRow({
          eloraeQty,
          jubelioQty,
          threshold: config.threshold,
          direction: config.direction,
          pushEnabled,
        });
        storedJubelioQty = figures.storedJubelioQty;
        variance = figures.variance;

        const resultData = {
          runId: run.id,
          itemId: mapping.itemId,
          variantSku: variantSku || null,
          itemName: mapping.item.nameId,
          jubelioItemId: mapping.jubelioItemId,
          eloraeQty,
          jubelioQty: storedJubelioQty,
          variance,
        };
        let storedAction: ReconAction = classified.action;

        if (classified.needsStockWrite && config.direction === "MATCH_JUBELIO" && jubelioQty !== null) {
          /*
           * The result row is written inside the correction transaction, so a throw rolls back
           * both and the catch's FLAGGED row is always true. A refused correction (no inventory
           * row) wrote nothing, so it is stored FLAGGED, not AUTO_CORRECTED.
           */
          storedAction = await prisma.$transaction(async (tx) => {
            const outcome = await applyMatchJubelio(tx, {
              runId: run.id,
              itemId: mapping.itemId,
              variantSku,
              itemName: mapping.item.nameId,
              jubelioQty,
              userId: startedById,
            });
            const action: ReconAction =
              outcome === "APPLIED" || outcome === "NOOP" ? classified.action : "FLAGGED";
            await tx.reconciliationResult.create({ data: { ...resultData, action } });
            return action;
          });
        } else {
          if (classified.needsPush && config.direction === "REASSERT_ELORAE") {
            await enqueueReconStockPush(mapping.itemId, startedById ?? "");
            /* The push is out and cannot be recalled: a later throw must not store this row FLAGGED. */
            pushEnqueued = true;
            pushAction = classified.action;
          }
          await prisma.reconciliationResult.create({ data: { ...resultData, action: classified.action } });
        }

        /* Counted only once the row is stored, so the counters equal the stored actions. */
        totalScanned += 1;
        if (storedAction === "IN_SYNC") inSync += 1;
        else if (storedAction === "AUTO_CORRECTED") autoCorrected += 1;
        else if (storedAction === "FLAGGED") flagged += 1;
      } catch (err) {
        console.error(`[reconciliation] item ${mapping.itemId} variant "${variantSku}" failed`, err);
        const fallbackAction: ReconAction = pushEnqueued ? pushAction : "FLAGGED";
        const notes = [err instanceof Error ? err.message : String(err)];
        const fits = (n: number | null): boolean => n !== null && Number.isFinite(n) && Math.abs(n) <= DECIMAL_10_2_MAX;
        let fallbackEloraeQty = eloraeQty;
        let fallbackJubelioQty = storedJubelioQty;
        let fallbackVariance = variance;
        if (!fits(eloraeQty)) {
          fallbackEloraeQty = 0;
          notes.push(`elorae figure ${eloraeQty} does not fit the column and is stored as 0`);
        }
        if (storedJubelioQty !== null && !fits(storedJubelioQty)) {
          fallbackJubelioQty = null;
          notes.push(`jubelio figure ${storedJubelioQty} does not fit the column`);
        }
        if (variance !== null && !fits(variance)) {
          fallbackVariance = null;
          notes.push(`variance ${variance} does not fit the column`);
        }
        /* A throw from the fallback means the database itself is failing; the run-level catch marks the run FAILED. */
        await prisma.reconciliationResult.create({
          data: {
            runId: run.id,
            itemId: mapping.itemId,
            variantSku: variantSku || null,
            itemName: mapping.item.nameId,
            jubelioItemId: mapping.jubelioItemId,
            eloraeQty: fallbackEloraeQty,
            jubelioQty: fallbackJubelioQty,
            variance: fallbackVariance,
            action: fallbackAction,
            errorMessage: capErrorMessage(notes.join("; ")),
          },
        });
        totalScanned += 1;
        if (fallbackAction === "AUTO_CORRECTED") autoCorrected += 1;
        else flagged += 1;
        failedCount += 1;
      }
    }

    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        totalScanned,
        inSync,
        autoCorrected,
        flagged,
        errorMessage:
          failedCount > 0
            ? `${failedCount} of ${totalScanned} items failed to reconcile; see the flagged rows`
            : null,
      },
    });

    return { runId: run.id, inSync, autoCorrected, flagged };
  } catch (err) {
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
        totalScanned,
        inSync,
        autoCorrected,
        flagged,
      },
    });
    throw err;
  }
}

export type ResolveReconciliationResult =
  | { success: true }
  | { success: false; reason: ReconResolveReason };

/**
 * Live item-group figures fetched during one resolve call, keyed by group id, so a bulk batch reads
 * each group from Jubelio once however many of its rows the batch holds. Scoped to a single call,
 * never shared across calls: the figure must be read just before the writes that depend on it.
 */
type GroupSnapshotCache = Map<number, Promise<JubelioGroupSnapshotRow[] | null>>;

function liveGroupSnapshot(cache: GroupSnapshotCache, groupId: number): Promise<JubelioGroupSnapshotRow[] | null> {
  let pending = cache.get(groupId);
  if (!pending) {
    pending = fetchJubelioGroupSnapshot(groupId);
    cache.set(groupId, pending);
  }
  return pending;
}

/** Thrown inside the MATCH_JUBELIO transaction to roll its stock write back: the row stopped being FLAGGED. */
class ResultNoLongerFlaggedError extends Error {}

/**
 * Resolves one FLAGGED result in an already-validated direction. The single-row and bulk exports
 * both go through this, so the FLAGGED check, the live re-fetch and the moved-since guard exist
 * once. Throws are left to the caller, which turns them into `UNEXPECTED`.
 */
async function resolveOneResult(
  resultId: string,
  direction: ReconDirection,
  userId: string,
  groups: GroupSnapshotCache,
): Promise<ResolveReconciliationResult> {
  const result = await prisma.reconciliationResult.findUnique({
    where: { id: resultId },
    include: { run: true },
  });
  if (!result) return { success: false, reason: "NOT_FOUND" };
  if (result.action !== "FLAGGED") return { success: false, reason: "ALREADY_RESOLVED" };

  const variantSku = result.variantSku ?? "";

  if (direction === "MATCH_JUBELIO") {
    const mapping = await prisma.jubelioProductMapping.findFirst({
      where: { itemId: result.itemId, erpVariantSku: variantSku },
      select: { jubelioItemGroupId: true, jubelioItemId: true },
    });
    if (!mapping) return { success: false, reason: "NO_MAPPING" };

    /*
     * Re-fetch a live figure for just this item group rather than trusting the run's stored
     * snapshot, which may already be stale — and which holds no figure for a variant the
     * snapshot lacked. No live figure means nothing is written.
     */
    const liveRows = await liveGroupSnapshot(groups, mapping.jubelioItemGroupId);
    if (!liveRows) return { success: false, reason: "JUBELIO_FETCH_FAILED" };
    const live = liveRows.find((r) => r.jubelioItemId === mapping.jubelioItemId);
    if (!live || live.endQty === null) return { success: false, reason: "JUBELIO_QTY_MISSING" };
    if (!isValidJubelioQty(live.endQty)) return { success: false, reason: "JUBELIO_QTY_INVALID" };
    const liveJubelioQty = live.endQty;

    /*
     * The result is marked resolved in the SAME transaction as the stock write, conditional on it
     * still being FLAGGED: a failure on the mark rolls the write back rather than leaving stock
     * moved under a row that still says FLAGGED, and a concurrent resolve that got there first
     * rolls this one back as ALREADY_RESOLVED.
     */
    let outcome: MatchJubelioOutcome;
    try {
      outcome = await prisma.$transaction(async (tx) => {
        const applied = await applyMatchJubelio(tx, {
          runId: result.runId,
          itemId: result.itemId,
          variantSku,
          itemName: result.itemName,
          jubelioQty: liveJubelioQty,
          expectedEloraeQty: Number(result.eloraeQty),
          userId,
        });
        if (applied === "STOCK_MOVED" || applied === "NO_INVENTORY_ROW") return applied;
        const marked = await tx.reconciliationResult.updateMany({
          where: { id: resultId, action: "FLAGGED" },
          data: {
            action: "MANUALLY_RESOLVED",
            resolvedAt: new Date(),
            resolvedById: userId,
            resolutionDirection: direction,
          },
        });
        if (marked.count === 0) throw new ResultNoLongerFlaggedError();
        return applied;
      });
    } catch (err) {
      if (err instanceof ResultNoLongerFlaggedError) return { success: false, reason: "ALREADY_RESOLVED" };
      throw err;
    }
    if (outcome === "STOCK_MOVED") return { success: false, reason: "STOCK_MOVED" };
    if (outcome === "NO_INVENTORY_ROW") return { success: false, reason: "NO_INVENTORY_ROW" };
    return { success: true };
  }

  /* REASSERT_ELORAE: no local stock write, just push Elorae's own current figure back. */
  await enqueueReconStockPush(result.itemId, userId);
  await prisma.reconciliationResult.update({
    where: { id: resultId },
    data: {
      action: "MANUALLY_RESOLVED",
      resolvedAt: new Date(),
      resolvedById: userId,
      resolutionDirection: direction,
    },
  });

  return { success: true };
}

export async function resolveReconciliationItem(data: {
  resultId: string;
  direction: ReconDirection;
  userId: string;
}): Promise<ResolveReconciliationResult> {
  try {
    // Validate the direction before any side effect — this is a "use server" export, reachable
    // independently of whatever the UI currently offers.
    if (data.direction !== "MATCH_JUBELIO" && data.direction !== "REASSERT_ELORAE") {
      return { success: false, reason: "INVALID_DIRECTION" };
    }

    // Owner-approved cutover switch: refused before any read of the result row, let alone a
    // write — see jubelio-stock-contract.ts.
    if (data.direction === "REASSERT_ELORAE" && !(await isJubelioStockPushEnabled(prisma))) {
      return { success: false, reason: "PUSH_DISABLED" };
    }

    return await resolveOneResult(data.resultId, data.direction, data.userId, new Map());
  } catch (err) {
    console.error("resolveReconciliationItem failed:", err);
    return { success: false, reason: "UNEXPECTED" };
  }
}

export type ResolveReconciliationBatchRow =
  | { resultId: string; success: true }
  | { resultId: string; success: false; reason: ReconResolveReason };

export type ResolveReconciliationItemsResult =
  | { success: true; rows: ResolveReconciliationBatchRow[] }
  | { success: false; reason: ReconBulkResolveReason };

/**
 * MATCH_JUBELIO for up to `RECON_BULK_BATCH_MAX` results, one after another, each in its own
 * transaction with its own outcome: a refusal or a throw on one row never stops the rest, and a
 * repeated id is resolved once. REASSERT_ELORAE has no bulk form. The batch shape is validated
 * before any read, since this is reachable from a "use server" export whatever the UI sends.
 */
export async function resolveReconciliationItems(data: {
  resultIds: string[];
  userId: string;
}): Promise<ResolveReconciliationItemsResult> {
  const ids: unknown = data.resultIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id !== "")) {
    return { success: false, reason: "INVALID_BATCH" };
  }
  const uniqueIds = [...new Set(ids as string[])];
  if (uniqueIds.length > RECON_BULK_BATCH_MAX) return { success: false, reason: "BATCH_TOO_LARGE" };

  const groups: GroupSnapshotCache = new Map();
  const rows: ResolveReconciliationBatchRow[] = [];
  for (const resultId of uniqueIds) {
    try {
      const outcome = await resolveOneResult(resultId, "MATCH_JUBELIO", data.userId, groups);
      rows.push(outcome.success ? { resultId, success: true } : { resultId, success: false, reason: outcome.reason });
    } catch (err) {
      console.error(`resolveReconciliationItems failed for result ${resultId}:`, err);
      rows.push({ resultId, success: false, reason: "UNEXPECTED" });
    }
  }
  return { success: true, rows };
}

export type UpdateReconciliationSettingsResult =
  | { success: true }
  | { success: false; reason: ReconSettingsReason };

/**
 * Returns its refusal rather than throwing it: a thrown server-action error is redacted in
 * production, so the operator would only ever see a generic failure.
 */
export async function updateReconciliationSettings(
  threshold: number,
  direction: string,
  cronEnabled: boolean,
): Promise<UpdateReconciliationSettingsResult> {
  if (direction !== "FLAG_ONLY" && direction !== "MATCH_JUBELIO" && direction !== "REASSERT_ELORAE") {
    return { success: false, reason: "INVALID_DIRECTION" };
  }

  /*
   * Owner-approved cutover switch: REASSERT_ELORAE can't be saved as the direction while pushing
   * is disabled — see jubelio-stock-contract.ts. Only that value is refused: a stale REASSERT that
   * was saved before the switch went off never blocks saving any other direction.
   */
  if (direction === "REASSERT_ELORAE" && !(await isJubelioStockPushEnabled(prisma))) {
    return { success: false, reason: "PUSH_DISABLED" };
  }

  const entries = [
    { key: "RECON_AUTO_CORRECT_THRESHOLD", value: String(threshold) },
    { key: "RECON_AUTO_CORRECT_DIRECTION", value: direction },
    { key: "RECON_CRON_ENABLED", value: cronEnabled ? "true" : "false" },
  ];
  for (const e of entries) {
    await prisma.systemSetting.upsert({
      where: { key: e.key },
      update: { value: e.value },
      create: { key: e.key, value: e.value },
    });
  }
  return { success: true };
}
