import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getPostableAccounts } from "@/lib/finance/coa/queries";
import { ManualJournalForm } from "./ManualJournalForm";

export const dynamic = "force-dynamic";

export default async function NewManualJournalPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.JOURNALS_MANAGE)) {
    redirect("/backoffice");
  }

  const accounts = await getPostableAccounts();

  return <ManualJournalForm accounts={accounts} />;
}
