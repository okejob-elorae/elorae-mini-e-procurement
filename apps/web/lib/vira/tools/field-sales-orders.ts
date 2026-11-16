import { z } from "zod";
import {
  getFieldSalesOrderById,
  listFieldSalesOrders,
  type DeliveryStatusFilter,
  type FieldSalesOrderListItem,
  type FieldSalesOrderStatusFilter,
} from "@/lib/field-sales/queries";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

/** The values app/backoffice/field-sales-orders/page.tsx accepts (STATUS_VALUES / DELIVERY_STATUS_VALUES). */
export const ORDER_STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "AKTIF"] as const satisfies readonly FieldSalesOrderStatusFilter[];
export const ORDER_TYPES = ["PUTUS", "KONSI"] as const;
export const DELIVERY_STATUSES = ["OPEN", "PENDING", "PARTIAL", "DELIVERED", "CLOSED"] as const satisfies readonly DeliveryStatusFilter[];

const listShape = {
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Text to match against the order number or store name."),
  status: z
    .enum(ORDER_STATUSES)
    .optional()
    .describe("Approval status. AKTIF = pending or approved; CANCELLED = cancelled by the salesman. Omit for all."),
  orderType: z.enum(ORDER_TYPES).optional().describe("PUTUS = outright sale, KONSI = consignment."),
  storeId: z.string().trim().min(1).max(100).optional().describe("Only orders for this store id."),
  deliveryStatus: z
    .enum(DELIVERY_STATUSES)
    .optional()
    .describe("Delivery status of approved orders. OPEN = pending or partial."),
  ...listInputShape,
};

const detailShape = {
  id: z.string().trim().min(1).max(100).optional().describe("The order's id. Give this or docNo, not both."),
  docNo: z.string().trim().min(1).max(100).optional().describe("The order number (exact). Give this or id, not both."),
};

const EXACTLY_ONE = "Give exactly one of id or docNo.";

/** The detail input with the exactly-one-of rule (a raw `inputShape` cannot carry it; the handler re-checks). */
export const getFieldSalesOrderInput = z
  .object(detailShape)
  .refine((v) => (v.id === undefined) !== (v.docNo === undefined), { message: EXACTLY_ONE });

/** Store and salesman: the source carries their names only, so ids are added only when known. */
function header(o: FieldSalesOrderListItem, storeId?: string) {
  return {
    id: o.id,
    docNo: o.orderNo,
    orderType: o.orderType,
    status: o.status,
    deliveryStatus: o.deliveryStatus,
    store: { id: storeId, name: o.storeName },
    salesman: { name: o.salesmanName },
  };
}

export const tools: ViraTool[] = [
  defineTool({
    name: "list_field_sales_orders",
    title: "Salesman orders",
    description:
      "Lists orders taken by field salesmen, both outright sales (putus) and consignment (konsi), with approval and delivery status. Filter by status, order type, store or delivery status.",
    gate: { kind: "code", code: "field_sales_orders:view" },
    inputShape: listShape,
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const { orders, totalCount } = await listFieldSalesOrders(
        {
          search: input.search,
          // As the page does: a delivery state only exists on an approved order, so it pins the status.
          status: input.deliveryStatus ? "APPROVED" : input.status,
          orderType: input.orderType,
          storeId: input.storeId,
          deliveryStatus: input.deliveryStatus,
        },
        { page: offset / limit + 1, pageSize: limit },
      );
      const items = orders.map((o) => ({
        ...header(o, input.storeId),
        total: o.total,
        orderDate: o.createdAt,
        url: recordUrl(ctx.baseUrl, `/backoffice/field-sales-orders/${o.id}`),
      }));
      return toPage(items, totalCount, offset, limit);
    },
  }),
  defineTool({
    name: "get_field_sales_order",
    title: "Salesman order detail",
    description: "Shows one salesman order with its lines and deliveries. Give id or docNo.",
    gate: { kind: "code", code: "field_sales_orders:view" },
    inputShape: detailShape,
    handler: async (raw, ctx) => {
      const parsed = getFieldSalesOrderInput.safeParse(raw);
      if (!parsed.success) throw new ViraInputError(parsed.error.issues[0]?.message ?? EXACTLY_ONE);
      let id = parsed.data.id;
      if (id === undefined) {
        const no = parsed.data.docNo!;
        const { orders } = await listFieldSalesOrders({ search: no }, { page: 1, pageSize: 50 });
        const hit = orders.filter((o) => o.orderNo === no);
        if (hit.length !== 1) throw new ViraNotFoundError("Order not found");
        id = hit[0].id;
      }
      const o = await getFieldSalesOrderById(id);
      if (!o) throw new ViraNotFoundError("Order not found");
      return {
        ...header(o),
        orderDate: o.createdAt,
        // Order lines carry the variant SKU (empty for an item without variants), not the item SKU.
        lines: o.lines.map((l) => ({
          sku: l.variantSku,
          name: l.productName,
          qty: l.qty,
          price: l.unitPrice,
          subtotal: l.lineTotal,
        })),
        // Delivery notes only: no proof-of-delivery photo, receiver, GPS, signature or line detail.
        deliveries: o.deliveries.map((d) => ({ id: d.id, docNo: d.docNo, date: d.deliveredAt })),
        total: o.total,
        url: recordUrl(ctx.baseUrl, `/backoffice/field-sales-orders/${o.id}`),
      };
    },
  }),
];

export const parityCases: ParityCase[] = [
  { tool: "list_field_sales_orders", kind: "route", path: "/backoffice/field-sales-orders" },
  { tool: "get_field_sales_order", kind: "route", path: "/backoffice/field-sales-orders" },
];
