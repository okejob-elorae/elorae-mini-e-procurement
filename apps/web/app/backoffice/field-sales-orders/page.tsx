import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listFieldSalesOrders } from "@/lib/field-sales/queries";
import type { FieldSalesOrderStatus } from "@/lib/field-sales/queries";
import { FieldSalesOrdersPageClient } from "./FieldSalesOrdersPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const STATUS_VALUES: FieldSalesOrderStatus[] = ["PENDING_APPROVAL", "APPROVED", "REJECTED"];

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

// "ALL" is an explicit sentinel for "show every status"; an absent param
// falls back to the PENDING_APPROVAL default view.
function parseStatus(raw: string | undefined): FieldSalesOrderStatus | undefined {
  if (raw === "ALL") return undefined;
  if (raw && (STATUS_VALUES as string[]).includes(raw)) return raw as FieldSalesOrderStatus;
  return "PENDING_APPROVAL";
}

export default async function FieldSalesOrdersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const filter = {
    search: sp.search?.trim() || undefined,
    status: parseStatus(sp.status),
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { orders, totalCount } = await listFieldSalesOrders(filter, {
    page,
    pageSize,
  });

  return (
    <FieldSalesOrdersPageClient
      orders={orders}
      totalCount={totalCount}
      search={filter.search ?? ""}
      status={filter.status ?? "ALL"}
      page={page}
      pageSize={pageSize}
    />
  );
}
