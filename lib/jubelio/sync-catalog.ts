import path from 'path';
import { ItemType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getValidJubelioToken, readJubelioTokenFromDb } from './auth';
import { fetchJubelioItems } from './client';
import { buildCatalogDrafts, loadSnapshotPayload, sellingPriceToDecimal } from './map-catalog';
import type {
  CatalogItemDraft,
  CatalogSyncError,
  CatalogSyncItemResult,
  CatalogSyncResult,
  CatalogSyncSummary,
  JubelioItemsPayload,
  VariantJson,
} from './types';

const DEFAULT_SNAPSHOT = path.join(
  process.cwd(),
  'agent-instruction',
  'jubelio',
  'items.json'
);

export type SyncCatalogOptions = {
  dryRun?: boolean;
  source?: 'api' | 'snapshot';
  itemGroupIds?: number[];
  enrichDescriptions?: boolean;
};

async function resolvePcsUomId(): Promise<string> {
  const uom = await prisma.uOM.findUnique({ where: { code: 'PCS' } });
  if (!uom) throw new Error('UOM with code PCS not found. Run db seed or reset-db-keep-auth.');
  return uom.id;
}

async function loadCategoryMap(): Promise<Map<number, string>> {
  const rows = await prisma.jubelioCategoryMapping.findMany({
    select: { jubelioCategoryId: true, itemCategoryId: true },
  });
  return new Map(
    rows.map((r: { jubelioCategoryId: number; itemCategoryId: string }) => [
      r.jubelioCategoryId,
      r.itemCategoryId,
    ])
  );
}

async function loadPayload(
  source: 'api' | 'snapshot',
  itemGroupIds?: number[],
  enrichDescriptions?: boolean
): Promise<JubelioItemsPayload> {
  let payload: JubelioItemsPayload;

  if (source === 'snapshot') {
    payload = loadSnapshotPayload(DEFAULT_SNAPSHOT);
  } else {
    payload = await fetchJubelioItems();
  }

  if (enrichDescriptions && source === 'api' && itemGroupIds?.length) {
    const token = await getValidJubelioToken();
    const descriptionsByGroupId = new Map<number, string>();
    const { fetchJubelioCatalogDescription } = await import('./client');
    for (const id of itemGroupIds) {
      const desc = await fetchJubelioCatalogDescription(token, id);
      if (desc) descriptionsByGroupId.set(id, desc);
      await new Promise((r) => setTimeout(r, 500));
    }
    return payload;
  }

  return payload;
}

function mergeVariantsOnUpdate(
  existing: VariantJson[] | null | undefined,
  incoming: VariantJson[]
): { merged: VariantJson[]; orphaned: string[] } {
  const existingList = Array.isArray(existing) ? (existing as VariantJson[]) : [];
  const incomingSkus = new Set(incoming.map((v) => v.sku.toLowerCase()));
  const mergedMap = new Map<string, VariantJson>();

  for (const v of existingList) {
    if (v.sku) mergedMap.set(v.sku.toLowerCase(), v);
  }
  for (const v of incoming) {
    mergedMap.set(v.sku.toLowerCase(), v);
  }

  const orphaned = existingList
    .filter((v) => v.sku && !incomingSkus.has(v.sku.toLowerCase()))
    .map((v) => v.sku);

  return { merged: Array.from(mergedMap.values()), orphaned };
}

async function ensureInventoryRows(
  tx: Prisma.TransactionClient,
  itemId: string,
  draft: CatalogItemDraft
): Promise<void> {
  const zeroRow = {
    qtyOnHand: 0,
    avgCost: 0,
    totalValue: 0,
  };

  if (draft.variantless) {
    const key = '';
    const existing = await tx.inventoryValue.findUnique({
      where: { itemId_variantSku: { itemId, variantSku: key } },
    });
    if (!existing) {
      await tx.inventoryValue.create({
        data: { itemId, variantSku: key, ...zeroRow },
      });
    }
    return;
  }

  if (draft.variants.length === 0) return;

  const existing = await tx.inventoryValue.findMany({
    where: { itemId },
    select: { variantSku: true },
  });
  const have = new Set(existing.map((r) => r.variantSku ?? ''));

  const toCreate = draft.variants
    .filter((v) => !have.has(v.sku))
    .map((v) => ({
      itemId,
      variantSku: v.sku,
      ...zeroRow,
    }));

  if (toCreate.length > 0) {
    await tx.inventoryValue.createMany({ data: toCreate });
  }
}

