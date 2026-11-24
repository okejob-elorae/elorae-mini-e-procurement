import { z } from "zod";
import { prisma } from "@elorae/db";
import {
  getFieldSalesOrderById,
  listFieldSalesOrders,
  type DeliveryStatusFilter,
  type FieldSalesOrderDetail,
  type FieldSalesOrderListItem,
  type FieldSalesOrderStatusFilter,
} from "@/lib/field-sales/queries";
import {
  CreditLimitExceededError,
  InsufficientStockError,
  InvalidFinalPriceError,
  InvalidOrderTransitionError,
} from "@/lib/field-sales/errors";
import { KreditBelumDiperiksaError } from "@/lib/field-sales/kredit-pesanan";
import { approveFieldSalesOrder, rejectFieldSalesOrder } from "@/lib/field-sales/writer";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { masukLewatJatuhTempo, nilaiLewatJatuhTempo } from "@/lib/receivables/jatuh-tempo";
import { daftarPiutang } from "@/lib/receivables/queries";
import { computeStoreCreditExposure } from "@/lib/finance/ar/credit-exposure";
import { batasKreditBerlaku, lewatBatasNilai } from "@/lib/salesman/kredit";
import { bacaAturanKreditDb } from "@/lib/salesman/tagihan-toko";
import { ViraInputError, ViraNotFoundError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import {
  defineTool,
  defineWriteTool,
  type ParityCase,
  type ViraExecuteResult,
  type ViraTool,
  type ViraToolContext,
  type ViraWriteTool,
} from "./types";

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

/**
 * Exact `orderNo` via unique column (not list contains-search — short doc nos can be
 * crowded out of pageSize 50 by newer substring hits). Shared by get + write resolve.
 */
async function lookupByExactDocNo(docNo: string): Promise<FieldSalesOrderDetail | null> {
  const row = await prisma.fieldSalesOrder.findUnique({
    where: { orderNo: docNo },
    select: { id: true },
  });
  if (!row) return null;
  return getFieldSalesOrderById(row.id);
}

/** Resolve a write-tool `order` input: try id, then exact `orderNo`. */
async function resolveOrderForWrite(order: string): Promise<FieldSalesOrderDetail> {
  const byId = await getFieldSalesOrderById(order);
  if (byId) return byId;
  const detail = await lookupByExactDocNo(order);
  if (!detail) throw new ViraNotFoundError("Pesanan tidak ditemukan");
  return detail;
}

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

/**
 * Mirrors the UI: a KONSI order has no finalised retail price until it is approved (the writer keeps
 * the total at 0), so the list shows "—" and the detail hides every money column. Money is null then.
 */
function showMoney(o: { orderType: string; status: string }): boolean {
  return o.orderType !== "KONSI" || o.status === "APPROVED";
}

function formatRp(n: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
}

/**
 * Credit preview numbers as on
 * `app/backoffice/field-sales-orders/[id]/page.tsx` lines 105–135
 * (`computeStoreCreditExposure`, `batasKreditBerlaku`, `bacaAturanKreditDb`, `lewatBatasNilai`).
 * `muatPanelKredit` uses a different shape, so we mirror the page formula here.
 */
/** Shared with get_field_sales_order_credit — same formula as the order detail page. */
export async function creditCheckForApprove(
  order: FieldSalesOrderDetail,
): Promise<{ exposure: number; limit: number; overLimit: boolean } | null> {
  const orderRow = await prisma.fieldSalesOrder.findUnique({
    where: { id: order.id },
    select: { storeId: true },
  });
  if (!orderRow) return null;
  const store = await prisma.store.findUnique({
    where: { id: orderRow.storeId },
    select: { creditLimit: true, noCreditLimit: true },
  });
  const batas = store
    ? batasKreditBerlaku(
        {
          creditLimit: store.creditLimit === null ? null : Number(store.creditLimit),
          noCreditLimit: store.noCreditLimit,
          termsType: order.orderType,
        },
        await bacaAturanKreditDb(),
      ).nilai
    : null;
  if (
    !batas ||
    batas.nilai === null ||
    (batas.sumber !== "TOKO" && batas.sumber !== "BAWAAN")
  ) {
    return null;
  }
  const exposure = await computeStoreCreditExposure(prisma, orderRow.storeId);
  const orderTotal = order.orderType === "PUTUS" ? order.total : 0;
  return {
    exposure: exposure.total,
    limit: batas.nilai,
    overLimit: lewatBatasNilai(exposure.total + orderTotal, batas.nilai),
  };
}

function mustBePending(order: FieldSalesOrderDetail, verb: "disetujui" | "ditolak"): void {
  if (order.status !== "PENDING_APPROVAL") {
    throw new ViraInputError(
      `Pesanan ${order.orderNo} berstatus ${order.status}, tidak bisa ${verb}.`,
    );
  }
}

type ApproveArgs = { orderId: string };
type RejectArgs = { orderId: string; reason: string };

const orderInput = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("The order id or document number.");

/**
 * Mirrors `approveFieldSalesOrderAction` in `app/actions/field-sales-orders.ts`
 * (guard + writer call ~L81–151) and `approveFieldSalesOrder` in
 * `lib/field-sales/writer.ts` (~L719+). Decision E12: no price/line/credit override.
 */
const approveFieldSalesOrderTool = defineWriteTool({
  kind: "write",
  name: "approve_field_sales_order",
  title: "Approve salesman order",
  description:
    "Prepares approval of a salesman order (putus or konsi) exactly as submitted: no price changes, no added lines, no credit override. The user must press the confirm button. If the store is over its credit limit, approval is refused and the user must open the order in Elorae.",
  gate: { kind: "code", code: "field_sales_orders:approve" },
  destructive: false,
  inputShape: { order: orderInput },
  argsSchema: z.object({ orderId: z.string().min(1) }),
  __sampleInput: { order: "SO-1" },
  prepare: async (input, ctx) => {
    const order = await resolveOrderForWrite(input.order);
    mustBePending(order, "disetujui");
    const url = recordUrl(ctx.baseUrl, `/backoffice/field-sales-orders/${order.id}`);
    // E12: this tool never supplies finalPrices; appealed lines must be priced in Elorae.
    if (order.lines.some((l) => l.requestedUnitPrice != null)) {
      throw new ViraInputError(
        `Pesanan punya ajuan harga. Buka pesanan di Elorae untuk menetapkan harga final: ${url}`,
      );
    }
    // TAHAN / overdue-bill hold (`kreditDitahan`) needs the UI checkbox — not `creditHoldAtCreate`.
    const holdRow = await prisma.fieldSalesOrder.findUnique({
      where: { id: order.id },
      select: { kreditDitahan: true },
    });
    if (holdRow?.kreditDitahan) {
      throw new ViraInputError(
        `Kredit pesanan ditahan. Buka pesanan di Elorae untuk memeriksa dan menyetujui: ${url}`,
      );
    }
    // Page try/catch (~L115–142): transient exposure/settings failure → null, not INTERNAL.
    let credit: Awaited<ReturnType<typeof creditCheckForApprove>> = null;
    try {
      credit = await creditCheckForApprove(order);
    } catch (error) {
      console.error("[vira] field-sales-order credit preview failed", {
        orderId: order.id,
        error,
      });
    }
    if (credit?.overLimit) {
      throw new ViraInputError(
        `Toko melewati batas kredit. Buka pesanan di Elorae untuk persetujuan dengan alasan: ${url}`,
      );
    }
    const totalLabel = showMoney(order) ? formatRp(order.total) : "—";
    return {
      preview: {
        title: `Setujui pesanan ${order.orderNo}`,
        summary: `${order.storeName} · ${order.orderType} · total ${totalLabel}`,
        details: [
          { label: "Toko", value: order.storeName },
          { label: "Salesman", value: order.salesmanName },
          { label: "Jenis", value: order.orderType },
          { label: "Jumlah baris", value: String(order.lines.length) },
          { label: "Total", value: totalLabel },
          {
            label: "Eksposur kredit",
            value: credit ? formatRp(credit.exposure) : "—",
          },
          {
            label: "Batas kredit",
            value: credit ? formatRp(credit.limit) : "—",
          },
          {
            label: "Status kredit",
            value: credit ? (credit.overLimit ? "Melebihi batas" : "Aman") : "—",
          },
        ],
        confirmLabel: "Setujui",
        cancelLabel: "Batal",
        destructive: false,
        target: { type: "field_sales_order", id: order.id, url },
      },
      args: { orderId: order.id },
    };
  },
  execute: async (args, ctx) => mapApproveExecute(args, ctx),
  revalidate: (args) => [
    "/backoffice/field-sales-orders",
    `/backoffice/field-sales-orders/${args.orderId}`,
  ],
});

/**
 * Mirrors `rejectFieldSalesOrderAction` in `app/actions/field-sales-orders.ts`
 * (~L275–290) and `rejectFieldSalesOrder` in `lib/field-sales/writer.ts` (~L1106+).
 */
const rejectFieldSalesOrderTool = defineWriteTool({
  kind: "write",
  name: "reject_field_sales_order",
  title: "Reject salesman order",
  description:
    "Prepares rejection of a pending salesman order with a reason the salesman will see. The user must press the confirm button.",
  gate: { kind: "code", code: "field_sales_orders:approve" },
  destructive: true,
  inputShape: {
    order: orderInput,
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Why the order is rejected. The salesman sees this."),
  },
  argsSchema: z.object({
    orderId: z.string().min(1),
    reason: z.string().trim().min(1).max(500),
  }),
  __sampleInput: { order: "SO-1", reason: "x" },
  prepare: async (input, ctx) => {
    const order = await resolveOrderForWrite(input.order);
    mustBePending(order, "ditolak");
    const url = recordUrl(ctx.baseUrl, `/backoffice/field-sales-orders/${order.id}`);
    const totalLabel = showMoney(order) ? formatRp(order.total) : "—";
    return {
      preview: {
        title: `Tolak pesanan ${order.orderNo}`,
        summary: `${order.storeName} · ${order.orderType} · total ${totalLabel}`,
        details: [
          { label: "Toko", value: order.storeName },
          { label: "Salesman", value: order.salesmanName },
          { label: "Total", value: totalLabel },
          { label: "Alasan", value: input.reason },
        ],
        confirmLabel: "Tolak",
        cancelLabel: "Batal",
        destructive: true,
        target: { type: "field_sales_order", id: order.id, url },
      },
      args: { orderId: order.id, reason: input.reason },
    };
  },
  execute: async (args, ctx) => mapRejectExecute(args, ctx),
  revalidate: (args) => [
    "/backoffice/field-sales-orders",
    `/backoffice/field-sales-orders/${args.orderId}`,
  ],
});

async function mapApproveExecute(
  args: ApproveArgs,
  ctx: ViraToolContext,
): Promise<ViraExecuteResult> {
  const url = recordUrl(ctx.baseUrl, `/backoffice/field-sales-orders/${args.orderId}`);
  try {
    // Omit `kreditDiperiksa`: prepare already refuses `kreditDitahan`; leaving the flag
    // unset keeps the writer's KreditBelumDiperiksaError as last line of defense.
    await approveFieldSalesOrder({
      orderId: args.orderId,
      approvedById: ctx.actor.id,
    });
  } catch (e) {
    if (e instanceof CreditLimitExceededError) {
      return { ok: false, code: "CREDIT_LIMIT_EXCEEDED", message: "Toko melewati batas kredit.", url };
    }
    if (e instanceof KreditBelumDiperiksaError) {
      return {
        ok: false,
        code: "KREDIT_BELUM_DIPERIKSA",
        message: "Kredit pesanan belum diperiksa.",
        url,
      };
    }
    if (e instanceof InsufficientStockError) {
      const skus = e.shortLines.map((l) => l.variantSku || l.itemId).join(", ");
      return {
        ok: false,
        code: "INSUFFICIENT_STOCK",
        message: `Stok kurang: ${skus}`,
        url,
      };
    }
    if (e instanceof InvalidFinalPriceError) {
      return {
        ok: false,
        code: "INVALID_FINAL_PRICE",
        message: "Harga final tidak sah.",
        url,
      };
    }
    if (e instanceof InvalidOrderTransitionError) {
      return {
        ok: false,
        code: e.from === "MISSING" ? "NOT_FOUND" : "INVALID_TRANSITION",
        message:
          e.from === "MISSING"
            ? "Pesanan tidak ditemukan."
            : "Status pesanan tidak memungkinkan persetujuan.",
        url,
      };
    }
    throw e;
  }
  const order = await getFieldSalesOrderById(args.orderId);
  const docNo = order?.orderNo ?? args.orderId;
  return {
    ok: true,
    message: `Pesanan ${docNo} disetujui.`,
    url,
    entityType: "FieldSalesOrder",
    entityId: args.orderId,
  };
}

async function mapRejectExecute(
  args: RejectArgs,
  ctx: ViraToolContext,
): Promise<ViraExecuteResult> {
  const url = recordUrl(ctx.baseUrl, `/backoffice/field-sales-orders/${args.orderId}`);
  try {
    await rejectFieldSalesOrder({
      orderId: args.orderId,
      rejectedById: ctx.actor.id,
      reason: args.reason,
    });
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return {
        ok: false,
        code: e.from === "MISSING" ? "NOT_FOUND" : "INVALID_TRANSITION",
        message:
          e.from === "MISSING"
            ? "Pesanan tidak ditemukan."
            : "Status pesanan tidak memungkinkan penolakan.",
        url,
      };
    }
    throw e;
  }
  const order = await getFieldSalesOrderById(args.orderId);
  const docNo = order?.orderNo ?? args.orderId;
  return {
    ok: true,
    message: `Pesanan ${docNo} ditolak.`,
    url,
    entityType: "FieldSalesOrder",
    entityId: args.orderId,
  };
}

