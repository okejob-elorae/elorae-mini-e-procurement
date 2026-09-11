import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listTaxInvoices, type TaxInvoiceStatusFilter } from "@/lib/tax-invoices/queries";
import { getPpnRatePercent } from "@/app/actions/settings/ppn";
import { FakturPajakPageClient } from "./FakturPajakPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
};

const STATUS_VALUES: TaxInvoiceStatusFilter[] = ["PENDING", "CREATED", "SENT_TO_STORE", "NOT_REQUIRED"];

/**
 * Mirrors the local `DEFAULT_PPN_RATE` in `app/actions/settings/ppn.ts` — that file has the
 * `"use server"` directive, which only allows async function exports, so its default cannot be
 * imported here. Keep this in sync by hand if that default ever changes.
 */
const FALLBACK_PPN_RATE_PERCENT = 11;

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
    const [{ rows, total, counts }, ppnRatePercent] = await Promise.all([
      listTaxInvoices({ status, q: q || undefined, page, perPage: pageSize }),
      getPpnRatePercent(),
    ]);

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
        ppnRatePercent={ppnRatePercent}
      />
    );
  } catch (err) {
    /* The error card is the only user-facing signal, and it names no cause — without this the
       container log holds nothing at all about why the page is blank. */
    console.error("[faktur-pajak] list query failed", err);
    return (
      <FakturPajakPageClient
        rows={[]}
        total={0}
        counts={{ PENDING: 0, CREATED: 0, SENT_TO_STORE: 0, NOT_REQUIRED: 0 }}
        status={status ?? "ALL"}
        q={q}
        page={page}
        pageSize={pageSize}
        canManage={canManage}
        loadError={true}
        ppnRatePercent={FALLBACK_PPN_RATE_PERCENT}
      />
    );
  }
}
