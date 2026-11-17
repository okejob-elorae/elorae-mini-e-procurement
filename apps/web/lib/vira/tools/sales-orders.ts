import { z } from "zod";
import { SALES_CHANNEL_VALUES, SALES_ORDER_STATUS_VALUES } from "@/lib/constants/enums";
import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { getSalesOrderById, listSalesOrders } from "@/lib/sales-orders/queries";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

/* ── Personal data rule (decision D6) ──────────────────────────────────────────────────────── */

const PII_KEY = /phone|email|address/i;

/** Returns a copy without customerPhone, customerEmail, shippingAddress (street lines)
 *  and any other key whose name contains "phone", "email" or "address".
 *  City, province and postal code may stay if they are separate fields.
 *  Applied at every depth, so a nested address object or a phone inside a sub-record goes too. */
export function stripBuyerPii<T>(order: T): T {
  return strip(order) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (PII_KEY.test(key)) continue;
    out[key] = strip(v);
  }
  return out;
}

/* ── Inputs ────────────────────────────────────────────────────────────────────────────────── */

const CHANNELS = SALES_CHANNEL_VALUES as unknown as [SalesChannel, ...SalesChannel[]];
const STATUSES = SALES_ORDER_STATUS_VALUES as unknown as [SalesOrderStatus, ...SalesOrderStatus[]];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const listShape = {
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Text to match against the order number, customer name or tracking number."),
  status: z.enum(STATUSES).optional().describe("Only orders in this status."),
  channel: z.enum(CHANNELS).optional().describe("Only orders from this marketplace channel."),
  dateFrom: z.string().regex(YMD).optional().describe("Earliest order date, YYYY-MM-DD (WIB)."),
  dateTo: z.string().regex(YMD).optional().describe("Latest order date, YYYY-MM-DD (WIB), inclusive."),
  ...listInputShape,
};

const detailShape = {
  id: z.string().trim().min(1).max(100).optional().describe("The order's id. Give this or salesorderNo, not both."),
  salesorderNo: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("The marketplace order number (exact). Give this or id, not both."),
};

const EXACTLY_ONE = "Give exactly one of id or salesorderNo.";

/** The detail input with the exactly-one-of rule (a raw `inputShape` cannot carry it; the handler re-checks). */
export const getMarketplaceOrderInput = z
  .object(detailShape)
  .refine((v) => (v.id === undefined) !== (v.salesorderNo === undefined), { message: EXACTLY_ONE });

/** Same parsing as the sales-orders page: start-of-day / inclusive end-of-day, anchored to WIB. */
function dateRange(dateFrom?: string, dateTo?: string): { dateFrom?: Date; dateTo?: Date } {
  if (dateFrom && dateTo && dateFrom > dateTo) throw new ViraInputError("dateFrom must not be after dateTo");
  const from = dateFrom ? parseDateOnly(dateFrom) : undefined;
  if (dateFrom && !from) throw new ViraInputError("dateFrom is not a valid date");
  const to = dateTo ? parseDateOnlyEnd(dateTo) : undefined;
  if (dateTo && !to) throw new ViraInputError("dateTo is not a valid date");
  return { dateFrom: from, dateTo: to };
}

const money = (v: string | number | null | undefined): number => Number(v ?? 0);

/* ── Tools ─────────────────────────────────────────────────────────────────────────────────── */

export const tools: ViraTool[] = [
  defineTool({
    name: "list_marketplace_orders",
    title: "Marketplace orders",
    description:
      "Lists marketplace orders synced from Jubelio (Shopee, Tokopedia, TikTok, etc.). Search by order number, customer name or tracking number; filter by status, channel and date.",
    gate: { kind: "code", code: "sales_orders:view" },
    inputShape: listShape,
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const range = dateRange(input.dateFrom, input.dateTo);
      const { orders, totalCount } = await listSalesOrders(
        { search: input.search, status: input.status, channel: input.channel, ...range },
        { page: offset / limit + 1, pageSize: limit },
      );
      const items = orders.map((raw) => {
        const o = stripBuyerPii(raw);
        return {
          id: o.id,
          salesorderNo: o.salesorderNo,
          channel: o.channel,
          status: o.status,
          customerName: o.customerName,
          total: money(o.grandTotal),
          orderDate: o.transactionDate,
          url: recordUrl(ctx.baseUrl, `/backoffice/sales-orders/${o.id}`),
        };
      });
      return toPage(items, totalCount, offset, limit);
    },
  }),
  defineTool({
    name: "get_marketplace_order",
    title: "Marketplace order detail",
    description:
      "Shows one marketplace order: status, fulfilment, courier, tracking number and order lines. Give id or salesorderNo.",
    gate: { kind: "code", code: "sales_orders:view" },
    inputShape: detailShape,
    handler: async (raw, ctx) => {
      const parsed = getMarketplaceOrderInput.safeParse(raw);
      if (!parsed.success) throw new ViraInputError(parsed.error.issues[0]?.message ?? EXACTLY_ONE);
      let id = parsed.data.id;
      if (id === undefined) {
        const no = parsed.data.salesorderNo!;
        const { orders } = await listSalesOrders({ search: no }, { page: 1, pageSize: 50 });
        const hit = orders.filter((o) => o.salesorderNo === no);
        if (hit.length !== 1) throw new ViraNotFoundError("Order not found");
        id = hit[0].id;
      }
      const found = await getSalesOrderById(id);
      if (!found) throw new ViraNotFoundError("Order not found");
      const o = stripBuyerPii(found.order);
      const items = stripBuyerPii(found.items);
      return {
        id: o.id,
        salesorderNo: o.salesorderNo,
        channel: o.channel,
        status: o.status,
        fulfilmentStatus: o.fulfillmentStatus,
        orderDate: o.transactionDate,
        customerName: o.customerName,
        shippingCity: o.shippingCity,
        shippingProvince: o.shippingProvince,
        courier: o.courierName ?? o.courier,
        trackingNo: o.trackingNumber,
        lines: items.map((it) => ({
          sku: it.jubelioItemCode,
          name: it.productName,
          qty: Number(it.qty),
          price: money(it.unitPrice),
          subtotal: money(it.lineTotal),
        })),
        total: money(o.grandTotal),
        url: recordUrl(ctx.baseUrl, `/backoffice/sales-orders/${o.id}`),
      };
    },
  }),
];

export const parityCases: ParityCase[] = [
  { tool: "list_marketplace_orders", kind: "route", path: "/backoffice/sales-orders" },
  { tool: "get_marketplace_order", kind: "route", path: "/backoffice/sales-orders" },
];