const creditTool = defineTool({
  name: "get_field_sales_order_credit",
  title: "Salesman order credit check",
  description:
    "Credit picture for one field-sales order: store limit, current exposure, order total, overLimit, kreditDitahan, overdue receivables, and bermasalah with reasons. A null value means it could not be read or this user may not see it (listed in unknown): never report null or unknown as no problem; say it cannot be confirmed. Give id or docNo (orderNo).",
  gate: { kind: "code", code: "field_sales_orders:view" },
  inputShape: detailShape,
  handler: async (raw, ctx) => {
    const parsed = getFieldSalesOrderInput.safeParse(raw);
    if (!parsed.success) throw new ViraInputError(parsed.error.issues[0]?.message ?? EXACTLY_ONE);
    let order: FieldSalesOrderDetail | null = null;
    if (parsed.data.id !== undefined) {
      order = await getFieldSalesOrderById(parsed.data.id);
    } else {
      order = await lookupByExactDocNo(parsed.data.docNo!);
    }
    if (!order) throw new ViraNotFoundError("Order not found");

    const row = await prisma.fieldSalesOrder.findUnique({
      where: { id: order.id },
      select: {
        storeId: true,
        kreditDitahan: true,
        total: true,
        orderType: true,
        store: { select: { creditLimit: true, noCreditLimit: true, name: true, code: true } },
      },
    });
    if (!row) throw new ViraNotFoundError("Order not found");

    // Same visibility as the order page: the limit preview is for approvers of a pending order;
    // the store's bills show on a PUTUS order, or to anyone who may read receivables.
    const maySeeLimit =
      order.status === "PENDING_APPROVAL" &&
      hasPermission(ctx.actor.permissions, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
    const maySeeBills = order.orderType === "PUTUS" || bolehMembacaPiutang(ctx.actor.permissions);

    let credit: Awaited<ReturnType<typeof creditCheckForApprove>> = null;
    let limitKnown = maySeeLimit;
    if (maySeeLimit) {
      try {
        credit = await creditCheckForApprove(order);
      } catch (error) {
        limitKnown = false;
        console.error("[vira] field-sales-order credit check failed", { orderId: order.id, error });
      }
    }

    // Same "lewat jatuh tempo" as list_receivables / piutang (P46): not a raw
    // dueDate < today. Klaim and in-tolerance bills stay out; tertahan free share counts.
    let overdueRows: Awaited<ReturnType<typeof daftarPiutang>> | null = null;
    let billsKnown = maySeeBills;
    if (maySeeBills) {
      try {
        overdueRows = (await daftarPiutang({ storeId: row.storeId })).filter(masukLewatJatuhTempo);
      } catch (error) {
        billsKnown = false;
        console.error("[vira] field-sales-order overdue bills failed", { orderId: order.id, error });
      }
    }
    const orderTotal = showMoney(order) ? Number(order.total) : null;
    // No credit row means the store has no limit to exceed.
    const overLimit = limitKnown ? (credit?.overLimit ?? false) : null;
    const kreditDitahan = row.kreditDitahan;
    const hasOverdue = !billsKnown || overdueRows === null ? null : overdueRows.length > 0;
    const unknown: string[] = [];
    if (overLimit === null) unknown.push("over_credit_limit");
    if (hasOverdue === null) unknown.push("overdue_receivables");
    const reasons: string[] = [];
    if (overLimit) reasons.push("over_credit_limit");
    if (kreditDitahan) reasons.push("kredit_ditahan");
    if (hasOverdue) reasons.push("overdue_receivables");

    return {
      id: order.id,
      docNo: order.orderNo,
      orderType: order.orderType,
      store: {
        code: row.store.code,
        name: row.store.name,
        creditLimit:
          !maySeeLimit || row.store.creditLimit === null ? null : Number(row.store.creditLimit),
        noCreditLimit: maySeeLimit ? row.store.noCreditLimit : null,
      },
      exposure: credit?.exposure ?? null,
      limit: credit?.limit ?? null,
      orderTotal,
      overLimit,
      kreditDitahan,
      overdueReceivables: overdueRows && {
        count: overdueRows.length,
        total: overdueRows.reduce((s, r) => s + (nilaiLewatJatuhTempo(r) ?? 0), 0),
        // BarisPiutang.dueDate is already an ISO string.
        oldestDueDate:
          [...overdueRows].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate ?? null,
      },
      // A word, not null: the model read null as "no problem".
      bermasalah: reasons.length > 0 ? true : unknown.length > 0 ? "unknown" : false,
      reasons,
      unknown,
      url: recordUrl(ctx.baseUrl, `/backoffice/field-sales-orders/${order.id}`),
    };
  },
});

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
        total: showMoney(o) ? o.total : null,
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
        const found = await lookupByExactDocNo(no);
        if (!found) throw new ViraNotFoundError("Order not found");
        id = found.id;
      }
      const o = await getFieldSalesOrderById(id);
      if (!o) throw new ViraNotFoundError("Order not found");
      const money = showMoney(o);
      return {
        ...header(o),
        orderDate: o.createdAt,
        // Order lines carry the variant SKU (empty for an item without variants), not the item SKU.
        lines: o.lines.map((l) => ({
          sku: l.variantSku,
          name: l.productName,
          qty: l.qty,
          price: money ? l.unitPrice : null,
          subtotal: money ? l.lineTotal : null,
        })),
        // Delivery notes only: no proof-of-delivery photo, receiver, GPS, signature or line detail.
        deliveries: o.deliveries.map((d) => ({ id: d.id, docNo: d.docNo, date: d.deliveredAt })),
        total: money ? o.total : null,
        url: recordUrl(ctx.baseUrl, `/backoffice/field-sales-orders/${o.id}`),
      };
    },
  }),
  creditTool,
];

