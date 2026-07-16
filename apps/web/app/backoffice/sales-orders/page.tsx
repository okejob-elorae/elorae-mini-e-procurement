import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { SALES_CHANNEL_VALUES, SALES_ORDER_STATUS_VALUES } from "@/lib/constants/enums";
import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { listSalesOrders } from "@/lib/sales-orders/queries";
import { SalesOrdersPageClient } from "./SalesOrdersPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    channel?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseChannel(raw: string | undefined): SalesChannel | undefined {
  if (!raw) return undefined;
  return (SALES_CHANNEL_VALUES as readonly string[]).includes(raw)
    ? (raw as SalesChannel)
    : undefined;
}

function parseStatus(raw: string | undefined): SalesOrderStatus | undefined {
  if (!raw) return undefined;
  return (SALES_ORDER_STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as SalesOrderStatus)
    : undefined;
}

function parseDateFrom(raw: string | undefined): Date | undefined {
  return raw ? parseDateOnly(raw) : undefined;
}

function parseDateTo(raw: string | undefined): Date | undefined {
  // Inclusive end-of-day anchored to WIB (matches the WIB-displayed dates), so the chosen
  // day's orders are included and the next WIB day's are excluded.
  return raw ? parseDateOnlyEnd(raw) : undefined;
}

export default async function SalesOrdersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const filter = {
    search: sp.search?.trim() || undefined,
    channel: parseChannel(sp.channel),
    status: parseStatus(sp.status),
    dateFrom: parseDateFrom(sp.dateFrom),
    dateTo: parseDateTo(sp.dateTo),
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { orders, totalCount } = await listSalesOrders(filter, {
    page,
    pageSize,
  });

  return (
    <SalesOrdersPageClient
      orders={orders}
      totalCount={totalCount}
      search={filter.search ?? ""}
      channel={filter.channel ?? ""}
      status={filter.status ?? ""}
      dateFrom={sp.dateFrom ?? ""}
      dateTo={sp.dateTo ?? ""}
      page={page}
      pageSize={pageSize}
    />
  );
}
