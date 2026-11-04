import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listFieldSalesOrders } from "@/lib/field-sales/queries";
import type { DeliveryStatusFilter, FieldSalesDeliveryStatus, FieldSalesOrderStatusFilter } from "@/lib/field-sales/queries";
import { listStoreOptions } from "@/lib/stores/queries";
import { idPesananKreditDitahan } from "@/lib/field-sales/kredit-panel";
import { adaSaringanKinerja, bacaSaringanKinerja } from "@/lib/field-sales/saringan-kinerja";
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
    inden?: string;
    kirim?: string;
    page?: string;
    pageSize?: string;
    /** Dari Kinerja sales lapangan: hari WIB tanggal dibuat dan pembuat pesanan. */
    dari?: string;
    sampai?: string;
    salesman?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const STATUS_VALUES: FieldSalesOrderStatusFilter[] = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "AKTIF"];
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

/** Saringan pre-order: INDEN = hanya pre-order, BIASA = hanya stok siap, absen = semua. */
function parseInden(raw: string | undefined): "INDEN" | "BIASA" | undefined {
  return raw === "INDEN" || raw === "BIASA" ? raw : undefined;
}

export default async function FieldSalesOrdersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const deliveryStatus = parseDeliveryStatus(sp.deliveryStatus);
  const kirim = parseKirim(sp.kirim);
  const kinerja = bacaSaringanKinerja(sp);
  const filter = {
    search: sp.search?.trim() || undefined,
    /* A delivery state only exists on an approved order, so the filter pins the status. */
    status: deliveryStatus ? ("APPROVED" as const) : parseStatus(sp.status, kirim),
    deliveryStatus,
    kirim,
    orderType: parseOrderType(sp.orderType),
    origin: parseOrigin(sp.origin),
    storeId: sp.storeId?.trim() || undefined,
    inden: parseInden(sp.inden),
    salesmanId: kinerja.salesmanId ?? undefined,
    dibuatSejak: kinerja.dibuatSejak ?? undefined,
    dibuatSebelum: kinerja.dibuatSebelum ?? undefined,
  };
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const [{ orders, totalCount }, storeOptions, sales] = await Promise.all([
    listFieldSalesOrders(filter, { page, pageSize }),
    listStoreOptions(),
    kinerja.salesmanId
      ? prisma.user.findUnique({ where: { id: kinerja.salesmanId }, select: { name: true, email: true } })
      : Promise.resolve(null),
  ]);
  // Keping saringan dari Kinerja sales lapangan — tanggal diformat di server (WIB).
  const tgl = (k: string) => formatDisplayDate(new Date(`${k}T00:00:00+07:00`));
  const saringKinerja = adaSaringanKinerja(kinerja)
    ? {
        dari: kinerja.dari ? tgl(kinerja.dari) : null,
        sampai: kinerja.sampai ? tgl(kinerja.sampai) : null,
        sales: kinerja.salesmanId ? (sales?.name ?? sales?.email ?? kinerja.salesmanId) : null,
      }
    : null;
  // Lencana "Kredit ditahan" — hanya untuk baris di halaman ini, satu kueri.
  const kreditDitahanIds = await idPesananKreditDitahan(orders.map((o) => o.id));

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
      inden={filter.inden ?? "ALL"}
      kirim={kirim ?? "ALL"}
      storeOptions={storeOptions}
      page={page}
      pageSize={pageSize}
      kreditDitahanIds={kreditDitahanIds}
      saringKinerja={saringKinerja}
    />
  );
}