export const writeTools: ViraWriteTool[] = [approveFieldSalesOrderTool, rejectFieldSalesOrderTool];

/** Sample MCP args for never-execute (#544), keyed by tool name. */
export const __sampleInput = {
  approve_field_sales_order: { order: "SO-1" },
  reject_field_sales_order: { order: "SO-1", reason: "x" },
};

export const parityCases: ParityCase[] = [
  { tool: "list_field_sales_orders", kind: "route", path: "/backoffice/field-sales-orders" },
  { tool: "get_field_sales_order", kind: "route", path: "/backoffice/field-sales-orders" },
  { tool: "get_field_sales_order_credit", kind: "route", path: "/backoffice/field-sales-orders" },
  {
    tool: "approve_field_sales_order",
    kind: "writeAction",
    actionModule: "@/app/actions/field-sales-orders",
    actionExport: "approveFieldSalesOrderAction",
    writerModule: "@/lib/field-sales/writer",
    writerExport: "approveFieldSalesOrder",
    args: ["order-1"],
  },
  {
    tool: "reject_field_sales_order",
    kind: "writeAction",
    actionModule: "@/app/actions/field-sales-orders",
    actionExport: "rejectFieldSalesOrderAction",
    writerModule: "@/lib/field-sales/writer",
    writerExport: "rejectFieldSalesOrder",
    args: ["order-1", "alasan"],
  },
];
