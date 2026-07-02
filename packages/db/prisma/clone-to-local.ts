/**
 * Clones a scrubbed slice of prod data into a local MariaDB test bed.
 *
 * SRC_DATABASE_URL and DEST_DATABASE_URL are both required. DEST must never
 * point at the prod SSH tunnel (port 3307) — the script refuses to run if it
 * does, so a mistyped env var can't silently write to prod.
 *
 * Copies (FK-safe order): UOM, ItemCategory (prerequisite lookups for Item's
 * required/optional FKs) -> Item -> InventoryValue, JubelioProductMapping ->
 * SalesOrder (PII-scrubbed) -> SalesOrderItem -> JubelioSalesOrderState.
 *
 * Idempotent: every table is copied via createMany({ skipDuplicates: true }),
 * batched, so re-running against an already-populated local DB is safe.
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";

const BATCH_SIZE = 500;

function assertNotProdTunnel(url: string): void {
  if (url.includes("3307")) {
    throw new Error(
      "DEST_DATABASE_URL contains port 3307 (the prod SSH tunnel). Refusing to run — " +
        "this script must only write to the local test DB (port 3308).",
    );
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Set SRC_DATABASE_URL (prod, via tunnel) and DEST_DATABASE_URL (local test DB, port 3308).`);
  }
  return value;
}

async function batchInsert<T>(
  label: string,
  rows: T[],
  insertFn: (batch: T[]) => Promise<{ count: number }>,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await insertFn(batch);
    inserted += result.count;
  }
  console.log(`${label}: ${rows.length} read, ${inserted} inserted (skipDuplicates)`);
  return inserted;
}

/**
 * Ensure a generous connectTimeout. SRC is typically prod reached via an SSH
 * tunnel on 127.0.0.1:3307 — it "looks" local so no normalization adds a timeout,
 * but the tunnelled handshake far exceeds the mariadb driver's 1000ms default.
 */
