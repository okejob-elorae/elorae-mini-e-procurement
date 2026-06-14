import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import {
  SALES_CHANNEL_VALUES,
  SALES_ORDER_FULFILLMENT_STATUS_VALUES,
  type SalesChannel,
  type SalesOrderFulfillmentStatus,
} from "@/lib/constants/enums";
import { parseDateOnly } from "@/lib/date-only";
import {
  listFulfillmentQueue,
  type QueueSortField,
  type QueueSortDir,
} from "@/app/actions/fulfillment-queue";
import { FulfillmentQueueClient } from "./FulfillmentQueueClient";

export const dynamic = "force-dynamic";

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const SORT_FIELDS: QueueSortField[] = [
  "transactionDate",
  "salesorderNo",
  "channel",
  "fulfillmentStatus",
];
const SORT_DIRS: QueueSortDir[] = ["asc", "desc"];

type PageProps = {
  searchParams: Promise<{
    fulfillmentStatus?: string;
    channel?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sortField?: string;
    sortDir?: string;
    page?: string;
    pageSize?: string;
  }>;
};

function parseFulfillmentStatus(
  raw: string | undefined,
): SalesOrderFulfillmentStatus | "ALL" | undefined {
  if (!raw) return undefined;
  if (raw === "ALL") return "ALL";
  return (SALES_ORDER_FULFILLMENT_STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as SalesOrderFulfillmentStatus)
    : undefined;
}

function parseChannel(raw: string | undefined): SalesChannel | undefined {
  if (!raw) return undefined;
  return (SALES_CHANNEL_VALUES as readonly string[]).includes(raw)
    ? (raw as SalesChannel)
    : undefined;
}

function parseSortField(raw: string | undefined): QueueSortField {
  return SORT_FIELDS.includes(raw as QueueSortField)
    ? (raw as QueueSortField)
    : "transactionDate";
}

function parseSortDir(raw: string | undefined, field: QueueSortField): QueueSortDir {
  if (SORT_DIRS.includes(raw as QueueSortDir)) return raw as QueueSortDir;
  return field === "transactionDate" ? "desc" : "asc";
}

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseDateFrom(raw: string | undefined): Date | undefined {
  return raw ? parseDateOnly(raw) : undefined;
}

function parseDateTo(raw: string | undefined): Date | undefined {
  const d = raw ? parseDateOnly(raw) : undefined;
  if (!d) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

export default async function FulfillmentQueuePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const fulfillmentStatus = parseFulfillmentStatus(sp.fulfillmentStatus);
  const channel = parseChannel(sp.channel);
  const sortField = parseSortField(sp.sortField);
  const sortDir = parseSortDir(sp.sortDir, sortField);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { rows, totalCount } = await listFulfillmentQueue({
    fulfillmentStatus,
    channel,
    search: sp.search?.trim() || undefined,
    dateFrom: parseDateFrom(sp.dateFrom),
    dateTo: parseDateTo(sp.dateTo),
    sortField,
    sortDir,
    page,
    pageSize,
  });

  const canFulfill = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.SALES_ORDERS_FULFILL,
  );

  return (
    <FulfillmentQueueClient
      rows={rows}
      totalCount={totalCount}
      fulfillmentStatus={fulfillmentStatus ?? "PENDING"}
      channel={channel ?? ""}
      search={sp.search?.trim() ?? ""}
      dateFrom={sp.dateFrom ?? ""}
      dateTo={sp.dateTo ?? ""}
      sortField={sortField}
      sortDir={sortDir}
      page={page}
      pageSize={pageSize}
      canFulfill={canFulfill}
    />
  );
}
