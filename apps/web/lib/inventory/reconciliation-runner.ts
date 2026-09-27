import type { Prisma, ReconDirection, ReconTrigger, StockAdjustmentSource, StockLedgerRefType } from "@elorae/db";
import {
  eloraeOnHandFromJubelio,
  isJubelioStockPushEnabled,
  isValidJubelioQty,
  jubelioEndQtyFor,
  offlineReservedByKey,
  offlineReservedQty,
  prisma,
  setMainStock,
} from "@elorae/db";
import { Decimal } from "decimal.js";
import { generateDocNumber } from "@/lib/docNumber";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";
import { apiFetch } from "@/lib/internal-api";
import {
  classifyVariance,
  isCronEnabled,
  parseReconDirection,
  parseReconThreshold,
} from "./reconciliation";

export type JubelioSnapshotRow = {
  itemId: string;
  variantSku: string;
  jubelioItemId: number;
  jubelioQty: number;
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

async function fetchJubelioSnapshot(itemGroupIds?: number[]): Promise<JubelioSnapshotRow[]> {
  const query = itemGroupIds?.length ? `?jubelioItemGroupIds=${itemGroupIds.join(",")}` : "";
  const res = await apiFetch<{ rows: JubelioSnapshotRow[] }>(
    "GET",
    `/jubelio/inventory/snapshot${query}`,
    { userId: "" },
  );
  if (!res.ok || !res.data?.rows) {
    throw new Error(res.error ?? "Failed to fetch Jubelio inventory snapshot");
  }
  return res.data.rows;
}

/**
 * Applies a MATCH_JUBELIO correction under the verified contract: the absolute target is
 * Jubelio's `end_qty` plus Elorae's own offline (field-sales) holds, which Jubelio cannot see
 * (see jubelio-stock-contract.ts). `jubelioQty` is the raw Jubelio figure — the offline add-back
 * and the row lock both happen in here, inside the caller's own transaction, so a concurrent
 * push/webhook write cannot land between the read and the write.
 */
async function applyMatchJubelio(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    itemId: string;
    variantSku: string;
    itemName: string;
    jubelioQty: number;
    userId?: string;
  },
): Promise<void> {
  if (!isValidJubelioQty(params.jubelioQty)) {
    throw new Error(`Invalid Jubelio quantity for ${params.itemName}: ${params.jubelioQty}`);
  }

  const variantKey = params.variantSku;
  const inv = await findExistingInventoryValueRow(tx, params.itemId, variantKey);
  if (!inv) return;

  /*
   * Lock the row before reading it — a plain read here could race a concurrent push/webhook
   * write landing between this read and the setMainStock write below. Only inv.id is
   * interpolated (parameterised by Prisma); the column/table names are static SQL text.
   */
  const lockedRows = await tx.$queryRaw<{ qtyOnHand: unknown; avgCost: unknown }[]>`
    SELECT \`qtyOnHand\`, \`avgCost\` FROM \`InventoryValue\` WHERE id = ${inv.id} FOR UPDATE
  `;
  const locked = lockedRows[0];
  if (!locked) return;

  const offline = await offlineReservedQty(tx, params.itemId, variantKey);
  const prevQty = new Decimal(String(locked.qtyOnHand));
  // eloraeOnHandFromJubelio's own addition happens in plain numbers (the contract's pure
  // shape); everything from here on is Decimal, so the adjustment/ledger math doesn't drift.
  const targetQty = new Decimal(eloraeOnHandFromJubelio(params.jubelioQty, offline).toString());
  if (prevQty.equals(targetQty)) return;

  const prevAvgCost = new Decimal(String(locked.avgCost));
  const qtyChange = targetQty.minus(prevQty).abs();
  const type = targetQty.gte(prevQty) ? "POSITIVE" : "NEGATIVE";
  const idempotencyKey = `recon:${params.runId}:${params.itemId}:${variantKey || "base"}`;

  const existing = await tx.stockAdjustment.findUnique({ where: { idempotencyKey } });
  if (existing) return;

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
    inventoryValueId: inv.id,
    refType: "Reconciliation" satisfies StockLedgerRefType,
    refId: adjustment.id,
    refDocNumber: adjDoc,
    createdById: params.userId ?? null,
  });
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
    // Owner-approved cutover switch: while it's off, REASSERT_ELORAE never enqueues a push —
    // see jubelio-stock-contract.ts. The row-level guard below matches classifyVariance's own
    // shape so the counters and the persisted action stay consistent with what actually ran.
    const pushEnabled = await isJubelioStockPushEnabled(prisma);

    const mappings = await prisma.jubelioProductMapping.findMany({
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
    const offlineByKey = await offlineReservedByKey(
      prisma,
      fgMappings.map((m) => ({ itemId: m.itemId, variantSku: m.erpVariantSku ?? "" })),
    );

    const jubelioRows = await fetchJubelioSnapshot();
    const jubelioByKey = new Map(
      jubelioRows.map((r) => [`${r.itemId}:${r.variantSku}`, r]),
    );

    for (const mapping of fgMappings) {
      const variantSku = mapping.erpVariantSku ?? "";
      // OR-tolerant match on the variantless spelling only. Dropped the old fallback to an
      // unrelated variant row on the same item — a mapping whose variant genuinely has no
      // InventoryValue row now compares against 0 instead of a sibling variant's quantity.
      const invRow = mapping.item.inventoryValues.find((iv) =>
        variantSku === "" ? (iv.variantSku ?? "") === "" : iv.variantSku === variantSku,
      );
      const rawQtyOnHand = invRow ? Number(invRow.qtyOnHand) : 0;
      const offline = offlineByKey.get(`${mapping.itemId}:${variantSku}`) ?? 0;
      const eloraeQty = jubelioEndQtyFor(rawQtyOnHand, offline);
      const snap = jubelioByKey.get(`${mapping.itemId}:${variantSku}`);
      const jubelioQty = snap?.jubelioQty ?? 0;
      const variance = eloraeQty - jubelioQty;
      let classified = classifyVariance(variance, config.threshold, config.direction);
      if (classified.needsPush && config.direction === "REASSERT_ELORAE" && !pushEnabled) {
        classified = { action: "FLAGGED", needsStockWrite: false, needsPush: false };
      }

      totalScanned += 1;
      if (classified.action === "IN_SYNC") inSync += 1;
      else if (classified.action === "AUTO_CORRECTED") autoCorrected += 1;
      else if (classified.action === "FLAGGED") flagged += 1;

      if (classified.needsStockWrite && config.direction === "MATCH_JUBELIO") {
        await prisma.$transaction(async (tx) => {
          await applyMatchJubelio(tx, {
            runId: run.id,
            itemId: mapping.itemId,
            variantSku,
            itemName: mapping.item.nameId,
            jubelioQty,
            userId: startedById,
          });
        });
      } else if (classified.needsPush && config.direction === "REASSERT_ELORAE") {
        await enqueueReconStockPush(mapping.itemId, startedById ?? "");
      }

      await prisma.reconciliationResult.create({
        data: {
          runId: run.id,
          itemId: mapping.itemId,
          variantSku: variantSku || null,
          itemName: mapping.item.nameId,
          jubelioItemId: mapping.jubelioItemId,
          eloraeQty,
          jubelioQty,
          variance,
          action: classified.action,
        },
      });
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

export async function resolveReconciliationItem(data: {
  resultId: string;
  direction: ReconDirection;
  userId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate the direction before any side effect — this is a "use server" export, reachable
    // independently of whatever the UI currently offers.
    if (data.direction !== "MATCH_JUBELIO" && data.direction !== "REASSERT_ELORAE") {
      throw new Error(`Unknown reconciliation direction: ${data.direction}`);
    }

    // Owner-approved cutover switch: refused before any read of the result row, let alone a
    // write — see jubelio-stock-contract.ts.
    if (data.direction === "REASSERT_ELORAE" && !(await isJubelioStockPushEnabled(prisma))) {
      throw new Error(
        "Pushing stock to Jubelio is disabled until cutover — Jubelio is the source of truth.",
      );
    }

    const result = await prisma.reconciliationResult.findUnique({
      where: { id: data.resultId },
      include: { run: true },
    });
    if (!result) throw new Error("Result not found");
    if (result.action !== "FLAGGED") throw new Error("Item sudah diselesaikan");

    const variantSku = result.variantSku ?? "";

    if (data.direction === "MATCH_JUBELIO") {
      const mapping = await prisma.jubelioProductMapping.findFirst({
        where: { itemId: result.itemId, erpVariantSku: variantSku },
        select: { jubelioItemGroupId: true },
      });
      if (!mapping) throw new Error("Jubelio mapping not found for this item");

      // Re-fetch a live figure scoped to just this item-group rather than trusting the run's
      // stored snapshot, which may already be stale by the time an operator resolves it.
      const liveRows = await fetchJubelioSnapshot([mapping.jubelioItemGroupId]);
      const live = liveRows.find(
        (r) => r.itemId === result.itemId && r.variantSku === variantSku,
      );
      const liveJubelioQty = live?.jubelioQty ?? 0;

      await prisma.$transaction(async (tx) => {
        const inv = await findExistingInventoryValueRow(tx, result.itemId, variantSku);
        const rawQtyOnHand = inv ? Number(inv.qtyOnHand) : 0;
        const offline = await offlineReservedQty(tx, result.itemId, variantSku);
        const liveEloraeQty = jubelioEndQtyFor(rawQtyOnHand, offline);

        if (liveEloraeQty !== Number(result.eloraeQty)) {
          throw new Error("stock moved since this run; re-run reconciliation");
        }

        await applyMatchJubelio(tx, {
          runId: result.runId,
          itemId: result.itemId,
          variantSku,
          itemName: result.itemName,
          jubelioQty: liveJubelioQty,
          userId: data.userId,
        });
      });
    } else {
      // REASSERT_ELORAE: no local stock write, just push Elorae's own current figure back.
      await enqueueReconStockPush(result.itemId, data.userId);
    }

    await prisma.reconciliationResult.update({
      where: { id: data.resultId },
      data: {
        action: "MANUALLY_RESOLVED",
        resolvedAt: new Date(),
        resolvedById: data.userId,
        resolutionDirection: data.direction,
      },
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to resolve" };
  }
}

export async function updateReconciliationSettings(
  threshold: number,
  direction: string,
  cronEnabled: boolean,
): Promise<void> {
  // Owner-approved cutover switch: REASSERT_ELORAE can't even be saved as the configured
  // direction while pushing is disabled — see jubelio-stock-contract.ts.
  if (direction === "REASSERT_ELORAE" && !(await isJubelioStockPushEnabled(prisma))) {
    throw new Error(
      "Pushing stock to Jubelio is disabled until cutover — Jubelio is the source of truth.",
    );
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
}
