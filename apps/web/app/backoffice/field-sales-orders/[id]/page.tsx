import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getFieldSalesOrderById } from "@/lib/field-sales/queries";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { FieldSalesOrderDetailClient } from "./FieldSalesOrderDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function FieldSalesOrderDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const order = await getFieldSalesOrderById(id);
  if (!order) notFound();

  const canApprove = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.FIELD_SALES_ORDERS_APPROVE,
  );

  return <FieldSalesOrderDetailClient order={order} canApprove={canApprove} />;
}
