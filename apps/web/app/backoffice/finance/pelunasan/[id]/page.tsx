import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getSettlementForApproval } from "@/lib/finance/ar-settlement/queries";
import { SettlementApprovalClient } from "./SettlementApprovalClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SettlementApprovalPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.COLLECTIONS_MANAGE)) {
    redirect("/backoffice");
  }

  const { id } = await params;
  const settlement = await getSettlementForApproval(id);
  if (!settlement) notFound();

  /**
   * The journal-gap alert offers a shortcut to Settings → Account Mapping, which is the fix when a
   * component payment's journal was refused for an unmapped posting role. That screen gates on
   * `journals:view`, NOT on the `collections:manage` this one checks, so the link is rendered only
   * for an operator who can actually open it — otherwise it would redirect them to `/backoffice`
   * and read as a broken control. The cause itself is still named either way, so a collections-only
   * approver can tell finance exactly which role to map.
   */
  const canViewAccountMapping = hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW);

  return (
    <SettlementApprovalClient
      settlement={settlement}
      canViewAccountMapping={canViewAccountMapping}
    />
  );
}
