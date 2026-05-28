import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";
import {
  buildCreateProductRequest,
  type MappingSlice,
} from "./product-push.payload";

type CatalogPostResponse = {
  status: string;
  id: number;
  item_ids: number[];
};

@Injectable()
export class ProductPushHandler implements OutboxHandler {
  private readonly logger = new Logger(ProductPushHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const item = await this.prisma.item.findUnique({ where: { id: row.entityId } });
    if (!item) return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.ORPHAN_ITEM };
    if (item.type !== "FINISHED_GOOD") {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.WRONG_TYPE };
    }

    const mappings = (await this.prisma.jubelioProductMapping.findMany({
      where: { itemId: item.id },
    })) as MappingSlice[];

    const defaults = await this.prisma.jubelioPushDefaults.findFirst();
    if (!defaults) return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.DEFAULTS_MISSING };

    if (mappings.length === 0 && item.source !== "ERP") {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.CANNOT_CREATE_FROM_INGESTED };
    }

    if (!item.categoryId) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.CATEGORY_UNMAPPED };
    }
    const categoryMap = await this.prisma.jubelioCategoryMapping.findFirst({
      where: { itemCategoryId: item.categoryId },
    });
    if (!categoryMap) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.CATEGORY_UNMAPPED };
    }

    const variantsArr = Array.isArray(item.variants) ? (item.variants as Array<{ sku: string }>) : null;
    const hasVariants = variantsArr !== null && variantsArr.length > 0;

    const body = buildCreateProductRequest({
      item: {
        id: item.id,
        sku: item.sku,
        nameId: item.nameId,
        nameEn: item.nameEn,
        description: item.description,
        variants: variantsArr,
        sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
        isActive: item.isActive,
      },
      defaults: {
        sellTaxId: defaults.sellTaxId, buyTaxId: defaults.buyTaxId,
        salesAcctId: defaults.salesAcctId, cogsAcctId: defaults.cogsAcctId,
        invtAcctId: defaults.invtAcctId, purchAcctId: defaults.purchAcctId,
        uomId: defaults.uomId, brandId: defaults.brandId, brandName: defaults.brandName,
        sellThis: defaults.sellThis, buyThis: defaults.buyThis, stockThis: defaults.stockThis,
        dropshipThis: defaults.dropshipThis, isActive: defaults.isActive,
        sellUnit: defaults.sellUnit, buyUnit: defaults.buyUnit,
        packageWeight: defaults.packageWeight,
        storePriorityQtyTreshold: defaults.storePriorityQtyTreshold,
        rop: defaults.rop,
        useSingleImageSet: defaults.useSingleImageSet,
        useSerialNumber: defaults.useSerialNumber,
        buyPrice: Number(defaults.buyPrice),
      },
      categoryJubelioId: categoryMap.jubelioCategoryId,
      mappings,
    });

    const response = await this.http.post<CatalogPostResponse>("/inventory/catalog/", body);

    const existingSkus = new Set(mappings.map((m) => m.erpVariantSku));
    const newMappings: Array<{
      itemId: string;
      jubelioItemGroupId: number;
      jubelioItemId: number;
      jubelioItemCode: string;
      erpVariantSku: string;
    }> = [];

    for (let i = 0; i < body.product_skus.length; i++) {
      const sku = body.product_skus[i];
      const jubelioItemId = response.item_ids[i];
      const erpVariantSku = hasVariants ? sku.item_code : "";
      if (!existingSkus.has(erpVariantSku)) {
        newMappings.push({
          itemId: item.id,
          jubelioItemGroupId: response.id,
          jubelioItemId,
          jubelioItemCode: sku.item_code,
          erpVariantSku,
        });
      }
    }
    if (newMappings.length > 0) {
      await this.prisma.jubelioProductMapping.createMany({ data: newMappings });
    }

    const desiredSkuSet = new Set(
      hasVariants ? variantsArr!.map((v) => v.sku) : [""],
    );
    const removed = mappings.filter((m) => !desiredSkuSet.has(m.erpVariantSku));
    if (removed.length > 0) {
      await this.http.delete("/inventory/items/item-variant/", {
        body: JSON.stringify(removed.map((m) => m.jubelioItemId)),
        headers: { "Content-Type": "application/json" },
      });
      await this.prisma.jubelioProductMapping.deleteMany({
        where: { id: { in: removed.map((m) => m.id) } },
      });
    }

    this.logger.log(
      `Pushed item ${item.id} (group=${response.id}, +${newMappings.length} mappings, -${removed.length})`,
    );
    return { kind: "processed" };
  }
}
