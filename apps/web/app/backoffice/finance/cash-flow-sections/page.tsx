import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listAccountSections } from "@/lib/finance/reports/cash-flow-queries";
import { isClassifiableType } from "@/lib/finance/reports/cash-flow-classify";
import { CashFlowSectionsClient } from "./CashFlowSectionsClient";

export const dynamic = "force-dynamic";

export default async function CashFlowSectionsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const rows = (await listAccountSections()).filter((row) => isClassifiableType(row.type));
  const canManage = hasPermission(perms, PERMISSIONS.JOURNALS_MANAGE);

  return <CashFlowSectionsClient rows={rows} canManage={canManage} />;
}
