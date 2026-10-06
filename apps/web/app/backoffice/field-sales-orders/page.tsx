import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listFieldSalesOrders } from "@/lib/field-sales/queries";
import type { DeliveryStatusFilter, FieldSalesOrderStatus } from "@/lib/field-sales/queries";
import { listStoreOptions } from "@/lib/stores/queries";
import { FieldSalesOrdersPageClient } from "./FieldSalesOrdersPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    status?: string;
    orderType?: string;
    origin?: string;
    storeId?: string;
    deliveryStatus?: string;
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

const DELIVERY_STATUS_VALUES: DeliveryStatusFilter[] = ["OPEN", "PENDING", "PARTIAL", "DELIVERED", "CLOSED"];

function parseDeliveryStatus(raw: string | undefined): DeliveryStatusFilter | undefined {
  return raw && (DELIVERY_STATUS_VALUES as string[]).includes(raw) ? (raw as DeliveryStatusFilter) : undefined;
}

function parseOrderType(raw: string | undefined): "PUTUS" | "KONSI" | undefined {
  return raw === "PUTUS" || raw === "KONSI" ? raw : undefined;
}

function parseOrigin(raw: string | undefined): "FIELD" | "ADMIN" | undefined {
  return raw === "FIELD" || raw === "ADMIN" ? raw : undefined;
}

export default async function FieldSalesOrdersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const deliveryStatus = parseDeliveryStatus(sp.deliveryStatus);
  const filter = {
    search: sp.search?.trim() || undefined,
    /* A delivery state only exists on an approved order, so the filter pins the status. */
    status: deliveryStatus ? ("APPROVED" as const) : parseStatus(sp.status),
    deliveryStatus,
    orderType: parseOrderType(sp.orderType),
    origin: parseOrigin(sp.origin),
    storeId: sp.storeId?.trim() || undefined,
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const [{ orders, totalCount }, storeOptions] = await Promise.all([
    listFieldSalesOrders(filter, { page, pageSize }),
    listStoreOptions(),
  ]);

  return (
    <FieldSalesOrdersPageClient
      orders={orders}
      totalCount={totalCount}
      search={filter.search ?? ""}
      status={filter.status ?? "ALL"}
      orderType={sp.orderType === "PUTUS" || sp.orderType === "KONSI" ? sp.orderType : "ALL"}
      origin={sp.origin === "FIELD" || sp.origin === "ADMIN" ? sp.origin : "ALL"}
      storeId={filter.storeId ?? "ALL"}
      deliveryStatus={filter.deliveryStatus ?? "ALL"}
      storeOptions={storeOptions}
      page={page}
      pageSize={pageSize}
    />
  );
}
