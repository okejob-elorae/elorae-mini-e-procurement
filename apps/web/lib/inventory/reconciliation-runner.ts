import type { Prisma, ReconDirection, ReconTrigger, StockAdjustmentSource } from "@elorae/db";
import { prisma } from "@elorae/db";
import { Decimal } from "decimal.js";
import { generateDocNumber } from "@/lib/docNumber";
import { apiFetch } from "@/lib/internal-api";
import {
  classifyVariance,
  isCronEnabled,
  parseReconDirection,
  parseReconThreshold,
  applyDirection,
} from "./reconciliation";

export type JubelioSnapshotRow = {
  itemId: string;
  variantSku: string;
  jubelioItemId: number;
  jubelioQty: number;
};

/** Kunci varian seperti penangan push stok: dipangkas, huruf kecil; null dan "" sama. */
const kunciVarian = (sku: string | null | undefined) => (sku ?? "").trim().toLowerCase();

type BarisStokRekon = {
  variantSku: string | null;
  qtyOnHand: { toString(): string };
  reservedQty: { toString(): string };
};

/**
 * Angka ERP yang dibandingkan dengan qty Jubelio untuk satu pemetaan: AVAILABLE
 * (onHand − reserved), dijumlah atas baris yang dikirim push stok ke kode itu, lalu
 * di-clamp 0 — persis yang didorong `stock-push.handler.ts` (BOUNDARY §3.1/D6). Dulu
 * onHand mentah: setiap barang bercadangan tampak selisih sebesar `reservedQty`.
 * Pemetaan barang sederhana ("") hanya memungut baris null/"", bukan baris varian.
 */
export function tersediaErpUntukPemetaan(baris: readonly BarisStokRekon[], erpVariantSku: string | null): number {
  const kunci = kunciVarian(erpVariantSku);
  let tersedia = new Decimal(0);
  for (const iv of baris) {
    if (kunciVarian(iv.variantSku) !== kunci) continue;
    tersedia = tersedia.plus(iv.qtyOnHand.toString()).minus(iv.reservedQty.toString());
  }
  return Decimal.max(0, tersedia).toNumber();
}

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
 * MATCH_JUBELIO: samakan AVAILABLE ERP dengan qty Jubelio (yang memang available, karena
 * ERP mendorong available). onHand baru = qty Jubelio + reserved; reserved tidak disentuh.
 * Menulis onHand = qty Jubelio (perilaku lama) menghapus cadangan dari stok fisik.
 *
 * Baris dicari toleran seperti push: varian lewat kunci yang sama, barang sederhana lewat
 * baris null ATAU "" (dulu findUnique "" melewatkan baris null diam-diam). Baris kembar
 * dijumlah; selisihnya ditulis ke baris dengan onHand terbesar.
 */
