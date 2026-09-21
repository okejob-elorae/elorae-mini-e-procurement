import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listStoreTransfers, type StoreTransferStatusValue } from "@/lib/stores/transfer/queries";
import { StoreTransfersPageClient } from "./StoreTransfersPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const STATUS_VALUES: ReadonlySet<string> = new Set(["PENDING", "APPROVED", "CANCELLED"]);

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseStatus(raw: string | undefined): StoreTransferStatusValue | undefined {
  return raw && STATUS_VALUES.has(raw) ? (raw as StoreTransferStatusValue) : undefined;
}

export default async function StoreTransfersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const status = parseStatus(sp.status);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = parsePageSize(sp.pageSize);

  const { rows, total } = await listStoreTransfers({ q, status, page, perPage: pageSize });

  const canManage = hasPermission(perms, PERMISSIONS.STORES_MANAGE);

  return (
    <StoreTransfersPageClient
      rows={rows}
      total={total}
      q={q ?? ""}
      status={status ?? ""}
      page={page}
      pageSize={pageSize}
      canManage={canManage}
    />
  );
}
