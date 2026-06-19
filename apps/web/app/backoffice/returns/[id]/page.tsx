import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getSalesReturnById } from "@/lib/sales-returns/queries";
import { ReturnDecisionCard } from "./ReturnDecisionCard";

export const dynamic = "force-dynamic";

export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SALES_RETURNS_VIEW)) {
    redirect("/backoffice");
  }
  const { id } = await params;
  const ret = await getSalesReturnById(id);
  if (!ret) notFound();

  const canDecide = hasPermission(session.user.permissions ?? [], PERMISSIONS.SALES_RETURNS_DECIDE);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <ReturnDecisionCard ret={ret} canDecide={canDecide} />
    </div>
  );
}