async function upsertMappings(
  tx: Prisma.TransactionClient,
  itemId: string,
  draft: CatalogItemDraft
): Promise<void> {
  const now = new Date();
  for (const sv of draft.sourceVariants) {
    await tx.jubelioProductMapping.upsert({
      where: { jubelioItemId: sv.jubelioItemId },
      create: {
        itemId,
        jubelioItemGroupId: sv.jubelioItemGroupId,
        jubelioItemId: sv.jubelioItemId,
        jubelioItemCode: sv.jubelioItemCode,
        erpVariantSku: draft.variantless ? '' : sv.erpVariantSku,
        lastSyncedAt: now,
        jubelioLastModified: draft.jubelioLastModified,
      },
      update: {
        itemId,
        jubelioItemGroupId: sv.jubelioItemGroupId,
        jubelioItemCode: sv.jubelioItemCode,
        erpVariantSku: draft.variantless ? '' : sv.erpVariantSku,
        lastSyncedAt: now,
        jubelioLastModified: draft.jubelioLastModified,
      },
    });
  }
}

async function persistDraft(
  draft: CatalogItemDraft,
  uomId: string,
  dryRun: boolean
): Promise<{ action: 'create' | 'update' | 'skip'; warnings: string[] }> {
  const warnings: string[] = [];
  const existing = await prisma.item.findUnique({ where: { sku: draft.itemSku } });

  if (dryRun) {
    return { action: existing ? 'update' : 'create', warnings };
  }

  const sellingPrice = sellingPriceToDecimal(draft.sellingPrice);
  const variantsJson = draft.variants as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          sku: draft.itemSku,
          nameId: draft.nameId,
          nameEn: draft.nameEn,
          description: draft.description ?? null,
          type: ItemType.FINISHED_GOOD,
          uomId,
          categoryId: draft.categoryId,
          variants: draft.variantless ? [] : variantsJson,
          isActive: true,
          reorderPoint: null,
          overReceiveThreshold: null,
          sellingPrice,
        },
      });
      await ensureInventoryRows(tx, item.id, draft);
      await upsertMappings(tx, item.id, draft);
    });
    return { action: 'create', warnings };
  }

  const existingVariants = existing.variants as VariantJson[] | null;
  const { merged, orphaned } = mergeVariantsOnUpdate(existingVariants, draft.variants);
  if (orphaned.length) {
    warnings.push(
      `Item ${draft.itemSku}: ${orphaned.length} ERP variant(s) not in Jubelio payload (kept in JSON)`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.item.update({
      where: { id: existing.id },
      data: {
        nameId: draft.nameId,
        nameEn: draft.nameEn,
        description: draft.description ?? existing.description,
        variants: draft.variantless ? [] : (merged as Prisma.InputJsonValue),
        sellingPrice,
      },
    });
    await ensureInventoryRows(tx, existing.id, draft);
    await upsertMappings(tx, existing.id, draft);
  });

  return { action: 'update', warnings };
}

export async function syncCatalog(opts: SyncCatalogOptions = {}): Promise<CatalogSyncResult> {
  const dryRun = opts.dryRun ?? false;
  const source = opts.source ?? 'api';

  if (source === 'snapshot' && process.env.NODE_ENV === 'production') {
    throw new Error('Snapshot source is only allowed in development');
  }

  if (source === 'api') {
    await getValidJubelioToken();
  }

  const categoryIdByJubelioId = await loadCategoryMap();
  const payload = await loadPayload(source, opts.itemGroupIds, opts.enrichDescriptions);

  const { drafts, warnings: buildWarnings } = buildCatalogDrafts(payload, {
    itemGroupIds: opts.itemGroupIds,
    categoryIdByJubelioId,
  });

  const uomId = dryRun ? '' : await resolvePcsUomId();

  const summary: CatalogSyncSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    warnings: [...buildWarnings],
  };

  const items: CatalogSyncItemResult[] = [];
  const errors: CatalogSyncError[] = [];

  let processed = 0;
  for (const draft of drafts) {
    try {
      if (!dryRun && !uomId) {
        throw new Error('UOM PCS missing');
      }
      const { action, warnings } = await persistDraft(draft, uomId, dryRun);
      processed++;
      if (!dryRun && processed % 25 === 0) {
        console.log(`[jubelio sync] ${processed}/${drafts.length} items...`);
      }
      summary.warnings.push(...warnings);
      if (action === 'create') summary.created++;
      else if (action === 'update') summary.updated++;
      else summary.skipped++;

      items.push({
        parentSku: draft.parentSku,
        itemSku: draft.itemSku,
        action,
        variantCount: draft.variantless ? 0 : draft.variants.length,
        variantless: draft.variantless,
      });
    } catch (e) {
      summary.errors++;
      errors.push({
        parentSku: draft.itemSku,
        jubelioItemGroupId: draft.jubelioItemGroupId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { dryRun, summary, items, errors };
}

export async function getJubelioTokenFromDb(): Promise<string | null> {
  const { token } = await readJubelioTokenFromDb();
  return token;
}

// Re-export for tests
export { SYNC_FIELDS } from './types';
