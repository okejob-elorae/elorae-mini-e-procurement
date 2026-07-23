import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { listSettlements } from "@/lib/finance/settlement/queries";
import { SettlementsPageClient } from "./SettlementsPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function SettlementsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.SETTLEMENTS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;

  const { items, totalCount } = await listSettlements({ page, pageSize });
  const canManage = hasPermission(permissions, PERMISSIONS.SETTLEMENTS_MANAGE);

  return (
    <SettlementsPageClient
      items={items}
      totalCount={totalCount}
      page={page}
      pageSize={pageSize}
      canManage={canManage}
    />
  );
}
