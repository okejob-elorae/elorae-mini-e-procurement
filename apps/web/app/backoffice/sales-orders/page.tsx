import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { SALES_CHANNEL_VALUES, SALES_ORDER_STATUS_VALUES } from "@/lib/constants/enums";
import type { SalesChannel, SalesOrderStatus } from "@/lib/constants/enums";
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
  }>;
};

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

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function SalesOrdersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const filter = {
    search: sp.search?.trim() || undefined,
    channel: parseChannel(sp.channel),
    status: parseStatus(sp.status),
    dateFrom: parseDate(sp.dateFrom),
    dateTo: parseDate(sp.dateTo),
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { orders, totalCount } = await listSalesOrders(filter, {
    page,
    pageSize: DEFAULT_PAGE_SIZE,
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
      pageSize={DEFAULT_PAGE_SIZE}
    />
  );
}
