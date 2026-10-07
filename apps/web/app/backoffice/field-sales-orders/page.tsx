import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listFieldSalesOrders } from "@/lib/field-sales/queries";
import type { FieldSalesDeliveryStatus, FieldSalesOrderStatusFilter } from "@/lib/field-sales/queries";
import { listStoreOptions } from "@/lib/stores/queries";
import { idPesananKreditDitahan } from "@/lib/field-sales/kredit-panel";
import { FieldSalesOrdersPageClient } from "./FieldSalesOrdersPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    status?: string;
    orderType?: string;
    storeId?: string;
    inden?: string;
    kirim?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const STATUS_VALUES: FieldSalesOrderStatusFilter[] = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"];
const KIRIM_VALUES: FieldSalesDeliveryStatus[] = ["PENDING", "PARTIAL", "DELIVERED", "CLOSED"];

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

// "ALL" is an explicit sentinel for "show every status"; an absent param
// falls back to the PENDING_APPROVAL default view — kecuali saringan pengiriman
// dipakai: pengiriman hanya ada pada pesanan disetujui, jadi bawaannya Disetujui.
function parseStatus(raw: string | undefined, kirim: FieldSalesDeliveryStatus | undefined): FieldSalesOrderStatusFilter | undefined {
  if (raw === "ALL") return undefined;
  if (raw && (STATUS_VALUES as string[]).includes(raw)) return raw as FieldSalesOrderStatusFilter;
  return kirim ? "APPROVED" : "PENDING_APPROVAL";
}

/** `?kirim=` — status pengiriman; nilai lain diabaikan. */
function parseKirim(raw: string | undefined): FieldSalesDeliveryStatus | undefined {
  return raw && (KIRIM_VALUES as string[]).includes(raw) ? (raw as FieldSalesDeliveryStatus) : undefined;
}

function parseOrderType(raw: string | undefined): "PUTUS" | "KONSI" | undefined {
  return raw === "PUTUS" || raw === "KONSI" ? raw : undefined;
}

/** Saringan pre-order: INDEN = hanya pre-order, BIASA = hanya stok siap, absen = semua. */
function parseInden(raw: string | undefined): "INDEN" | "BIASA" | undefined {
  return raw === "INDEN" || raw === "BIASA" ? raw : undefined;
}

export default async function FieldSalesOrdersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const kirim = parseKirim(sp.kirim);
  const filter = {
    search: sp.search?.trim() || undefined,
    status: parseStatus(sp.status, kirim),
    kirim,
    orderType: parseOrderType(sp.orderType),
    storeId: sp.storeId?.trim() || undefined,
    inden: parseInden(sp.inden),
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const [{ orders, totalCount }, storeOptions] = await Promise.all([
    listFieldSalesOrders(filter, { page, pageSize }),
    listStoreOptions(),
  ]);
  // Lencana "Kredit ditahan" — hanya untuk baris di halaman ini, satu kueri.
  const kreditDitahanIds = await idPesananKreditDitahan(orders.map((o) => o.id));

  return (
    <FieldSalesOrdersPageClient
      orders={orders}
      totalCount={totalCount}
      search={filter.search ?? ""}
      status={filter.status ?? "ALL"}
      orderType={sp.orderType === "PUTUS" || sp.orderType === "KONSI" ? sp.orderType : "ALL"}
      storeId={filter.storeId ?? "ALL"}
      inden={filter.inden ?? "ALL"}
      kirim={kirim ?? "ALL"}
      storeOptions={storeOptions}
      page={page}
      pageSize={pageSize}
      kreditDitahanIds={kreditDitahanIds}
    />
  );
}
