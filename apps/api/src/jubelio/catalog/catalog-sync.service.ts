import { Inject, Injectable, Logger } from "@nestjs/common";
import { ItemType, Prisma } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { buildCatalogDrafts, sellingPriceToDecimal } from "./map-catalog";
import type {
  CatalogItemDraft,
  CatalogSyncError,
  CatalogSyncItemResult,
  CatalogSyncResult,
  CatalogSyncSummary,
  JubelioItemsPayload,
  VariantJson,
} from "./catalog.types";

export type SyncCatalogOptions = {
  dryRun?: boolean;
  itemGroupIds?: number[];
};

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

    let processed = 0;
    for (const draft of drafts) {
      try {
        if (!dryRun && !uomId) throw new Error("UOM PCS missing");
        const { action, warnings } = await this.persistDraft(draft, uomId, dryRun);
        processed++;
        if (!dryRun && processed % 25 === 0) {
          this.logger.log(`${processed}/${drafts.length} items processed`);
        }
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
      } catch (e) {
        summary.errors++;
        errors.push({
          parentSku: draft.itemSku,
          jubelioItemGroupId: draft.jubelioItemGroupId,
          message: e instanceof Error ? e.message : String(e),
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

  private async ensureInventoryRows(
    tx: Prisma.TransactionClient,
    itemId: string,
    draft: CatalogItemDraft,
  ): Promise<void> {
    const zeroRow = { qtyOnHand: 0, avgCost: 0, totalValue: 0 };

    if (draft.variantless) {
      const existing = await tx.inventoryValue.findUnique({
        where: { itemId_variantSku: { itemId, variantSku: "" } },
      });
      if (!existing) {
        await tx.inventoryValue.create({ data: { itemId, variantSku: "", ...zeroRow } });
      }
      return;
    }

    if (draft.variants.length === 0) return;

    const existing = await tx.inventoryValue.findMany({
      where: { itemId },
      select: { variantSku: true },
    });
    const have = new Set(existing.map((r) => r.variantSku ?? ""));

    const toCreate = draft.variants
      .filter((v) => !have.has(v.sku))
      .map((v) => ({ itemId, variantSku: v.sku, ...zeroRow }));

    if (toCreate.length > 0) {
      await tx.inventoryValue.createMany({ data: toCreate });
    }
  }

  private async upsertMappings(
    tx: Prisma.TransactionClient,
    itemId: string,
    draft: CatalogItemDraft,
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
      });
    }
  }

  private async persistDraft(
    draft: CatalogItemDraft,
    uomId: string,
    dryRun: boolean,
  ): Promise<{ action: "create" | "update" | "skip"; warnings: string[] }> {
    const warnings: string[] = [];
    const existing = await this.prisma.item.findUnique({ where: { sku: draft.itemSku } });

    if (dryRun) {
      return { action: existing ? "update" : "create", warnings };
    }

    const sellingPrice = sellingPriceToDecimal(draft.sellingPrice);
    const variantsJson = draft.variants as Prisma.InputJsonValue;

    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
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
        await this.ensureInventoryRows(tx, item.id, draft);
        await this.upsertMappings(tx, item.id, draft);
      });
      return { action: "create", warnings };
    }

    const existingVariants = existing.variants as VariantJson[] | null;
    const { merged, orphaned } = this.mergeVariantsOnUpdate(existingVariants, draft.variants);
    if (orphaned.length) {
      warnings.push(
        `Item ${draft.itemSku}: ${orphaned.length} ERP variant(s) not in Jubelio payload (kept in JSON)`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
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
      await this.ensureInventoryRows(tx, existing.id, draft);
      await this.upsertMappings(tx, existing.id, draft);
    });

    return { action: "update", warnings };
  }
}
