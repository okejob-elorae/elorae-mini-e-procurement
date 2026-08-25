import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getFieldReturnById } from "@/lib/field-sales/retur/queries";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { FieldReturnDetailClient } from "./FieldReturnDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function FieldReturnDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;

  /*
   * canManage is computed before the query, not after — getFieldReturnById needs it to decide
   * whether it is worth resolving price candidates for this viewer at all (see its own comment).
   * canWriteOff has no bearing on that query, only on which resolution buttons render below.
   */
  const permissions = session.user.permissions ?? [];
  const canManage = hasPermission(permissions, PERMISSIONS.FIELD_RETURNS_MANAGE);
  const canWriteOff = hasPermission(permissions, PERMISSIONS.FIELD_RETURNS_WRITEOFF);

  const fieldReturn = await getFieldReturnById(id, { canManage });
  if (!fieldReturn) notFound();

  return (
    <FieldReturnDetailClient
      fieldReturn={fieldReturn}
      canManage={canManage}
      canWriteOff={canWriteOff}
    />
  );
}
