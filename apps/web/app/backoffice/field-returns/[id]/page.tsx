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
  const fieldReturn = await getFieldReturnById(id);
  if (!fieldReturn) notFound();

  /*
   * Viewing stays open to any authenticated user — the register has no view gate today and
   * this slice adds none. canManage/canWriteOff are computed here, server-side, and passed
   * down as plain booleans so the client never has to decide who is allowed to act; the
   * server actions enforce the same two permissions independently, so this is only about not
   * offering a control that will be refused.
   */
  const permissions = session.user.permissions ?? [];
  const canManage = hasPermission(permissions, PERMISSIONS.FIELD_RETURNS_MANAGE);
  const canWriteOff = hasPermission(permissions, PERMISSIONS.FIELD_RETURNS_WRITEOFF);

  return (
    <FieldReturnDetailClient
      fieldReturn={fieldReturn}
      canManage={canManage}
      canWriteOff={canWriteOff}
    />
  );
}
