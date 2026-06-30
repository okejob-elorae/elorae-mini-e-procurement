import { Inject, Injectable, Logger } from "@nestjs/common";
import { ItemType, Prisma, createItemFromIngest, pruneJubelioOrphans, updateItemFromIngest, upsertJubelioImage } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { buildCatalogDrafts, sellingPriceToDecimal } from "./map-catalog";
import type {
  CatalogItemDraft,
  CatalogSyncError,
  CatalogSyncItemResult,
  CatalogSyncResult,
  CatalogSyncSummary,
  JubelioItemGroupDetail,
  JubelioItemsPayload,
  VariantJson,
} from "./catalog.types";

export type SyncCatalogOptions = {
  dryRun?: boolean;
  itemGroupIds?: number[];
};

/** Per-item persist upserts many Jubelio mappings; Prisma default tx timeout (5s) is too low. */
const CATALOG_PERSIST_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

const CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

@Injectable()
export class JubelioCatalogSyncService {
  private readonly logger = new Logger(JubelioCatalogSyncService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async syncCatalog(opts: SyncCatalogOptions = {}): Promise<CatalogSyncResult> {
    const dryRun = opts.dryRun ?? false;

    const categoryIdByJubelioId = await this.loadCategoryMap();
    const payload = await this.http.get<JubelioItemsPayload>("/inventory/items/");

    const { drafts, warnings: buildWarnings } = buildCatalogDrafts(payload, {
      itemGroupIds: opts.itemGroupIds,
      categoryIdByJubelioId,
    });

    const uomId = dryRun ? "" : await this.resolvePcsUomId();

    const summary: CatalogSyncSummary = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      warnings: [...buildWarnings],
    };
    const items: CatalogSyncItemResult[] = [];
    const errors: CatalogSyncError[] = [];

    // Fix 2: bulk prefetch all existing items in one query
    const allSkus = drafts.map((d) => d.itemSku);
    const existingItems = !dryRun
      ? await this.prisma.item.findMany({
          where: { sku: { in: allSkus } },
          select: { id: true, sku: true, description: true, variants: true },
        })
      : [];
    const existingBySku = new Map(existingItems.map((it) => [it.sku, it]));

    // Fix 1: bounded parallel draft processing
    const settled = await mapWithConcurrency(drafts, CONCURRENCY, async (draft) => {
      if (!dryRun && !uomId) throw new Error("UOM PCS missing");
      return this.persistDraft(draft, uomId, dryRun, existingBySku);
    });

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const draft = drafts[i];
      if (result.ok) {
        const { action, warnings } = result.value;
        summary.warnings.push(...warnings);
        if (action === "create") summary.created++;
        else if (action === "update") summary.updated++;
        else summary.skipped++;
        items.push({
          parentSku: draft.parentSku,
          itemSku: draft.itemSku,
          action,
          variantCount: draft.variantless ? 0 : draft.variants.length,
          variantless: draft.variantless,
        });
      } else {
        summary.errors++;
        errors.push({
          parentSku: draft.itemSku,
          jubelioItemGroupId: draft.jubelioItemGroupId,
          message: result.error instanceof Error ? result.error.message : String(result.error),
        });
      }
    }