function withConnectTimeout(url: string, ms = 30000): string {
  if (/[?&]connectTimeout=/i.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + `connectTimeout=${ms}`;
}

async function main() {
  const srcUrl = requireEnv("SRC_DATABASE_URL");
  const destUrl = requireEnv("DEST_DATABASE_URL");
  assertNotProdTunnel(destUrl);

  const src = new PrismaClient({ adapter: new PrismaMariaDb(withConnectTimeout(srcUrl)) });
  const dst = new PrismaClient({ adapter: new PrismaMariaDb(destUrl) });

  try {
    // ---------- Prerequisite lookups (FKs referenced by Item) ----------
    const uoms = await src.uOM.findMany();
    await batchInsert("UOM", uoms, (batch) =>
      dst.uOM.createMany({
        data: batch.map((u) => ({
          id: u.id,
          code: u.code,
          nameId: u.nameId,
          nameEn: u.nameEn,
          description: u.description,
          isActive: u.isActive,
          createdAt: u.createdAt,
        })),
        skipDuplicates: true,
      }),
    );

    const categories = await src.itemCategory.findMany();
    await batchInsert("ItemCategory", categories, (batch) =>
      dst.itemCategory.createMany({
        data: batch.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          isActive: c.isActive,
          sortOrder: c.sortOrder,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        skipDuplicates: true,
      }),
    );

    // ---------- Item ----------
    const items = await src.item.findMany();
    await batchInsert("Item", items, (batch) =>
      dst.item.createMany({
        data: batch.map((i) => ({
          id: i.id,
          sku: i.sku,
          nameId: i.nameId,
          nameEn: i.nameEn,
          description: i.description,
          type: i.type,
          uomId: i.uomId,
          categoryId: i.categoryId,
          variants: i.variants ?? undefined,
          isActive: i.isActive,
          reorderPoint: i.reorderPoint,
          overReceiveThreshold: i.overReceiveThreshold,
          sellingPrice: i.sellingPrice,
          targetMarginPercent: i.targetMarginPercent,
          additionalCost: i.additionalCost,
          defaultPpnIncluded: i.defaultPpnIncluded,
          source: i.source,
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
        })),
        skipDuplicates: true,
      }),
    );

    // ---------- ItemImage ----------
    // Non-PII; url points at the (public) R2 bucket so images render locally.
    const itemImages = await src.itemImage.findMany();
    await batchInsert("ItemImage", itemImages, (batch) =>
      dst.itemImage.createMany({
        data: batch.map((img) => ({
          id: img.id,
          itemId: img.itemId,
          variantSku: img.variantSku,
          url: img.url,
          sortOrder: img.sortOrder,
          jubelioImageId: img.jubelioImageId,
          jubelioImageKey: img.jubelioImageKey,
          jubelioImageThumbnail: img.jubelioImageThumbnail,
          syncedAt: img.syncedAt,
          source: img.source,
          createdAt: img.createdAt,
          updatedAt: img.updatedAt,
        })),
        skipDuplicates: true,
      }),
    );

    // ---------- InventoryValue ----------
    // SRC (prod) does NOT have reservedQty yet (the reserved-stock migration is
    // applied to local only until this feature merges + deploys). Select only the
    // pre-existing columns from source; local reservedQty defaults to 0.
    const inventoryValues = await src.inventoryValue.findMany({
      select: {
        id: true,
        itemId: true,
        variantSku: true,
        qtyOnHand: true,
        avgCost: true,
        totalValue: true,
        lastUpdated: true,
      },
    });
    await batchInsert("InventoryValue", inventoryValues, (batch) =>
      dst.inventoryValue.createMany({
        data: batch.map((v) => ({
          id: v.id,
          itemId: v.itemId,
          variantSku: v.variantSku,
          qtyOnHand: v.qtyOnHand,
          avgCost: v.avgCost,
          totalValue: v.totalValue,
          lastUpdated: v.lastUpdated,
        })),
        skipDuplicates: true,
      }),
    );

    // ---------- JubelioProductMapping ----------
    const productMappings = await src.jubelioProductMapping.findMany();
    await batchInsert("JubelioProductMapping", productMappings, (batch) =>
      dst.jubelioProductMapping.createMany({
        data: batch.map((m) => ({
          id: m.id,
          itemId: m.itemId,
          jubelioItemGroupId: m.jubelioItemGroupId,
          jubelioItemId: m.jubelioItemId,
          jubelioItemCode: m.jubelioItemCode,
          erpVariantSku: m.erpVariantSku,
          lastSyncedAt: m.lastSyncedAt,
          jubelioLastModified: m.jubelioLastModified,
        })),
        skipDuplicates: true,
      }),
    );

    // ---------- SalesOrder (PII SCRUB — mandatory, org policy) ----------
    const salesOrders = await src.salesOrder.findMany();
    await batchInsert("SalesOrder", salesOrders, (batch) =>
      dst.salesOrder.createMany({
        data: batch.map((o) => ({
          id: o.id,
          salesorderId: o.salesorderId,
          salesorderNo: o.salesorderNo,
          channel: o.channel,
          sourceName: o.sourceName,
          status: o.status,
          channelStatus: o.channelStatus,
          internalStatus: o.internalStatus,
          wmsStatus: o.wmsStatus,
          isCanceled: o.isCanceled,
          isPaid: o.isPaid,
          markedAsComplete: o.markedAsComplete,
          // PII SCRUB: never carry real customer identity/contact/address into local DB.
          customerName: "REDACTED",
          customerPhone: null,
          customerEmail: null,
          shippingProvince: o.shippingProvince,
          shippingCity: o.shippingCity,
          shippingAddress: undefined,
          subTotal: o.subTotal,
          totalDisc: o.totalDisc,
          totalTax: o.totalTax,
          shippingCost: o.shippingCost,
          grandTotal: o.grandTotal,
          feeBreakdown: o.feeBreakdown ?? undefined,
          paymentMethod: o.paymentMethod,
          paymentDate: o.paymentDate,
          transactionDate: o.transactionDate,
          createdDateJubelio: o.createdDateJubelio,
          completedDate: o.completedDate,
          cancelDate: o.cancelDate,
          lastModifiedJubelio: o.lastModifiedJubelio,
          trackingNumber: o.trackingNumber,
          courier: o.courier,
          lastWebhookEventId: o.lastWebhookEventId,
          fulfillmentStatus: o.fulfillmentStatus,
          pickedAt: o.pickedAt,
          pickedById: o.pickedById,
          packedAt: o.packedAt,
          packedById: o.packedById,
          shippedAt: o.shippedAt,
          shippedById: o.shippedById,
          shipmentJubelioId: o.shipmentJubelioId,
          courierId: o.courierId,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        })),
        skipDuplicates: true,
      }),
    );

    // ---------- SalesOrderItem ----------
    const salesOrderItems = await src.salesOrderItem.findMany();
    await batchInsert("SalesOrderItem", salesOrderItems, (batch) =>
      dst.salesOrderItem.createMany({
        data: batch.map((si) => ({
          id: si.id,
          salesOrderId: si.salesOrderId,
          salesorderDetailId: si.salesorderDetailId,
          jubelioItemId: si.jubelioItemId,
          jubelioItemCode: si.jubelioItemCode,
          itemId: si.itemId,
          productName: si.productName,
          qty: si.qty,
          qtyInBase: si.qtyInBase,
          returnedQty: si.returnedQty,
          isCanceledItem: si.isCanceledItem,
          unitPrice: si.unitPrice,
          pricePaid: si.pricePaid,
          discAmount: si.discAmount,
          taxAmount: si.taxAmount,
          lineTotal: si.lineTotal,
          discMarketplace: si.discMarketplace,
          weightInGram: si.weightInGram,
        })),
        skipDuplicates: true,
      }),
    );

    // ---------- JubelioSalesOrderState ----------
    const orderStates = await src.jubelioSalesOrderState.findMany();
    await batchInsert("JubelioSalesOrderState", orderStates, (batch) =>
      dst.jubelioSalesOrderState.createMany({
        data: batch.map((s) => ({
          id: s.id,
          salesorderId: s.salesorderId,
          stockApplied: s.stockApplied,
          lastStatus: s.lastStatus,
          lastIsCanceled: s.lastIsCanceled,
          appliedAt: s.appliedAt,
          reversedAt: s.reversedAt,
          lastWebhookEventId: s.lastWebhookEventId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        skipDuplicates: true,
      }),
    );

    console.log("Clone complete.");
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