export async function applyMatchJubelio(
  tx: Prisma.TransactionClient,
  params: {
    runId: string;
    itemId: string;
    variantSku: string;
    itemName: string;
    /** Qty Jubelio (satuan available) yang ingin disamai. */
    tersediaJubelio: number;
    userId?: string;
  },
): Promise<void> {
  const variantKey = params.variantSku;
  const semua = await tx.inventoryValue.findMany({ where: { itemId: params.itemId } });
  const baris = semua.filter((iv) => kunciVarian(iv.variantSku) === kunciVarian(variantKey));
  if (baris.length === 0) return;

  const onHandTotal = baris.reduce((s, iv) => s.plus(iv.qtyOnHand.toString()), new Decimal(0));
  const ditahanTotal = baris.reduce((s, iv) => s.plus(iv.reservedQty.toString()), new Decimal(0));
  // Sudah selaras bila available ERP yang di-clamp 0 (angka yang didorong push) sama dengan
  // Jubelio. Tanpa ini oversell (onHand 1, ditahan 4) vs Jubelio 0 menambah 3 pcs fiktif:
  // angka 0 di Jubelio hanyalah clamp push kita, bukan hitungan fisik.
  if (Decimal.max(0, onHandTotal.minus(ditahanTotal)).equals(params.tersediaJubelio)) return;
  const selisih = new Decimal(params.tersediaJubelio).plus(ditahanTotal).minus(onHandTotal);
  if (selisih.isZero()) return;

  const inv = baris.reduce((a, b) => (new Decimal(b.qtyOnHand.toString()).gt(a.qtyOnHand.toString()) ? b : a));
  const prevQty = new Decimal(inv.qtyOnHand.toString());
  const newQty = prevQty.plus(selisih);

  const prevAvgCost = new Decimal(inv.avgCost.toString());
  const qtyChange = newQty.minus(prevQty).abs();
  const type = newQty.gte(prevQty) ? "POSITIVE" : "NEGATIVE";
  const idempotencyKey = `recon:${params.runId}:${params.itemId}:${variantKey || "base"}`;

  const existing = await tx.stockAdjustment.findUnique({ where: { idempotencyKey } });
  if (existing) return;

  const adjDoc = await generateDocNumber("ADJ", tx);
  await tx.stockAdjustment.create({
    data: {
      docNumber: adjDoc,
      itemId: params.itemId,
      type,
      qtyChange: qtyChange.toNumber(),
      reason: `Jubelio reconciliation run ${params.runId}`,
      prevQty: prevQty.toNumber(),
      newQty: newQty.toNumber(),
      prevAvgCost: prevAvgCost.toNumber(),
      newAvgCost: prevAvgCost.toNumber(),
      source: "JUBELIO_RECONCILE" satisfies StockAdjustmentSource,
      idempotencyKey,
      externalRef: params.runId,
    },
  });

  const newTotalValue = newQty.mul(prevAvgCost);
  await tx.inventoryValue.update({
    where: { id: inv.id },
    data: {
      qtyOnHand: newQty.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date(),
    },
  });

  const adjQty = type === "POSITIVE" ? qtyChange.toNumber() : -qtyChange.toNumber();
  await tx.stockMovement.create({
    data: {
      itemId: params.itemId,
      variantSku: inv.variantSku,
      type: "ADJUSTMENT",
      refType: "RECON",
      refId: params.runId,
      refDocNumber: params.runId,
      qty: adjQty,
      unitCost: prevAvgCost.toNumber(),
      totalCost: adjQty * prevAvgCost.toNumber(),
      balanceQty: newQty.toNumber(),
      balanceValue: newTotalValue.toNumber(),
      notes: "Jubelio reconciliation auto-correct",
    },
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
  /** Batasi ke barang tertentu (tes di basis data bersama; jangan memindai semua pemetaan). */
  opsi?: { itemIds?: readonly string[] },
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
    const mappings = await prisma.jubelioProductMapping.findMany({
      where: opsi?.itemIds ? { itemId: { in: [...opsi.itemIds] } } : undefined,
      include: {
        item: {
          select: {
            id: true,
            nameId: true,
            type: true,
            inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true } },
          },
        },
      },
    });

    const jubelioRows = await fetchJubelioSnapshot();
    const jubelioByKey = new Map(
      jubelioRows.map((r) => [`${r.itemId}:${r.variantSku}`, r]),
    );

    for (const mapping of mappings) {
      if (mapping.item.type !== "FINISHED_GOOD") continue;

      const variantSku = mapping.erpVariantSku ?? "";
      // AVAILABLE, bukan onHand: qty Jubelio adalah angka available yang kita dorong.
      const eloraeQty = tersediaErpUntukPemetaan(mapping.item.inventoryValues, variantSku);
      const snap = jubelioByKey.get(`${mapping.itemId}:${variantSku}`);
      const jubelioQty = snap?.jubelioQty ?? 0;
      const variance = eloraeQty - jubelioQty;
      const classified = classifyVariance(variance, config.threshold, config.direction);

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
            tersediaJubelio: jubelioQty,
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
    const result = await prisma.reconciliationResult.findUnique({
      where: { id: data.resultId },
      include: { run: true },
    });
    if (!result) throw new Error("Result not found");
    if (result.action !== "FLAGGED") throw new Error("Item sudah diselesaikan");

    const { newEloraeQty, needsPush } = applyDirection(
      data.direction,
      Number(result.eloraeQty),
      Number(result.jubelioQty),
    );

    if (data.direction === "MATCH_JUBELIO") {
      await prisma.$transaction(async (tx) => {
        await applyMatchJubelio(tx, {
          runId: result.runId,
          itemId: result.itemId,
          variantSku: result.variantSku ?? "",
          itemName: result.itemName,
          // Hasil lama pun benar di sini: targetnya qty Jubelio sebagai available.
          tersediaJubelio: newEloraeQty,
          userId: data.userId,
        });
      });
    } else if (needsPush) {
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
