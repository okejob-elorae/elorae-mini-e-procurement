import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getCoaTree } from "@/lib/finance/coa/queries";
import { CoaPageClient } from "./CoaPageClient";

export const dynamic = "force-dynamic";

type SearchParams = { inactive?: string };

export default async function CoaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = (session.user as { permissions?: string[] }).permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.COA_VIEW)) redirect("/backoffice");

  const params = await searchParams;
  const includeInactive = params.inactive === "1";
  const tree = await getCoaTree({ includeInactive });
  const canManage = hasPermission(perms, PERMISSIONS.COA_MANAGE);
  const canViewLedger = hasPermission(perms, PERMISSIONS.JOURNALS_VIEW);

  return (
    <CoaPageClient
      tree={tree}
      includeInactive={includeInactive}
      canManage={canManage}
      canViewLedger={canViewLedger}
    />
  );
}
