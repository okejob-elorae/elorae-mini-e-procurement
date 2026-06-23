"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import {
  markOrderPicked,
  markOrderPacked,
  InvalidFulfillmentTransition,
} from "@elorae/db/sales-order-fulfillment-writer";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type {
  SalesChannel,
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from "@/lib/constants/enums";
import { FULFILLMENT_FORBIDDEN_REASON } from "@/lib/sales-orders/fulfillment-result";

export type FulfillmentQueueRow = {
  id: string;
  salesorderNo: string;
  channel: SalesChannel;
  status: SalesOrderStatus;
  fulfillmentStatus: SalesOrderFulfillmentStatus;
  customerName: string | null;
  transactionDate: Date;
};

export type QueueSortField =
  | "transactionDate"
  | "salesorderNo"
  | "channel"
  | "fulfillmentStatus";
export type QueueSortDir = "asc" | "desc";

export type ListFulfillmentQueueOpts = {
  fulfillmentStatus?: SalesOrderFulfillmentStatus | "ALL";
  channel?: SalesChannel;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortField?: QueueSortField;
  sortDir?: QueueSortDir;
  page: number;
  pageSize: number;
};

export type QueuePage = {
  rows: FulfillmentQueueRow[];
  totalCount: number;
};

export type BatchResult =
  | { ok: true; processed: number; skipped: number }
  | { ok: false; reason: typeof FULFILLMENT_FORBIDDEN_REASON };

async function requireSession(): Promise<{ userId: string; permissions: string[] }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  return { userId: session.user.id, permissions: session.user.permissions };
}

function buildWhere(opts: ListFulfillmentQueueOpts): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const fStatus = opts.fulfillmentStatus ?? "PENDING";
  if (fStatus !== "ALL") {
    where.fulfillmentStatus = fStatus;
  }
  if (opts.channel) where.channel = opts.channel;
  if (opts.dateFrom || opts.dateTo) {
    where.transactionDate = {
      ...(opts.dateFrom ? { gte: opts.dateFrom } : {}),
      ...(opts.dateTo ? { lte: opts.dateTo } : {}),
    };
  }
  if (opts.search && opts.search.trim().length > 0) {
    const s = opts.search.trim();
    where.OR = [
      { salesorderNo: { contains: s } },
      { customerName: { contains: s } },
    ];
  }
  return where;
}

export async function listFulfillmentQueue(opts: ListFulfillmentQueueOpts): Promise<QueuePage> {
  await requireSession();

  const where = buildWhere(opts);
  const sortField: QueueSortField = opts.sortField ?? "transactionDate";
  const sortDir: QueueSortDir = opts.sortDir ?? (sortField === "transactionDate" ? "desc" : "asc");

  const [rows, totalCount] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      orderBy: { [sortField]: sortDir },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      select: {
        id: true,
        salesorderNo: true,
        channel: true,
        status: true,
        fulfillmentStatus: true,
        customerName: true,
        transactionDate: true,
      },
    }),
    prisma.salesOrder.count({ where }),
  ]);

  const out: FulfillmentQueueRow[] = rows.map((r) => ({
    id: r.id,
    salesorderNo: r.salesorderNo,
    channel: r.channel as SalesChannel,
    status: r.status as SalesOrderStatus,
    fulfillmentStatus: r.fulfillmentStatus as SalesOrderFulfillmentStatus,
    customerName: r.customerName,
    transactionDate: r.transactionDate,
  }));

  return { rows: out, totalCount };
}

async function runBatch(
  orderIds: string[],
  fn: (orderId: string, userId: string) => Promise<void>,
): Promise<BatchResult> {
  const { userId, permissions } = await requireSession();
  if (!hasPermission(permissions, PERMISSIONS.SALES_ORDERS_FULFILL)) {
    return { ok: false, reason: FULFILLMENT_FORBIDDEN_REASON };
  }

  let processed = 0;
  let skipped = 0;
  for (const orderId of orderIds) {
    try {
      await fn(orderId, userId);
      processed += 1;
    } catch (err) {
      if (err instanceof InvalidFulfillmentTransition) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  revalidatePath("/backoffice/fulfillment");
  return { ok: true, processed, skipped };
}

export async function batchFinishPickAction(orderIds: string[]): Promise<BatchResult> {
  return runBatch(orderIds, (orderId, userId) =>
    markOrderPicked(prisma, { orderId, userId }),
  );
}

export async function batchFinishPackAction(orderIds: string[]): Promise<BatchResult> {
  return runBatch(orderIds, (orderId, userId) =>
    markOrderPacked(prisma, { orderId, userId }),
  );
}
