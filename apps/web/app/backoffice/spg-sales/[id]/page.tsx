import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getSpgSaleById } from "@/lib/spg/sale-queries";
import { SpgSaleDetailClient } from "./SpgSaleDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SpgSaleDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const sale = await getSpgSaleById(id);
  if (!sale) notFound();

  return <SpgSaleDetailClient sale={sale} />;
}
