import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listSpgSales, listSpgSalesmen } from "@/lib/spg/sale-queries";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { SpgSalesListClient, type BarisDaftarNotaSpg } from "./SpgSalesListClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    salesmanId?: string;
    from?: string;
    to?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export default async function SpgSalesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const salesmanId = sp.salesmanId?.trim() || undefined;
  const from = parseDateOnly(sp.from ?? "");
  const to = parseDateOnlyEnd(sp.to ?? "");
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const [{ items, totalCount }, salesmen] = await Promise.all([
    listSpgSales({ salesmanId, from, to }, { page, pageSize }),
    listSpgSalesmen(),
  ]);

  // Potongan dan tanda "tanpa sinyal" untuk baris halaman ini saja (satu kueri
  // per halaman, bukan per baris). `listSpgSales` dipakai bersama layar lain,
  // jadi kolom tambahannya dibaca di sini.
  const tambahan = await prisma.spgSale.findMany({
    where: { id: { in: items.map((s) => s.id) } },
    select: { id: true, discountTotal: true, capturedOffline: true },
  });
  const perId = new Map(tambahan.map((x) => [x.id, x]));
  const sales: BarisDaftarNotaSpg[] = items.map((s) => ({
    ...s,
    discountTotal: Number(perId.get(s.id)?.discountTotal ?? 0),
    capturedOffline: perId.get(s.id)?.capturedOffline ?? false,
  }));

  return (
    <SpgSalesListClient
      sales={sales}
      totalCount={totalCount}
      salesmen={salesmen}
      salesmanId={salesmanId ?? ""}
      from={sp.from ?? ""}
      to={sp.to ?? ""}
      page={page}
      pageSize={pageSize}
    />
  );
}
