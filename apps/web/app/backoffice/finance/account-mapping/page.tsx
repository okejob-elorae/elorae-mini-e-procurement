import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listAccountMappings } from "@/lib/finance/journals/mapping";
import { getPostableAccounts } from "@/lib/finance/coa/queries";
import { AccountMappingClient } from "./AccountMappingClient";

export const dynamic = "force-dynamic";

export default async function AccountMappingPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = (session.user as { permissions?: string[] }).permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const [mappings, accounts] = await Promise.all([
    listAccountMappings(),
    getPostableAccounts(),
  ]);
  const canManage = hasPermission(perms, PERMISSIONS.JOURNALS_MANAGE);

  return (
    <AccountMappingClient
      mappings={mappings}
      accounts={accounts}
      canManage={canManage}
    />
  );
}
