import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { SALES_CHANNEL_VALUES, SALES_RETURN_STATUS_VALUES } from "@/lib/constants/enums";
import type { SalesChannel, SalesReturnStatus } from "@/lib/constants/enums";
import { parseDateOnly } from "@/lib/date-only";
import { listSalesReturns, getSalesReturnsKpi } from "@/lib/sales-returns/queries";
import { SalesReturnsPageClient } from "./SalesReturnsPageClient";

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

function parseStatus(raw: string | undefined): SalesReturnStatus | undefined {
  if (!raw) return undefined;
  return (SALES_RETURN_STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as SalesReturnStatus)
    : undefined;
}

function parseDateFrom(raw: string | undefined): Date | undefined {
  return raw ? parseDateOnly(raw) : undefined;
}

function parseDateTo(raw: string | undefined): Date | undefined {
  const d = raw ? parseDateOnly(raw) : undefined;
  if (!d) return undefined;
  // Inclusive end-of-day in local time so the chosen day's returns are not excluded.
  d.setHours(23, 59, 59, 999);
  return d;
}

export default async function SalesReturnsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const filter = {
    search: sp.search?.trim() || undefined,
    channel: parseChannel(sp.channel),
    status: parseStatus(sp.status),
    receivedFrom: parseDateFrom(sp.dateFrom),
    receivedTo: parseDateTo(sp.dateTo),
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const now = new Date();
  const kpiFrom = new Date(now);
  kpiFrom.setDate(kpiFrom.getDate() - 30);

  const [{ rows, total }, kpi] = await Promise.all([
    listSalesReturns(filter, { page, pageSize }),
    getSalesReturnsKpi({ from: kpiFrom, to: now }),
  ]);

  return (
    <SalesReturnsPageClient
      rows={rows}
      totalCount={total}
      kpi={kpi}
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
