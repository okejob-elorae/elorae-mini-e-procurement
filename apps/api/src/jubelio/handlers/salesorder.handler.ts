import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioWebhookEvent, ReservationLine } from "@elorae/db";
import { reserveOrder, releaseOrder, consumeOrder } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { AdminNotificationService } from "../../admin/notification.service";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";
import type { SalesOrderLine, SalesOrderPayload } from "./salesorder.payload";
import { resolveItemMapping } from "./_shared/mapping-lookup";
import { detectChannel } from "./_shared/channel-detect";
import { deriveStatus, isCanceledOrder, isReturnedOrder, isShippedOrder } from "./_shared/status-derive";
import { SalesReturnIngestService } from "../returns/sales-return-ingest.service";
import type { JubelioSalesOrderDetail } from "../jubelio-http.client";

type UnmappedLine = { item_code: string; item_id: number; qty: string | number };

function dec(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "0";
  return String(v);
}

/**
 * Blank-after-trim (null, undefined, "", or whitespace-only) collapses to `null` —
 * treated as "no value carried in this payload", not a real overwrite. Used for
 * `tracking_number`/`courier` so a stale or resi-less webhook processed after a
 * newer one cannot wipe a stored resi; a non-empty value always passes through.
 */
function nonBlank(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v.trim() === "" ? null : v;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A payload is stale only when BOTH timestamps are known and the incoming one is strictly older
 * than the stored one. Equal or missing timestamps process as before.
 */
export function isStalePayload(incoming: Date | null, stored: Date | null): boolean {
  return incoming !== null && stored !== null && incoming.getTime() < stored.getTime();
}

function buildShippingAddress(p: SalesOrderPayload): Record<string, string> | undefined {
  const fields: Record<string, string> = {};
  const map: Record<string, string | null | undefined> = {
    full_name: p.shipping_full_name,
    address: p.shipping_address,
    area: p.shipping_area,
    city: p.shipping_city,
    province: p.shipping_province,
    post_code: p.shipping_post_code,
    country: p.shipping_country,
    phone: p.shipping_phone,
    subdistrict: p.shipping_subdistrict,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v !== null && v !== undefined && v !== "") fields[k] = v;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

// Raw "this order shipped" signal — broader than the derived `status` enum,
// which collapses ship + delivery into SHIPPED vs COMPLETED. Anything that
// implies the package left the warehouse counts.
function reportsShipped(p: SalesOrderPayload): boolean {
  return isShippedOrder(p) || p.marked_as_complete === true || !!p.completed_date;
}

function buildFeeBreakdown(p: SalesOrderPayload): Record<string, string> | undefined {
  const fields = {
    insurance_cost: dec(p.insurance_cost),
    add_fee: dec(p.add_fee),
    add_disc: dec(p.add_disc),
    service_fee: dec(p.service_fee),
    // TikTok/Tokopedia null the top-level escrow_amount and carry the settled
    // net in escrow_list.settlement_amount — fall back to it so their orders
    // get a real escrow (Shopee keeps using the top-level field).
    escrow_amount: dec(p.escrow_amount ?? p.escrow_list?.settlement_amount),
    voucher_amount: dec(p.voucher_amount),
    cod_fee: dec(p.cod_fee),
    order_processing_fee: dec(p.order_processing_fee),
    shipping_tax: dec(p.shipping_tax),
    total_amount_mp: dec(p.total_amount_mp),
    // TikTok/Tokopedia lump their escrow deductions here (top-level service_fee
    // etc are 0 for them) — captured so the compare can itemize "fee & tax" +
    // "shipping" instead of a single opaque residual. Absent for Shopee → "0".
    fee_and_tax_amount: dec(p.escrow_list?.fee_and_tax_amount),
    shipping_cost_amount: dec(p.escrow_list?.shipping_cost_amount),
  };
  const hasAny = Object.values(fields).some((v) => v !== "0");
  return hasAny ? fields : undefined;
}

@Injectable()
export class SalesOrderWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(SalesOrderWebhookHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly admin: AdminNotificationService,
    private readonly salesReturnIngest: SalesReturnIngestService,
  ) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const p = row.rawPayload as unknown as SalesOrderPayload;
    if (!p?.salesorder_id) {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_SALESORDER_ID };
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      const { stale } = await this.upsertSalesOrder(tx as unknown as PrismaService, p, row.id);
      if (stale) return null;

      const existing = await tx.jubelioSalesOrderState.findUnique({
        where: { salesorderId: p.salesorder_id },
      });
      if (existing) return existing;
      return tx.jubelioSalesOrderState.create({
        data: {
          salesorderId: p.salesorder_id,
          stockApplied: false,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: isCanceledOrder(p),
          lastWebhookEventId: row.id,
        },
      });
    });

    /*
     * A newer payload already drove this order's reserve/consume/release, so skipping the stale
     * one's side effects loses nothing.
     */
    if (txResult === null) {
      return { kind: "skipped", reason: SKIP_REASONS.STALE_PAYLOAD };
    }
    const state = txResult;

    const items = Array.isArray(p.items) ? p.items : [];
    const isCancel = isCanceledOrder(p);
    /*
     * Cancelled and returned orders are both finished: whatever they still hold RESERVED is
     * released, and the reserve branch skips them. The shipped branch below runs first, so a
     * finished order Jubelio also reports shipped is reserved if needed and consumed instead.
     */
    const isFinished = isCancel || isReturnedOrder(p);
    const shipped = reportsShipped(p);

    if (shipped) {
      // Consume wins over reserve: goods left the warehouse. A webhook can
      // arrive already-shipped before any reserve happened (marketplace
      // auto-ship / backfill) — ensure the ledger rows exist first.
      if (!state.stockApplied) {
        const { lines, unmapped } = await this.buildReservationLines(items);
        await reserveOrder(this.prisma, { salesorderId: p.salesorder_id, salesorderNo: p.salesorder_no ?? "", lines });
        if (unmapped.length > 0) {
          await this.notifyUnmappedLines(p.salesorder_id, p.salesorder_no ?? "", unmapped);
        }
      }
      await consumeOrder(this.prisma, { salesorderId: p.salesorder_id, salesorderNo: p.salesorder_no ?? "" });
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          stockApplied: true,
          appliedAt: new Date(),
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: isCancel,
        },
      });
    } else if (isFinished && state.stockApplied) {
      await releaseOrder(this.prisma, { salesorderId: p.salesorder_id });
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          stockApplied: false,
          reversedAt: new Date(),
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: isCancel,
        },
      });
    } else if (!isFinished && !state.stockApplied) {
      const { lines, unmapped } = await this.buildReservationLines(items);
      await reserveOrder(this.prisma, { salesorderId: p.salesorder_id, salesorderNo: p.salesorder_no ?? "", lines });
      if (unmapped.length > 0) {
        await this.notifyUnmappedLines(p.salesorder_id, p.salesorder_no ?? "", unmapped);
      }
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          stockApplied: true,
          appliedAt: new Date(),
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: false,
        },
      });
    } else {
      await this.prisma.jubelioSalesOrderState.update({
        where: { id: state.id },
        data: {
          lastWebhookEventId: row.id,
          lastStatus: p.channel_status ?? null,
          lastIsCanceled: isCancel,
        },
      });
    }

    // When the order is in a returned state, mirror to the SalesReturn audit
    // table. Returns ARE salesorders in Jubelio's data model (no separate
    // entity), so the salesorder webhook is the authoritative entry point for
    // creating the SalesReturn row. Idempotent — upsert keyed on salesorder_id.
    if (isReturnedOrder(p)) {
      try {
        await this.salesReturnIngest.upsertFromApiDetail(p as unknown as JubelioSalesOrderDetail);
      } catch (err) {
        this.logger.warn(
          `SalesReturn ingest failed for salesorder ${p.salesorder_id}: ${(err as Error).message}`,
        );
      }
    }

    return { kind: "processed" };
  }

  private async upsertSalesOrder(
    tx: PrismaService,
    p: SalesOrderPayload,
    webhookEventId: string,
  ): Promise<{ stale: boolean }> {
    /*
     * Locking read: serialises two concurrent handles of one order and, under REPEATABLE READ,
     * returns the latest COMMITTED row, so the second compares against what the first committed.
     */
    const locked = await tx.$queryRaw<Array<{ lastModifiedJubelio: Date | null }>>`
      SELECT \`lastModifiedJubelio\` FROM \`SalesOrder\` WHERE \`salesorderId\` = ${p.salesorder_id} FOR UPDATE`;
    if (isStalePayload(parseDate(p.last_modified), locked[0]?.lastModifiedJubelio ?? null)) {
      return { stale: true };
    }

    const { channel, unknown } = detectChannel(p.source_name, p.salesorder_no);
    if (unknown) {
      this.logger.warn(`Unknown source_name "${p.source_name ?? ""}" mapped to OTHER (salesorder ${p.salesorder_id})`);
    }

    const status = deriveStatus({
      is_canceled: p.is_canceled,
      internal_status: p.internal_status,
      marked_as_complete: p.marked_as_complete,
      completed_date: p.completed_date,
      wms_status: p.wms_status,
      is_shipped: p.is_shipped,
    });

    const txDate = parseDate(p.transaction_date) ?? parseDate(p.created_date);
    let transactionDate: Date;
    if (!txDate) {
      this.logger.warn(`Salesorder ${p.salesorder_id} missing transaction_date and created_date — falling back to now()`);
      transactionDate = new Date();
    } else {
      transactionDate = txDate;
    }

    const baseFields = {
      salesorderNo: p.salesorder_no ?? "",
      channelOrderNo: p.ref_no ?? null,
      channel,
      sourceName: p.source_name ?? "",
      status,
      channelStatus: p.channel_status ?? null,
      internalStatus: p.internal_status ?? null,
      wmsStatus: p.wms_status ?? null,
      isCanceled: !!p.is_canceled,
      isPaid: !!p.is_paid,
      markedAsComplete: !!p.marked_as_complete,
      customerName: p.customer_name ?? null,
      customerPhone: p.customer_phone ?? null,
      customerEmail: p.customer_email ?? null,
      shippingProvince: p.shipping_province ?? null,
      shippingCity: p.shipping_city ?? null,
      shippingAddress: buildShippingAddress(p),
      subTotal: dec(p.sub_total),
      totalDisc: dec(p.total_disc),
      totalTax: dec(p.total_tax),
      shippingCost: dec(p.shipping_cost),
      grandTotal: dec(p.grand_total),
      feeBreakdown: buildFeeBreakdown(p),
      paymentMethod: p.payment_method ?? null,
      paymentDate: parseDate(p.payment_date),
      transactionDate,
      createdDateJubelio: parseDate(p.created_date),
      completedDate: parseDate(p.completed_date),
      cancelDate: parseDate(p.internal_cancel_date),
      lastModifiedJubelio: parseDate(p.last_modified),
      lastWebhookEventId: webhookEventId,
    };

    /**
     * Webhooks are processed concurrently and out of order; a payload with no resi (or a blank
     * one) must never wipe an already-stored trackingNumber/courier. On create there is nothing
     * stored yet, so blank -> null as before. On update, a blank value is simply omitted from the
     * write so the stored value survives; a non-empty value always replaces it (a re-booked AWB
     * wins).
     */
    const trackingNumberValue = nonBlank(p.tracking_number);
    const courierValue = nonBlank(p.courier);

    const jubelioReportsShipped = reportsShipped(p);

    // For new rows: if Jubelio already reports shipped (backfill of an
    // already-shipped order), seed fulfillmentStatus on create.
    const createShippedPatch = jubelioReportsShipped
      ? {
          fulfillmentStatus: "SHIPPED" as const,
          shippedAt: parseDate(p.completed_date) ?? parseDate(p.last_modified) ?? new Date(),
        }
      : {};

    const order = await tx.salesOrder.upsert({
      where: { salesorderId: p.salesorder_id },
      create: {
        salesorderId: p.salesorder_id,
        ...baseFields,
        trackingNumber: trackingNumberValue,
        courier: courierValue,
        ...createShippedPatch,
      },
      update: {
        ...baseFields,
        ...(trackingNumberValue !== null ? { trackingNumber: trackingNumberValue } : {}),
        ...(courierValue !== null ? { courier: courierValue } : {}),
      },
    });

    // Forward-only fulfillmentStatus sync: when Jubelio reports the order shipped
    // (e.g. operator marked shipped in Jubelio admin UI bypassing the Elorae Ship
    // button, or marketplace auto-ship), advance fulfillmentStatus → SHIPPED. The
    // `where` guard prevents overwriting an existing SHIPPED audit (web's Ship
    // button already stamped shippedById/shippedAt). Idempotent on re-receive.
    if (jubelioReportsShipped) {
      await tx.salesOrder.updateMany({
        where: { id: order.id, fulfillmentStatus: { not: "SHIPPED" } },
        data: {
          fulfillmentStatus: "SHIPPED",
          shippedAt: parseDate(p.completed_date) ?? parseDate(p.last_modified) ?? new Date(),
        },
      });
    }

    /**
     * `SalesOrderItem.cogs` is stamped only by `consumeOrder`, on the RESERVED → CONSUMED flip, and
     * never again. The delete-and-recreate below would otherwise null it on every later handle of a
     * shipped order (a post-ship webhook, a settlement resync), so each line's cost is read BEFORE
     * the delete and carried across by `salesorderDetailId`. A detail id with no stored cost (a new
     * line, or one never consumed) is recreated without one, exactly as before.
     */
    const existingItems = await tx.salesOrderItem.findMany({
      where: { salesOrderId: order.id },
      select: { salesorderDetailId: true, cogs: true },
    });
    const cogsByDetailId = new Map<number, NonNullable<(typeof existingItems)[number]["cogs"]>>();
    for (const existing of existingItems) {
      if (existing.cogs !== null) cogsByDetailId.set(existing.salesorderDetailId, existing.cogs);
    }

    const items = Array.isArray(p.items) ? p.items : [];
    const lines = [];
    for (const line of items) {
      const mapping = await resolveItemMapping(tx, line.item_id);
      const cogs = cogsByDetailId.get(line.salesorder_detail_id);
      lines.push({
        salesOrderId: order.id,
        salesorderDetailId: line.salesorder_detail_id,
        jubelioItemId: line.item_id,
        jubelioItemCode: line.item_code,
        itemId: mapping?.itemId ?? null,
        productName: line.item_name ?? line.item_code,
        qty: dec(line.qty),
        qtyInBase: dec(line.qty_in_base ?? line.qty),
        returnedQty: "0",
        isCanceledItem: !!line.is_canceled_item,
        unitPrice: dec(line.sell_price),
        pricePaid: dec(line.price),
        discAmount: dec(line.disc_amount),
        taxAmount: dec(line.tax_amount),
        lineTotal: dec(line.amount),
        discMarketplace: dec(line.disc_marketplace ?? line.discount_marketplace),
        weightInGram: dec(line.weight_in_gram),
        ...(cogs !== undefined ? { cogs } : {}),
      });
    }

    await tx.salesOrderItem.deleteMany({ where: { salesOrderId: order.id } });
    if (lines.length > 0) {
      await tx.salesOrderItem.createMany({ data: lines });
    }
    return { stale: false };
  }

  private async buildReservationLines(
    items: SalesOrderLine[],
  ): Promise<{ lines: ReservationLine[]; unmapped: UnmappedLine[] }> {
    const lines: ReservationLine[] = [];
    const unmapped: UnmappedLine[] = [];

    for (const line of items) {
      if (line.is_canceled_item) continue;

      const mapping = await resolveItemMapping(this.prisma, line.item_id);
      if (!mapping) {
        unmapped.push({ item_code: line.item_code, item_id: line.item_id, qty: line.qty });
        continue;
      }

      lines.push({
        salesorderDetailId: line.salesorder_detail_id,
        itemId: mapping.itemId,
        variantSku: mapping.erpVariantSku,
        qty: Number(line.qty),
      });
    }
    return { lines, unmapped };
  }

  private async notifyUnmappedLines(
    salesorderId: number,
    salesorderNo: string,
    lines: UnmappedLine[],
  ): Promise<void> {
    await this.admin.write({
      category: "JUBELIO_UNMAPPED_LINES",
      severity: "WARN",
      title: `Salesorder ${salesorderNo || salesorderId}: ${lines.length} unmapped line(s)`,
      message: `Lines without JubelioProductMapping. Stock NOT reserved for these.`,
      metadata: { salesorderId, lines },
    });
  }
}