    this.logger.log(
      `Sync done: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.errors} errors`,
    );
    return { dryRun, summary, items, errors };
  }

  private async resolvePcsUomId(): Promise<string> {
    const uom = await this.prisma.uOM.findUnique({ where: { code: "PCS" } });
    if (!uom) throw new Error("UOM with code PCS not found. Run db seed first.");
    return uom.id;
  }

  private async loadCategoryMap(): Promise<Map<number, string>> {
    const rows = await this.prisma.jubelioCategoryMapping.findMany({
      select: { jubelioCategoryId: true, itemCategoryId: true },
    });
    return new Map(rows.map((r) => [r.jubelioCategoryId, r.itemCategoryId]));
  }

  private mergeVariantsOnUpdate(
    existing: VariantJson[] | null | undefined,
    incoming: VariantJson[],
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

  // Fix 4: createMany skipDuplicates — eliminates per-variant findUnique/findMany round trips
  private async ensureInventoryRows(
    tx: Prisma.TransactionClient,
    itemId: string,
    draft: CatalogItemDraft,
  ): Promise<void> {
    const zeroRow = { qtyOnHand: 0, avgCost: 0, totalValue: 0 };

    if (draft.variantless) {
      await tx.inventoryValue.createMany({
        data: [{ itemId, variantSku: "", ...zeroRow }],
        skipDuplicates: true,
      });
      return;
    }

    if (draft.variants.length === 0) return;

    await tx.inventoryValue.createMany({
      data: draft.variants.map((v) => ({ itemId, variantSku: v.sku, ...zeroRow })),
      skipDuplicates: true,
    });
  }

  // Fix 3: parallel upserts within the same transaction
  private async upsertMappings(
    tx: Prisma.TransactionClient,
    itemId: string,
    draft: CatalogItemDraft,
  ): Promise<void> {
    const now = new Date();
    await Promise.all(
      draft.sourceVariants.map((sv) =>
        tx.jubelioProductMapping.upsert({
          where: { jubelioItemId: sv.jubelioItemId },
          create: {
            itemId,
            jubelioItemGroupId: sv.jubelioItemGroupId,
            jubelioItemId: sv.jubelioItemId,
            jubelioItemCode: sv.jubelioItemCode,
            erpVariantSku: draft.variantless ? "" : sv.erpVariantSku,
            lastSyncedAt: now,
            jubelioLastModified: draft.jubelioLastModified,
          },
          update: {
            itemId,
            jubelioItemGroupId: sv.jubelioItemGroupId,
            jubelioItemCode: sv.jubelioItemCode,
            erpVariantSku: draft.variantless ? "" : sv.erpVariantSku,
            lastSyncedAt: now,
            jubelioLastModified: draft.jubelioLastModified,
          },
        }),
      ),
    );
  }

  private async persistDraft(
    draft: CatalogItemDraft,
    uomId: string,
    dryRun: boolean,
    existingBySku: Map<string, { id: string; sku: string; description: string | null; variants: Prisma.JsonValue }>,
  ): Promise<{ action: "create" | "update" | "skip"; warnings: string[] }> {
    const warnings: string[] = [];
    // Fix 2: use prefetched map instead of per-draft findUnique
    const existing = existingBySku.get(draft.itemSku) ?? null;

    if (dryRun) {
      return { action: existing ? "update" : "create", warnings };
    }

    const sellingPrice = sellingPriceToDecimal(draft.sellingPrice);
    const variantsJson = draft.variants as Prisma.InputJsonValue;

    if (!existing) {
      let createdItemId = "";
      await this.prisma.$transaction(
        async (tx) => {
          const item = await createItemFromIngest(tx, {
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
          });
          await this.ensureInventoryRows(tx, item.id, draft);
          await this.upsertMappings(tx, item.id, draft);
          createdItemId = item.id;
        },
        CATALOG_PERSIST_TX_OPTIONS,
      );
      await this.syncImages(createdItemId, draft);
      return { action: "create", warnings };
    }

    const existingVariants = existing.variants as VariantJson[] | null;
    const { merged, orphaned } = this.mergeVariantsOnUpdate(existingVariants, draft.variants);
    if (orphaned.length) {
      warnings.push(
        `Item ${draft.itemSku}: ${orphaned.length} ERP variant(s) not in Jubelio payload (kept in JSON)`,
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        await updateItemFromIngest(tx, { id: existing.id }, {
          nameId: draft.nameId,
          nameEn: draft.nameEn,
          description: draft.description ?? existing.description,
          variants: draft.variantless ? [] : (merged as Prisma.InputJsonValue),
          sellingPrice,
        });
        await this.ensureInventoryRows(tx, existing.id, draft);
        await this.upsertMappings(tx, existing.id, draft);
      },
      CATALOG_PERSIST_TX_OPTIONS,
    );
    await this.syncImages(existing.id, draft);

    return { action: "update", warnings };
  }

  private async syncImages(itemId: string, draft: CatalogItemDraft): Promise<void> {
    // /inventory/items/ list endpoint only exposes a single `thumbnail` per group/variant —
    // multi-image arrays live in /inventory/items/group/{id}'s product_skus[].images[].
    // Fetch the detail per item; image_id is the durable identifier, cloud_key is the URL.
    let detail: JubelioItemGroupDetail;
    try {
      detail = await this.http.get<JubelioItemGroupDetail>(`/inventory/items/group/${draft.jubelioItemGroupId}`);
    } catch (err) {
      this.logger.warn(
        `syncImages: failed to fetch detail for group ${draft.jubelioItemGroupId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const seenJubelioIds: string[] = [];
    const productSkus = Array.isArray(detail.product_skus) ? detail.product_skus : [];

    for (const sku of productSkus) {
      if (typeof sku !== "object" || sku === null) continue;
      const variantSku = draft.variantless ? null : (typeof sku.item_code === "string" ? sku.item_code : null);
      const images = Array.isArray(sku.images) ? sku.images : [];
      for (const img of images) {
        if (typeof img !== "object" || img === null) continue;
        const cloudKey = typeof img.cloud_key === "string" ? img.cloud_key : "";
        const imageId = typeof img.image_id === "number" ? img.image_id : null;
        if (!cloudKey || imageId === null) continue;
        const jid = String(imageId);
        seenJubelioIds.push(jid);
        try {
          await upsertJubelioImage(this.prisma, {
            itemId,
            variantSku,
            url: cloudKey,
            sortOrder: typeof img.sequence_number === "number" ? img.sequence_number : 0,
            jubelioImageId: jid,
          });
        } catch (err) {
          this.logger.warn(
            `syncImages: failed to upsert image ${jid} for item ${itemId} variant=${variantSku ?? "<null>"}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    try {
      await pruneJubelioOrphans(this.prisma, itemId, seenJubelioIds);
    } catch (err) {
      this.logger.warn(`syncImages: failed to prune orphans for item ${itemId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
