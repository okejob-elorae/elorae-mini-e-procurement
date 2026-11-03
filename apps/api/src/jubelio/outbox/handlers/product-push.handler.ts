import { Inject, Injectable, Logger } from "@nestjs/common";
import { markJubelioCreateRequested, recordJubelioObservedPrice, type JubelioOutbox } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { summarizeGroupsPrice } from "../../catalog/map-catalog";
import { JubelioHttpService } from "../../http.service";
import { JubelioImageUploadService } from "../../image-upload.service";
import { fetchItemGroups } from "../../inventory/fetch-item-groups";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";
import {
  buildCreateProductRequest,
  jubelioAktifUntukKirim,
  resolvePushPrice,
  tahanKarenaHargaBeda,
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
    private readonly imageUpload: JubelioImageUploadService,
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

    /*
     * "Toko offline saja" is never sent to Jubelio (owner answer P3a, 2026-11-02). Checked before
     * the price resolution so no create request is ever stamped for it. A product Jubelio ALREADY
     * has goes on below, with is_active false: it is deactivated, never deleted (P72).
     */
    if (item.salesChannel === "OFFLINE" && mappings.length === 0) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.SALES_CHANNEL_OFFLINE };
    }

    const defaults = await this.prisma.jubelioPushDefaults.findFirst();
    if (!defaults) return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.DEFAULTS_MISSING };

    if (mappings.length === 0 && item.source !== "ERP") {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.CANNOT_CREATE_FROM_INGESTED };
    }

    /*
     * Jubelio only ever receives the price confirmed in the ERP (owner decision 2026-11-02): a
     * product without one is not pushed, and a new product is not created until its price is
     * confirmed. A create push that reaches here with neither a confirmed price nor a request is
     * turned into a request (one guarded UPDATE), so it waits on Jubelio -> Konfirmasi harga.
     */
    const pushPrice = resolvePushPrice({
      mapped: mappings.length > 0,
      source: item.source,
      jubelioConfirmedPrice: item.jubelioConfirmedPrice == null ? null : Number(item.jubelioConfirmedPrice),
      jubelioCreateRequestedAt: item.jubelioCreateRequestedAt,
    });
    if (!pushPrice.ok) {
      if (pushPrice.stampRequest) {
        await markJubelioCreateRequested(this.prisma, item.id, row.enqueuedById);
      }
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.PRICE_NOT_CONFIRMED };
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

    /*
     * No push may change a price someone set directly in Jubelio until an admin decides it (owner
     * answer P75). So Jubelio is READ right before writing: an edit made since the last reading is
     * recorded first (the 10-minute observer and the product webhook may not have seen it yet),
     * and the item is held when Jubelio's price differs from the confirmed one with no decision
     * taken after that reading changed. Held = nothing sent at all (see `tahanKarenaHargaBeda`).
     * Only for a product Jubelio already has; a create push has nothing to read.
     */
    if (mappings.length > 0) {
      const held = await this.readJubelioAndCheckHold(item.id, mappings);
      if (held) return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.PRICE_DIFFERS_HELD };
    }

    const variantsArr = Array.isArray(item.variants) ? (item.variants as Array<{ sku: string }>) : null;
    const hasVariants = variantsArr !== null && variantsArr.length > 0;

    const images = await this.prisma.itemImage.findMany({
      where: { itemId: item.id },
      select: { id: true, variantSku: true, url: true, sortOrder: true, jubelioImageId: true, jubelioImageKey: true, jubelioImageThumbnail: true },
    });

    const needsUpload = images.some((i) => i.jubelioImageKey === null);
    await this.imageUpload.ensureUploaded(
      images.map((i) => ({ id: i.id, url: i.url, jubelioImageKey: i.jubelioImageKey })),
    );
    const refreshedImages = needsUpload
      ? await this.prisma.itemImage.findMany({
          where: { itemId: item.id },
          select: { id: true, variantSku: true, url: true, sortOrder: true, jubelioImageId: true, jubelioImageKey: true, jubelioImageThumbnail: true },
        })
      : images;

    const pushInput = {
      item: {
        id: item.id,
        sku: item.sku,
        nameId: item.nameId,
        nameEn: item.nameEn,
        description: item.description,
        variants: variantsArr,
        jubelioPrice: pushPrice.price,
        isActive: jubelioAktifUntukKirim(item.isActive, item.salesChannel),
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
      images: refreshedImages,
    };
    const body = buildCreateProductRequest({ ...pushInput, mappings });

    /* The moment just before the LAST catalog POST is when Jubelio was set to the confirmed price. */
    let sentAt = new Date();
    const response = await this.http.post<CatalogPostResponse>("/inventory/catalog/", body);

    const upserts = body.product_skus.map((sku, i) => {
      const jubelioItemId = response.item_ids[i];
      const erpVariantSku = hasVariants ? sku.item_code : "";
      return this.prisma.jubelioProductMapping.upsert({
        where: { jubelioItemCode: sku.item_code },
        create: {
          itemId: item.id,
          jubelioItemGroupId: response.id,
          jubelioItemId,
          jubelioItemCode: sku.item_code,
          erpVariantSku,
        },
        update: {
          itemId: item.id,
          jubelioItemGroupId: response.id,
          jubelioItemId,
          erpVariantSku,
        },
      });
    });
    await this.prisma.$transaction(upserts);

    const existingCodes = new Set(mappings.map((m) => m.jubelioItemCode));
    const newCount = body.product_skus.filter((s) => !existingCodes.has(s.item_code)).length;

    const desiredSkuSet = new Set(
      hasVariants ? variantsArr!.map((v) => v.sku) : [""],
    );
    const removed = mappings.filter((m) => !desiredSkuSet.has(m.erpVariantSku));
    /**
     * Jubelio first, then the mappings, and deliberately not in one transaction: the HTTP call has no
     * timeout, so a transaction around it could expire after Jubelio had already deleted. A mapping
     * delete that fails here fails the row, and its retry recomputes `removed` from the surviving
     * mappings and sends the DELETE again. Jubelio answered 200 to a DELETE of an id that does not
     * exist (probed on prod 2026-09-30 with one that never existed; an id Jubelio already deleted is
     * assumed to answer the same), and the retry's catalog POST does not name a removed variant (see
     * `buildJubelioImages`), so the retry converges.
     */
    if (removed.length > 0) {
      await this.http.delete("/inventory/items/item-variant/", {
        body: JSON.stringify({ ids: removed.map((m) => m.jubelioItemId) }),
        headers: { "Content-Type": "application/json" },
      });
      await this.prisma.jubelioProductMapping.deleteMany({
        where: { id: { in: removed.map((m) => m.id) } },
      });
    }

    /**
     * `variation_images` can only name variants Jubelio has already given an item id, so a first push
     * sends none for a variant it created (sent as `item_id: 0`) that has its own images. Now that its
     * mapping exists, push once more so those images land now rather than on some later edit. A throw
     * here fails the row, and its retry repeats the whole push, which by then carries the images. The
     * follow-up only edits: if a variant would still go out unmapped it is skipped, never re-created.
     */
    const createdCodes = new Set(
      body.product_skus.filter((s) => s.item_id === 0).map((s) => s.item_code),
    );
    const createdVariantHasImages =
      hasVariants &&
      refreshedImages.some(
        (i) => i.variantSku !== null && i.jubelioImageKey !== null && createdCodes.has(i.variantSku),
      );
    let imagesRePushed = false;
    if (createdVariantHasImages) {
      const finalMappings = (await this.prisma.jubelioProductMapping.findMany({
        where: { itemId: item.id },
      })) as MappingSlice[];
      const followUp = buildCreateProductRequest({ ...pushInput, mappings: finalMappings });
      if (followUp.product_skus.some((s) => s.item_id === 0)) {
        this.logger.warn(`Item ${item.id}: a variant is still unmapped after the push; skipping the variant-image re-push`);
      } else {
        sentAt = new Date();
        await this.http.post<CatalogPostResponse>("/inventory/catalog/", followUp);
        imagesRePushed = true;
      }
    }

    /*
     * Jubelio now shows the confirmed price on every variant: record that as what Jubelio shows, so
     * the warning clears at once instead of on the next read. Best effort: the push already reached
     * Jubelio, and failing the row here would only push the same body again.
     */
    try {
      await recordJubelioObservedPrice(this.prisma, item.id, { highest: pushPrice.price, lowest: pushPrice.price }, sentAt);
    } catch (err) {
      this.logger.warn(`Item ${item.id}: pushed, but recording the pushed Jubelio price failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.logger.log(
      `Pushed item ${item.id} (group=${response.id}, +${newCount} mappings, -${removed.length}${imagesRePushed ? ", variant images re-pushed" : ""})`,
    );
    return { kind: "processed" };
  }

  /**
   * Reads what Jubelio shows for the item's group(s) — from the same catalog list the ingest and
   * the price observer read, through the same variant rule (`summarizeGroupsPrice`: bundles and
   * unreadable item codes skipped, one row per item_id), so all three readings agree and a reading
   * never moves `jubelioObservedChangedAt` by itself — records it, and says whether the push must be
   * held (P75). A failed read throws: the row is retried rather than writing blind. A group Jubelio
   * no longer lists, or one with no readable price, records nothing and is judged on what was
   * recorded before.
   */
  private async readJubelioAndCheckHold(itemId: string, mappings: MappingSlice[]): Promise<boolean> {
    const groupIds = new Set(mappings.map((m) => m.jubelioItemGroupId));
    const readAt = new Date();
    const payload = await fetchItemGroups(this.http, this.logger, { stopWhenSeen: groupIds, redactResponseBody: true });
    const price = summarizeGroupsPrice(payload.data, groupIds);
    if (price) await recordJubelioObservedPrice(this.prisma, itemId, price, readAt);
    const state = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: {
        jubelioConfirmedPrice: true,
        jubelioObservedPriceMax: true,
        jubelioObservedPriceMin: true,
        jubelioObservedAt: true,
        jubelioObservedChangedAt: true,
        jubelioPriceDecidedAt: true,
      },
    });
    if (!state) return false;
    const num = (v: unknown) => (v == null ? null : Number(v));
    return tahanKarenaHargaBeda({
      mapped: true,
      observedAt: state.jubelioObservedAt,
      observedMax: num(state.jubelioObservedPriceMax),
      observedMin: num(state.jubelioObservedPriceMin),
      confirmed: num(state.jubelioConfirmedPrice),
      decidedAt: state.jubelioPriceDecidedAt,
      observedChangedAt: state.jubelioObservedChangedAt,
    });
  }
}
