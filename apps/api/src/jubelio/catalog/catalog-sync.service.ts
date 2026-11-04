import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ItemType,
  Prisma,
  createItemFromIngest,
  pruneJubelioOrphans,
  recordJubelioObservedPrice,
  recordJubelioPriceOnMapping,
  updateItemFromIngest,
  upsertJubelioImage,
} from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { fetchItemGroups } from "../inventory/fetch-item-groups";
import { OUTBOX_SKIP_REASONS } from "../outbox/outbox-status";
import { buildCatalogDrafts, sellingPriceToDecimal } from "./map-catalog";
import type {
  CatalogItemDraft,
  CatalogSyncError,
  CatalogSyncItemResult,
  CatalogSyncResult,
  CatalogSyncSummary,
  JubelioItemGroupDetail,
  VariantJson,
} from "./catalog.types";

export type SyncCatalogOptions = {
  dryRun?: boolean;
  itemGroupIds?: number[];
};

/** Per-item persist upserts many Jubelio mappings; Prisma default tx timeout (5s) is too low. */
const CATALOG_PERSIST_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

const CONCURRENCY = 8;

// Fix 4: createMany skipDuplicates — eliminates per-variant findUnique/findMany round trips
export async function ensureInventoryRows(
  tx: Prisma.TransactionClient,
  itemId: string,
  draft: CatalogItemDraft,
): Promise<void> {
  const zeroRow = { qtyOnHand: 0, avgCost: 0, totalValue: 0 };

  if (draft.variantless) {
    /* A "" row beside a null one splits reservations across the two rows. */
    const existing = await tx.inventoryValue.findFirst({
      where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
      select: { id: true },
    });
    if (existing) return;

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

/**
 * The draft narrowed to the variants the ERP item itself lists, for an item whose ERP edits are
 * not reaching Jubelio (see the update branch of `persistDraft`). The rule is the product push's
 * own: it keeps a mapping whose `erpVariantSku` is in the item's variant skus — or `""` for an
 * item without variants — and DELETEs every other one in Jubelio. So a Jubelio variant is kept here
 * only when its key matches that set exactly; anything else would be mapped only to be deleted.
 *
 * - ERP without variants, Jubelio without variants: kept whole (the one `""` mapping and row).
 * - ERP without variants, Jubelio with variants (or the reverse): nothing is mapped or created.
 * - Both with variants: the Jubelio variants whose sku the ERP lists, nothing else.
 */
export function limitToErpVariants(
  draft: CatalogItemDraft,
  erpVariants: VariantJson[] | null | undefined,
): CatalogItemDraft {
  const erpSkus = new Set(
    (Array.isArray(erpVariants) ? erpVariants : [])
      .map((v) => (v && typeof v.sku === "string" ? v.sku : ""))
      .filter((sku) => sku !== ""),
  );
  if (erpSkus.size === 0) {
    return draft.variantless ? draft : { ...draft, variants: [], sourceVariants: [] };
  }
  if (draft.variantless) return { ...draft, variantless: false, variants: [], sourceVariants: [] };
  return {
    ...draft,
    variants: draft.variants.filter((v) => erpSkus.has(v.sku)),
    sourceVariants: draft.sourceVariants.filter((sv) => erpSkus.has(sv.erpVariantSku)),
  };
}

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
    /*
     * Captured BEFORE the fetch: what Jubelio showed is recorded as read at this moment, so a push
     * that lands while the fetch is running is never overwritten by this older reading
     * (`recordJubelioObservedPrice` refuses a read older than the one recorded).
     */
    const readAt = new Date();
    const payload = await fetchItemGroups(this.http, this.logger, {
      stopWhenSeen: opts.itemGroupIds?.length ? new Set(opts.itemGroupIds) : undefined,
    });

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
      return this.persistDraft(draft, uomId, dryRun, existingBySku, readAt);
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
    readAt: Date,
  ): Promise<{ action: "create" | "update" | "skip"; warnings: string[] }> {
    const warnings: string[] = [];
    // Fix 2: use prefetched map instead of per-draft findUnique
    const existing = existingBySku.get(draft.itemSku) ?? null;

    if (dryRun) {
      return { action: existing ? "update" : "create", warnings };
    }

    const variantsJson = draft.variants as Prisma.InputJsonValue;
    /* THE Jubelio price is the highest variant price (owner answer P1); see summarizeJubelioPrices. */
    const sellingPrice = sellingPriceToDecimal(draft.sellingPrice);
    const observed = draft.priceKnown ? { highest: draft.sellingPrice, lowest: draft.lowestPrice } : null;

    if (!existing) {
      /*
       * Only a new item takes Jubelio's sell_price, and createItemFromIngest records that price as
       * the confirmed Jubelio price too (owner decision 2026-11-02): it is what Jubelio shows. See
       * the update branch below for an existing item.
       */
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
          }, undefined, observed ? { ...observed, readAt } : undefined);
          await ensureInventoryRows(tx, item.id, draft);
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

    /*
     * No sellingPrice here: an existing item's price is typed by hand (owner decisions
     * 2026-11-01/02), this runs on every Jubelio product webhook, it writes no
     * ItemPriceChangeLog, and an empty sell_price would reset the price to NULL.
     * IngestItemUpdateData Omits it, so writing it here is a type error.
     *
     * What Jubelio holds is recorded instead, and only when the ERP has no confirmed Jubelio price
     * for the item yet (an ERP item this sync is mapping for the first time, or one created by an
     * older build): the confirmation list then compares the typed price against the price Jubelio
     * really shows, and the item's other pushes are not held back for a price Jubelio already has.
     */
    await this.prisma.$transaction(
      async (tx) => {
        /*
         * An ERP edit that never reached Jubelio must not be undone from Jubelio: the item's pushes
         * are HELD while its Jubelio price differs (owner answer P75, `price_differs_held`), and a
         * "Toko offline saja" item's edits are never pushed at all (P3a). Writing Jubelio's name and
         * variants here would bring the old ones back into the ERP and the salesman/SPG catalogs,
         * and the release of the hold would then send them back to Jubelio. So for those items the
         * synced fields are kept as the ERP has them, and only the variants the ERP itself lists are
         * mapped and given inventory rows (`limitToErpVariants`): a mapping for a variant the ERP
         * does not list is exactly what the next push DELETEs in Jubelio (its `removed` block), and
         * that next push is the release, a Kirim ulang, a confirmation or the P72 (de)activation —
         * a variant someone added in Jubelio would be deleted there. It is left unmapped instead,
         * and merged by the first ingest after the item's pushes resume. The cost, named in the
         * warning: meanwhile a marketplace order for that variant reserves no ERP stock, and the
         * salesorder handler says so (`JUBELIO_UNMAPPED_LINES`); a variant deleted from a live
         * listing cannot be brought back from the ERP. Whether such a variant should be added to
         * the ERP item instead is an open owner question. What Jubelio shows is
         * recorded over ALL its variants either way, the same reading the observer and the push
         * take (`summarizeGroupsPrice`).
         */
        let kept = draft;
        if (await this.erpEditsUnsent(tx, existing.id)) {
          await updateItemFromIngest(tx, { id: existing.id }, {});
          kept = limitToErpVariants(draft, existingVariants);
          warnings.push(
            `Item ${draft.itemSku}: name and variants kept as in the ERP (sold offline only, or its Jubelio pushes are held for a price difference)`,
          );
          const unmapped = draft.sourceVariants.length - kept.sourceVariants.length;
          if (unmapped > 0) {
            warnings.push(
              `Item ${draft.itemSku}: ${unmapped} Jubelio variant(s) the ERP does not list left unmapped until its pushes resume; a marketplace order for them reserves no ERP stock`,
            );
          }
        } else {
          await updateItemFromIngest(tx, { id: existing.id }, {
            nameId: draft.nameId,
            nameEn: draft.nameEn,
            description: draft.description ?? existing.description,
            variants: draft.variantless ? [] : (merged as Prisma.InputJsonValue),
          });
        }
        await ensureInventoryRows(tx, existing.id, kept);
        await this.upsertMappings(tx, existing.id, kept);
        if (draft.sourceVariants.length > 0) {
          await recordJubelioPriceOnMapping(tx, existing.id, sellingPrice);
          /*
           * What Jubelio shows now, highest and lowest variant price (P1/P2): the warning "Harga di
           * Jubelio berbeda dengan ERP" is derived from it. Never written onto sellingPrice.
           */
          if (observed) await recordJubelioObservedPrice(tx, existing.id, observed, readAt);
        }
      },
      CATALOG_PERSIST_TX_OPTIONS,
    );
    await this.syncImages(existing.id, draft);

    return { action: "update", warnings };
  }

  /**
   * The item holds ERP edits Jubelio has not received and will not receive by itself: it is sold
   * in offline stores only, or its latest product push was held for a price difference.
   */
  private async erpEditsUnsent(tx: Prisma.TransactionClient, itemId: string): Promise<boolean> {
    const item = await tx.item.findUnique({ where: { id: itemId }, select: { salesChannel: true } });
    if (item?.salesChannel === "OFFLINE") return true;
    const latest = await tx.jubelioOutbox.findFirst({
      where: { entityType: "product_push", entityId: itemId },
      orderBy: { createdAt: "desc" },
      select: { status: true, skipReason: true },
    });
    return latest?.status === "SKIPPED" && latest.skipReason === OUTBOX_SKIP_REASONS.PRICE_DIFFERS_HELD;
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

    // Jubelio's product_skus[].item_code uses the raw Jubelio SKU (e.g. "28000005K-CRM-L"),
    // but ERP item.variants store the canonical ERP sku (e.g. "28000005K-L") after the
    // color-code is stripped by parse-item-code. Map raw → ERP via sourceVariants so the
    // gallery editor can group images by the ERP variant sku.
    const erpSkuByJubelioCode = new Map<string, string>(
      draft.sourceVariants.map((sv) => [sv.jubelioItemCode, sv.erpVariantSku]),
    );

    for (const sku of productSkus) {
      if (typeof sku !== "object" || sku === null) continue;
      const jubelioCode = typeof sku.item_code === "string" ? sku.item_code : "";
      const variantSku = draft.variantless ? null : (erpSkuByJubelioCode.get(jubelioCode) ?? jubelioCode);
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
