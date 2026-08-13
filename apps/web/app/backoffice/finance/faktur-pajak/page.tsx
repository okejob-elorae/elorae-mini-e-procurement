import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listTaxInvoices, type TaxInvoiceStatusFilter } from "@/lib/tax-invoices/queries";
import { FakturPajakPageClient } from "./FakturPajakPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
};

const STATUS_VALUES: TaxInvoiceStatusFilter[] = ["PENDING", "CREATED", "NOT_REQUIRED"];

function parseStatus(raw: string | undefined): TaxInvoiceStatusFilter | undefined {
  return raw && (STATUS_VALUES as string[]).includes(raw) ? (raw as TaxInvoiceStatusFilter) : undefined;
}

export default async function FakturPajakPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.TAX_INVOICES_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const status = parseStatus(sp.status);
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;
  const canManage = hasPermission(permissions, PERMISSIONS.TAX_INVOICES_MANAGE);

  try {
    const { rows, total, counts } = await listTaxInvoices({
      status,
      q: q || undefined,
      page,
      perPage: pageSize,
    });

    return (
      <FakturPajakPageClient
        rows={rows}
        total={total}
        counts={counts}
        status={status ?? "ALL"}
        q={q}
        page={page}
        pageSize={pageSize}
        canManage={canManage}
        loadError={false}
      />
    );
  } catch {
    return (
      <FakturPajakPageClient
        rows={[]}
        total={0}
        counts={{ PENDING: 0, CREATED: 0, NOT_REQUIRED: 0 }}
        status={status ?? "ALL"}
        q={q}
        page={page}
        pageSize={pageSize}
        canManage={canManage}
        loadError={true}
      />
    );
  }
}
